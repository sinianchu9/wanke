import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getBooleanSetting, getNumberSetting, getSetting } from "@/lib/system-settings";
import {
  claimJobForPoll, countInFlightJobsTotal, countStrugglingJobs, getJob, listPollableJobs, listStalledJobs,
  recordJobPoll, updateJobRemote, type PollableJob,
} from "@/lib/repository";
import { refreshJob } from "@/lib/video/provider";
import { archiveJobOutput } from "@/lib/archive";
import { completeJobCharge, getChargeByJob } from "@/lib/billing/charges";
import { assessTaskCost, recordTaskCost, reportedDurationSeconds } from "@/lib/billing/costs";
import { createNotification, readPreferences } from "@/lib/notifications";
import { publicBaseUrl, sendEmail, siteName } from "@/lib/mailer";
import { businessJobStatus, publicErrorMessage } from "@/lib/copy";
import { describeError } from "@/lib/errors";
import type { ResultMedia, StoredJob } from "@/lib/types";
import type { FailureClass } from "@/lib/billing/failures";

/**
 * The server-side creation worker (§20).
 *
 * A member submits a creation and may close the tab, shut the laptop or lose mobile
 * network. This module is the only thing that keeps that creation moving:
 *
 *   query in-flight jobs -> update status -> save results -> handle failure/timeout
 *   -> confirm or return credits (exactly once) -> notify -> record cost
 *
 * The browser never schedules anything. `POST /api/jobs/refresh` and the per-job
 * refresh button only ask this same worker to run one pass early for that member's
 * own jobs, so a closed browser changes nothing except how quickly the page updates.
 *
 * Exactly-once rules (§52):
 * - one job is claimed with a conditional UPDATE, so two schedulers (in-process timer
 *   plus a cron/admin tick) can never poll and finalize the same job in parallel;
 * - credits move only through `completeJobCharge`, whose settle/refund/void is guarded
 *   by the charge's current state, so 100 polls, a worker restart or a member refresh
 *   cannot charge or refund twice;
 * - notifications and emails carry dedupe keys, so a repeated pass stays silent.
 *
 * We never re-submit a creation to the upstream service on our own: a retried
 * generation costs real money twice and the upstream state of a failed submit is
 * unknown. Only status queries are retried; regenerating stays an explicit member
 * action ("重试"), which quotes and charges again like any new creation.
 */

export type WorkerTrigger = "scheduler" | "cron" | "admin" | "browser";

export interface WorkerConfig {
  enabled: boolean;
  intervalSeconds: number;
  batchSize: number;
  concurrency: number;
  timeoutMinutes: number;
  pollMaxErrors: number;
  notifyByEmail: boolean;
  cronTokenConfigured: boolean;
}

export interface WorkerTickResult {
  trigger: WorkerTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  enabled: boolean;
  skipped: "disabled" | "busy" | null;
  processed: number;
  progressed: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  settled: number;
  refunded: number;
  refundedCredits: number;
  held: number;
  archived: number;
  notified: number;
  emailed: number;
  claimLost: number;
  backlog: number;
  errors: Array<{ jobId: string; message: string }>;
}

export interface JobAdvanceResult {
  jobId: string;
  claimed: boolean;
  transition: "none" | "progress" | "succeeded" | "failed" | "timeout";
  chargeStatus: string | null;
  refunded: number;
  notified: boolean;
  emailed: boolean;
  archived: boolean;
  error: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

function positiveInt(value: number, fallback: number, min: number, max: number) {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) return fallback;
  return Math.min(max, Math.max(min, rounded));
}

export function workerConfig(): WorkerConfig {
  return {
    enabled: getBooleanSetting("worker_enabled"),
    intervalSeconds: positiveInt(getNumberSetting("worker_interval_seconds", 30), 30, 2, 3600),
    batchSize: positiveInt(getNumberSetting("worker_batch_size", 20), 20, 1, 100),
    concurrency: positiveInt(getNumberSetting("worker_concurrency", 3), 3, 1, 10),
    timeoutMinutes: positiveInt(getNumberSetting("job_timeout_minutes", 180), 180, 1, 10_080),
    pollMaxErrors: positiveInt(getNumberSetting("job_poll_max_errors", 8), 8, 1, 200),
    notifyByEmail: getBooleanSetting("notify_job_email"),
    cronTokenConfigured: Boolean(getSetting("worker_token")),
  };
}

/** Internal provider label for the cost record. Admin-only; members never see it. */
function providerLabel(job: StoredJob): string {
  const engine = String(job.details?.engine || "");
  if (engine === "modelstudio") return "modelstudio";
  if (engine.startsWith("yike")) return "yike";
  return job.providerJobId ? "unknown" : "";
}

function emptyTick(trigger: WorkerTrigger, startedAt: string, skipped: WorkerTickResult["skipped"], enabled: boolean): WorkerTickResult {
  const finishedAt = nowIso();
  return {
    trigger, startedAt, finishedAt, durationMs: Date.now() - new Date(startedAt).getTime(),
    enabled, skipped, processed: 0, progressed: 0, succeeded: 0, failed: 0, timedOut: 0,
    settled: 0, refunded: 0, refundedCredits: 0, held: 0, archived: 0, notified: 0, emailed: 0,
    claimLost: 0, backlog: countInFlightJobsTotal(), errors: [],
  };
}

let activeTick: Promise<WorkerTickResult> | null = null;

/**
 * One worker pass. Serialized per process: a browser accelerator, the in-process timer
 * and an operator tick can all ask for work, but only one pass runs at a time so the
 * upstream service is never hammered by overlapping sweeps.
 */
export function runJobWorker(options: { trigger?: WorkerTrigger; userId?: string; limit?: number; record?: boolean } = {}): Promise<WorkerTickResult> {
  const trigger = options.trigger || "scheduler";
  if (activeTick) return Promise.resolve(emptyTick(trigger, nowIso(), "busy", workerConfig().enabled));
  const tick = executeTick(options).finally(() => { activeTick = null; });
  activeTick = tick;
  return tick;
}

async function executeTick(options: { trigger?: WorkerTrigger; userId?: string; limit?: number; record?: boolean }): Promise<WorkerTickResult> {
  const trigger = options.trigger || "scheduler";
  const startedAt = nowIso();
  const config = workerConfig();
  // A member's own refresh and an operator's manual tick still work while the automatic
  // scheduler is switched off; the automatic pass is the only thing the flag gates.
  if (!config.enabled && trigger === "scheduler") return emptyTick(trigger, startedAt, "disabled", config.enabled);

  const result = emptyTick(trigger, startedAt, null, config.enabled);
  const limit = positiveInt(options.limit ?? config.batchSize, config.batchSize, 1, 100);
  const summary = {
    settled: 0, refunded: 0, refundedCredits: 0, held: 0, archived: 0, notified: 0, emailed: 0,
    timedOut: 0, claimLost: 0, progressed: 0, succeeded: 0, failed: 0,
  };

  const due = listPollableJobs({ limit, userId: options.userId });
  const advanced = await mapLimit(due, config.concurrency, async job => advanceJob(job, { trigger, config }));
  for (const item of advanced) {
    if (!item) continue;
    result.processed += 1;
    if (!item.claimed) { summary.claimLost += 1; continue; }
    if (item.transition === "progress") summary.progressed += 1;
    if (item.transition === "succeeded") summary.succeeded += 1;
    if (item.transition === "failed") summary.failed += 1;
    if (item.refunded > 0) { summary.refunded += 1; summary.refundedCredits += item.refunded; }
    if (item.chargeStatus === "settled") summary.settled += 1;
    if (item.chargeStatus === "reserved") summary.held += 1;
    if (item.archived) summary.archived += 1;
    if (item.notified) summary.notified += 1;
    if (item.emailed) summary.emailed += 1;
    if (item.error) result.errors.push({ jobId: item.jobId, message: item.error });
  }

  const timedOut = await sweepTimeouts({ userId: options.userId, limit, trigger, config });
  for (const item of timedOut) {
    result.processed += 1;
    summary.timedOut += 1;
    summary.failed += 1;
    if (item.refunded > 0) { summary.refunded += 1; summary.refundedCredits += item.refunded; }
    if (item.chargeStatus === "reserved") summary.held += 1;
    if (item.notified) summary.notified += 1;
    if (item.emailed) summary.emailed += 1;
  }

  result.progressed = summary.progressed;
  result.succeeded = summary.succeeded;
  result.failed = summary.failed;
  result.timedOut = summary.timedOut;
  result.settled = summary.settled;
  result.refunded = summary.refunded;
  result.refundedCredits = summary.refundedCredits;
  result.held = summary.held;
  result.archived = summary.archived;
  result.notified = summary.notified;
  result.emailed = summary.emailed;
  result.claimLost = summary.claimLost;
  result.finishedAt = nowIso();
  result.durationMs = new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime();
  result.backlog = countInFlightJobsTotal();
  result.errors = result.errors.slice(0, 10);

  if (options.record !== false) recordWorkerRun(result);
  return result;
}

/**
 * Move one job forward: ask the upstream service, store the truth, and close the
 * commercial side exactly once when the creation reaches a terminal state.
 */
export async function advanceJob(
  job: PollableJob | StoredJob,
  options: { trigger?: WorkerTrigger; claim?: boolean; config?: WorkerConfig } = {},
): Promise<JobAdvanceResult> {
  const config = options.config || workerConfig();
  const base: JobAdvanceResult = {
    jobId: job.id, claimed: true, transition: "none", chargeStatus: null,
    refunded: 0, notified: false, emailed: false, archived: false, error: null,
  };
  const pollState = readPollState(job.id);
  if (options.claim !== false) {
    if (!claimJobForPoll(job.id, pollState.updatedAt, nowIso())) return { ...base, claimed: false };
  }

  let remote: Awaited<ReturnType<typeof refreshJob>>;
  try {
    remote = await refreshJob({ ...job, updatedAt: pollState.updatedAt });
  } catch (error) {
    return await handlePollFailure(job, pollState, describeError(error), config);
  }

  const previousStatus = pollState.status;
  const details = { ...(remote.details || job.details || {}), pollErrors: 0, pollError: null, lastWorkerAt: nowIso(), lastWorkerTrigger: options.trigger || "scheduler" };
  const updated = updateJobRemote(job.id, { ...remote, details });
  if (!updated) return { ...base, claimed: false };

  if (updated.status === "succeeded" || updated.status === "failed") {
    // Closing a creation that an earlier pass already closed is a no-op: the charge
    // transition is state-guarded and the notification carries a dedupe key, so a
    // repeated pass, a worker restart or a member refresh cannot charge or notify twice.
    try {
      const outcome = await finalizeJob(updated, config);
      return { ...base, transition: updated.status === "succeeded" ? "succeeded" : "failed", ...outcome };
    } catch (error) {
      return { ...base, transition: updated.status === "succeeded" ? "succeeded" : "failed", error: describeError(error).slice(0, 300), ...(await chargeStateOf(updated.id)) };
    }
  }
  return { ...base, transition: updated.status === previousStatus ? "none" : "progress", ...(await chargeStateOf(updated.id)) };
}

async function chargeStateOf(jobId: string) {
  const charge = getChargeByJob(jobId);
  return { chargeStatus: charge?.status || null };
}

function readPollState(jobId: string) {
  const row = db.prepare("SELECT status, updated_at, attempts, details_json FROM jobs WHERE id=?").get(jobId) as any;
  let details: Record<string, unknown> = {};
  try { details = JSON.parse(row?.details_json || "{}"); } catch { details = {}; }
  return {
    exists: Boolean(row),
    status: String(row?.status || "") as StoredJob["status"],
    updatedAt: String(row?.updated_at || ""),
    attempts: Number(row?.attempts || 0),
    details,
  };
}

/**
 * A status query that failed is a transient problem, not a failed creation: the upstream
 * job may still be running. We count the failures, keep the member's credits frozen, and
 * only close the creation once the queries keep failing past the operator's limit.
 */
async function handlePollFailure(job: StoredJob, pollState: ReturnType<typeof readPollState>, message: string, config: WorkerConfig): Promise<JobAdvanceResult> {
  const errors = Number((pollState.details as any)?.pollErrors || 0) + 1;
  const details = {
    ...(pollState.details || {}),
    pollErrors: errors,
    pollError: message.slice(0, 500),
    pollErrorAt: nowIso(),
  };
  recordJobPoll(job.id, { details });

  if (errors < config.pollMaxErrors) {
    return { jobId: job.id, claimed: true, transition: "none", chargeStatus: getChargeByJob(job.id)?.status || null, refunded: 0, notified: false, emailed: false, archived: false, error: message.slice(0, 300) };
  }

  updateJobRemote(job.id, {
    status: "failed",
    error: `WORKER_POLL_FAILED: 连续 ${errors} 次查询创作状态失败，任务已按平台异常处理。最后错误：${message}`.slice(0, 900),
    details: { ...details, workerClosed: "poll_failed" },
  });
  const closed = getJob(job.id);
  if (!closed) return { jobId: job.id, claimed: true, transition: "failed", chargeStatus: null, refunded: 0, notified: false, emailed: false, archived: false, error: message.slice(0, 300) };
  const outcome = await finalizeJob(closed, config);
  return { jobId: job.id, claimed: true, transition: "failed", ...outcome };
}

/**
 * Close creations that stopped moving (§20 超时任务处理). A member must never be left
 * with a job that hangs forever and credits that stay frozen forever.
 */
async function sweepTimeouts(options: { userId?: string; limit: number; trigger: WorkerTrigger; config: WorkerConfig }): Promise<Array<JobAdvanceResult & { transition: "timeout" }>> {
  const cutoff = new Date(Date.now() - options.config.timeoutMinutes * 60_000).toISOString();
  const stalled = listStalledJobs(cutoff, { limit: options.limit, userId: options.userId });
  const results: Array<JobAdvanceResult & { transition: "timeout" }> = [];
  for (const job of stalled) {
    const pollState = readPollState(job.id);
    if (!pollState.exists) continue;
    if (!claimJobForPoll(job.id, pollState.updatedAt, nowIso())) continue;
    // An `unknown` upstream state means we do not actually know whether the video was
    // produced. Closing it as a platform failure would refund a creation that may have
    // succeeded, so it goes to manual review instead: credits stay frozen and the
    // backoffice shows it as needing confirmation.
    const unresolved = pollState.status === "unknown";
    const errorText = unresolved
      ? `创作超过 ${options.config.timeoutMinutes} 分钟仍未拿到确定结果，已转人工确认，创作额度暂时保留。`
      : `WORKER_TIMEOUT: 创作超过 ${options.config.timeoutMinutes} 分钟仍未完成，已按平台异常处理并退回创作额度。`;
    const updated = updateJobRemote(job.id, {
      status: "failed",
      error: errorText,
      details: { ...(pollState.details || {}), workerClosed: unresolved ? "timeout_unresolved" : "timeout", timedOutAt: nowIso() },
    });
    if (!updated) continue;
    try {
      const outcome = await finalizeJob(updated, options.config, unresolved ? "unknown" : undefined);
      results.push({ jobId: job.id, claimed: true, transition: "timeout", ...outcome });
    } catch (error) {
      results.push({ jobId: job.id, claimed: true, transition: "timeout", chargeStatus: getChargeByJob(job.id)?.status || null, refunded: 0, notified: false, emailed: false, archived: false, error: describeError(error).slice(0, 300) });
    }
  }
  return results;
}

/**
 * Terminal handling for one creation: confirm or return credits once, record the cost,
 * notify the member, and archive a quick-creation result so the file survives.
 * Returns the commercial outcome so the tick can report it.
 */
async function finalizeJob(job: StoredJob, config: WorkerConfig, failureClass?: FailureClass): Promise<Omit<JobAdvanceResult, "jobId" | "claimed" | "transition">> {
  const outcome = { chargeStatus: null as string | null, refunded: 0, notified: false, emailed: false, archived: false, error: null as string | null };
  const succeeded = job.status === "succeeded";
  const charge = getChargeByJob(job.id);

  if (charge) {
    const durationSeconds = reportedDurationSeconds(job);
    const assessment = assessTaskCost({
      credits: charge.credits,
      estimatedCostCents: charge.estimatedCostCents,
      durationSeconds,
      succeeded,
    });
    const completed = completeJobCharge(job.id, {
      status: succeeded ? "succeeded" : (job.details as any)?.canceled === true ? "canceled" : "failed",
      errorText: job.error,
      stage: "processing",
      provider: providerLabel(job),
      actualCostCents: assessment.actualCostCents,
      failureClass,
    });
    recordTaskCost(charge.id, assessment);
    outcome.chargeStatus = completed.charge?.status || null;
    outcome.refunded = completed.refunded;
    outcome.error = completed.charge?.status === "reserved" ? "manual_review" : null;
  }

  const notified = notifyMember(job, succeeded, outcome.refunded);
  outcome.notified = notified.notification;
  if (notified.notification && config.notifyByEmail) {
    outcome.emailed = await emailMember(job, succeeded, outcome.refunded);
  }

  if (succeeded && shouldAutoArchive(job)) {
    outcome.archived = await autoArchiveQuickResult(job);
  }
  return outcome;
}

function notifyMember(job: StoredJob, succeeded: boolean, refunded: number) {
  if (!job.userId) return { notification: false };
  const state = businessJobStatus(job);
  const title = succeeded ? "创作已经完成" : state.label;
  const reason = succeeded ? "" : publicErrorMessage(job.error);
  const creditLine = refunded > 0 ? `本次预扣的 ${refunded} 个创作额度已经退回。` : "";
  const body = [
    `「${job.title}」${succeeded ? "已经完成，可以查看或下载。" : reason || "本次创作没有完成，你可以重新尝试。"}`,
    creditLine,
  ].filter(Boolean).join(creditLine ? "\n" : "");
  const created = createNotification({
    userId: job.userId,
    type: succeeded ? "job_done" : "job_failed",
    title,
    body,
    link: "/studio",
    dedupeKey: `${succeeded ? "job_done" : "job_failed"}:${job.id}`,
  });
  return { notification: Boolean(created) };
}

async function emailMember(job: StoredJob, succeeded: boolean, refunded: number): Promise<boolean> {
  if (!job.userId) return false;
  // Email is an extra channel, never the only one, and only for members who asked for it.
  if (!readPreferences(job.userId).email) return false;
  const row = db.prepare("SELECT email, name FROM users WHERE id=?").get(job.userId) as { email?: string; name?: string } | undefined;
  if (!row?.email) return false;
  const site = siteName();
  const baseUrl = publicBaseUrl();
  const reason = succeeded ? "" : publicErrorMessage(job.error);
  const text = [
    `${row.name || "你好"}，`,
    "",
    succeeded
      ? `你在 ${site} 的创作「${job.title}」已经完成，登录后可以查看和下载。`
      : `你在 ${site} 的创作「${job.title}」没有完成。${reason || "你可以重新尝试。"}`,
    refunded > 0 ? `本次预扣的 ${refunded} 个创作额度已经退回你的账户。` : "",
    "",
    `查看创作：${baseUrl}/studio`,
    "",
    `${site}`,
  ].filter(line => line !== null).join("\n").replace(/\n{3,}/g, "\n\n");
  const result = await sendEmail({
    to: row.email,
    subject: succeeded ? `你的创作已经完成 · ${site}` : `你的创作没有完成 · ${site}`,
    text,
    kind: "notification",
    userId: job.userId,
  });
  return result.status === "sent" || result.status === "outbox";
}

// ---------- quick-creation archiving (moved here from the browser refresh route) ----------

function shouldAutoArchive(job: StoredJob) {
  if (job.status !== "succeeded") return false;
  if (!(job.request as any)?._quickCreation) return false;
  return firstVideoOutputIndex(job.outputs) >= 0 && !job.outputs[firstVideoOutputIndex(job.outputs)]?.archivedFile;
}

async function autoArchiveQuickResult(job: StoredJob): Promise<boolean> {
  const index = firstVideoOutputIndex(job.outputs);
  if (index < 0) return false;
  try {
    const latestBefore = getJob(job.id);
    if (!latestBefore) return false;
    const latestIndex = firstVideoOutputIndex(latestBefore.outputs);
    if (latestIndex >= 0 && latestBefore.outputs[latestIndex]?.archivedFile) {
      markArchiveSaved(latestBefore);
      return true;
    }
    const archived = await archiveJobOutput(latestBefore, latestIndex >= 0 ? latestIndex : index);
    const outputIndex = latestIndex >= 0 ? latestIndex : index;
    const outputs = latestBefore.outputs.map((item, currentIndex) => currentIndex === outputIndex ? archived : item);
    updateJobRemote(latestBefore.id, {
      outputs,
      details: { ...(latestBefore.details || {}), quickArchive: "saved", quickArchiveError: null },
    });
    return true;
  } catch (error) {
    // A member's own refresh can legitimately reach the same succeeded job while this
    // archive is still running. Re-read before marking it pending so a stale concurrent
    // pass cannot overwrite a successful archive state.
    const latest = getJob(job.id);
    if (!latest) return false;
    const latestIndex = firstVideoOutputIndex(latest.outputs);
    if (latestIndex >= 0 && latest.outputs[latestIndex]?.archivedFile) {
      markArchiveSaved(latest);
      return true;
    }
    updateJobRemote(latest.id, {
      details: { ...(latest.details || {}), quickArchive: "pending", quickArchiveError: describeError(error).slice(0, 400) },
    });
    return false;
  }
}

function markArchiveSaved(job: StoredJob) {
  updateJobRemote(job.id, { details: { ...(job.details || {}), quickArchive: "saved", quickArchiveError: null } });
}

function firstVideoOutputIndex(outputs: ResultMedia[]) {
  const exact = outputs.findIndex(output => output.kind === "video");
  if (exact >= 0) return exact;
  return outputs.findIndex(output => /\.(mp4|mov|webm)(\?|$)/i.test(String(output.outputUrl || "")));
}

// ---------- run bookkeeping and health ----------

function recordWorkerRun(result: WorkerTickResult) {
  db.prepare(`INSERT INTO worker_runs (id, kind, trigger, started_at, finished_at, processed, succeeded, failed, detail_json)
    VALUES (?, 'jobs', ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      randomUUID(), result.trigger, result.startedAt, result.finishedAt,
      result.processed, result.succeeded, result.failed,
      JSON.stringify({
        settled: result.settled, refunded: result.refunded, refundedCredits: result.refundedCredits,
        held: result.held, timedOut: result.timedOut, archived: result.archived, notified: result.notified,
        emailed: result.emailed, claimLost: result.claimLost, backlog: result.backlog,
        durationMs: result.durationMs, skipped: result.skipped, errors: result.errors.slice(0, 5),
      }),
    );
  db.prepare("DELETE FROM worker_runs WHERE kind='jobs' AND started_at < ?").run(new Date(Date.now() - 14 * 86_400_000).toISOString());
}

export interface WorkerRunRow {
  id: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  processed: number;
  succeeded: number;
  failed: number;
  detail: Record<string, unknown>;
}

export function listWorkerRuns(limit = 20): WorkerRunRow[] {
  const rows = db.prepare("SELECT * FROM worker_runs WHERE kind='jobs' ORDER BY started_at DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 200)) as any[];
  return rows.map(row => {
    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(row.detail_json || "{}"); } catch { detail = {}; }
    return {
      id: row.id, trigger: row.trigger, startedAt: row.started_at, finishedAt: row.finished_at || null,
      processed: Number(row.processed || 0), succeeded: Number(row.succeeded || 0), failed: Number(row.failed || 0), detail,
    };
  });
}

/**
 * Operations health (§46): an admin must see a stopped worker, a growing backlog or a
 * service failing repeatedly in the backoffice, not in a server log.
 */
export function workerHealth() {
  const config = workerConfig();
  const runs = listWorkerRuns(10);
  const last = runs[0] || null;
  const lastFinishedAt = last?.finishedAt || last?.startedAt || null;
  const sinceMs = lastFinishedAt ? Date.now() - new Date(lastFinishedAt).getTime() : null;
  const staleAfterMs = Math.max(config.intervalSeconds * 3, 120) * 1000;
  const last24h = new Date(Date.now() - 86_400_000).toISOString();
  const timedOut24h = Number((db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status='failed' AND updated_at >= ? AND (error LIKE 'WORKER_TIMEOUT%' OR error LIKE '%workerClosed%')").get(last24h) as any)?.c || 0);
  const unresolved24h = Number((db.prepare("SELECT COUNT(*) AS c FROM task_charges WHERE status='reserved' AND updated_at >= ?").get(last24h) as any)?.c || 0);
  const consecutiveFailures = runs.reduce((count, run) => (run.failed > 0 && run.succeeded === 0 ? count + 1 : 0), 0);
  return {
    ...config,
    running: Boolean(activeTick),
    lastRunAt: last?.startedAt || null,
    lastRunTrigger: last?.trigger || null,
    lastRunDurationMs: Number((last?.detail as any)?.durationMs || 0),
    lastRun: last ? { processed: last.processed, succeeded: last.succeeded, failed: last.failed, detail: last.detail } : null,
    secondsSinceLastRun: sinceMs === null ? null : Math.round(sinceMs / 1000),
    // Only an enabled scheduler that stopped reporting is an incident; a disabled one is a choice.
    stopped: config.enabled && (sinceMs === null || sinceMs > staleAfterMs),
    staleAfterSeconds: Math.round(staleAfterMs / 1000),
    backlog: countInFlightJobsTotal(),
    strugglingJobs: countStrugglingJobs(3),
    timedOut24h,
    unresolvedCharges24h: unresolved24h,
    consecutiveFailingRuns: consecutiveFailures,
    runs,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => run()));
  return results;
}

// ---------- in-process scheduler ----------

let loopTimer: ReturnType<typeof setTimeout> | null = null;
let loopStarted = false;

/**
 * Start the unattended loop. Called once from `instrumentation.ts` when the Node server
 * boots; the timer is unref'd so it can never keep the process alive, and the interval is
 * re-read every pass so an operator can retune or pause it without a restart.
 */
export function startJobWorkerLoop(): { started: boolean; reason?: string } {
  if (loopStarted) return { started: false, reason: "already_started" };
  loopStarted = true;
  const schedule = () => {
    const config = workerConfig();
    // While disabled, check back slowly so re-enabling in the backoffice takes effect
    // without a redeploy.
    const delayMs = (config.enabled ? config.intervalSeconds : Math.max(config.intervalSeconds, 30)) * 1000;
    loopTimer = setTimeout(() => {
      runJobWorker({ trigger: "scheduler" })
        .catch(error => console.error("[worker] job sweep failed:", describeError(error)))
        .finally(schedule);
    }, delayMs);
    loopTimer.unref?.();
  };
  schedule();
  return { started: true };
}

export function stopJobWorkerLoop(): boolean {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  const was = loopStarted;
  loopStarted = false;
  return was;
}
