import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { JOB_KIND_LABELS, type JobKind, type JobStatus, type ResultMedia, type StoredAsset, type StoredJob } from "@/lib/types";

const parse = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

function rowToJob(row: any): StoredJob {
  return {
    id: row.id,
    userId: row.user_id || null,
    kind: row.kind,
    title: row.title,
    providerJobId: row.provider_job_id,
    status: row.status,
    request: parse(row.request_json, {}),
    provider: parse(row.provider_json, null),
    outputs: parse<ResultMedia[]>(row.output_json, []),
    details: parse(row.details_json, null),
    error: row.error,
    requestId: row.request_id,
    parentJobId: row.parent_job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function rowToAsset(row: any): StoredAsset {
  return {
    id: row.id,
    userId: row.user_id || null,
    providerMediaId: row.provider_media_id,
    name: row.name,
    mediaType: row.media_type,
    sourceUrl: row.source_url,
    provider: parse(row.provider_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(input: {
  kind: JobKind;
  title?: string;
  request: Record<string, unknown>;
  parentJobId?: string | null;
  userId?: string | null;
}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO jobs
    (id, kind, title, status, request_json, output_json, parent_job_id, user_id, created_at, updated_at)
    VALUES (?, ?, ?, 'queued', ?, '[]', ?, ?, ?, ?)`) 
    .run(id, input.kind, input.title?.trim() || defaultTitle(input.kind), JSON.stringify(input.request), input.parentJobId || null, input.userId || null, now, now);

  if (input.parentJobId) {
    const membership = db.prepare("SELECT shot_id FROM shot_jobs WHERE job_id=?").get(input.parentJobId) as any;
    if (membership?.shot_id) {
      db.prepare("INSERT OR IGNORE INTO shot_jobs (shot_id,job_id,created_at) VALUES (?,?,?)").run(membership.shot_id, id, now);
      db.prepare("UPDATE shots SET updated_at=? WHERE id=?").run(now, membership.shot_id);
      db.prepare("UPDATE projects SET updated_at=? WHERE id=(SELECT project_id FROM shots WHERE id=?)").run(now, membership.shot_id);
    }
  }

  return getJob(id)!;
}

export function getJob(id: string): StoredJob | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return row ? rowToJob(row) : null;
}

export function listJobs(limit = 100): StoredJob[] {
  return (db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as any[]).map(rowToJob);
}

export function listJobsForUser(userId: string, limit = 100): StoredJob[] {
  return (db.prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as any[]).map(rowToJob);
}

/** Ownership-aware lookup: owners see their jobs, admins see everything, others see nothing. */
export function getJobForUser(id: string, userId: string, isAdmin = false): StoredJob | null {
  const job = getJob(id);
  if (!job) return null;
  if (!isAdmin && job.userId !== userId) return null;
  return job;
}

/** A job still in flight, plus the server-side poll bookkeeping the worker owns. */
export type PollableJob = StoredJob & { attempts: number; lastPollAt: string | null };

function rowToPollableJob(row: any): PollableJob {
  return { ...rowToJob(row), attempts: Number(row.attempts || 0), lastPollAt: row.last_poll_at || null };
}

const IN_FLIGHT_STATUSES = "('queued','running','unknown')";

/** Minimum gap between two upstream status queries for one job. */
export function pollIntervalMs(job: StoredJob, now = Date.now()) {
  const ageMs = Math.max(0, now - new Date(job.createdAt).getTime());
  const isModelStudio = job.details?.engine === "modelstudio";
  // Alibaba recommends roughly 15s polling for async video jobs. Keep the faster 6s cadence
  // only for legacy Yike jobs, which already used that behavior before the provider split.
  let minInterval = isModelStudio
    ? (ageMs < 5 * 60_000 ? 15_000 : 30_000)
    : (ageMs < 60_000 ? 6_000 : ageMs < 5 * 60_000 ? 15_000 : 30_000);
  if (job.status === "unknown") minInterval = Math.max(minInterval, 30_000);
  return minInterval;
}

function dueForPoll(job: PollableJob, now: number) {
  if (job.details?.pollable === false) return false;
  const sinceUpdateMs = Math.max(0, now - new Date(job.updatedAt).getTime());
  return sinceUpdateMs >= pollIntervalMs(job, now);
}

export function listActiveJobs(limit = 20, userId?: string): StoredJob[] {
  return listPollableJobs({ limit, userId });
}

/**
 * Jobs the server worker should query now. A provider can temporarily return a status
 * Wanke does not recognize yet, so pollable `unknown` jobs stay in the recovery loop
 * instead of being silently dropped.
 */
export function listPollableJobs(options: { limit?: number; userId?: string; ignoreInterval?: boolean } = {}): PollableJob[] {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const now = Date.now();
  const rows = options.userId
    ? db.prepare(`SELECT * FROM jobs WHERE status IN ${IN_FLIGHT_STATUSES} AND provider_job_id IS NOT NULL AND user_id = ? ORDER BY updated_at ASC LIMIT 100`).all(options.userId)
    : db.prepare(`SELECT * FROM jobs WHERE status IN ${IN_FLIGHT_STATUSES} AND provider_job_id IS NOT NULL ORDER BY updated_at ASC LIMIT 100`).all();
  const candidates = (rows as any[]).map(rowToPollableJob);
  const due = options.ignoreInterval ? candidates : candidates.filter(job => dueForPoll(job, now));
  return due.slice(0, limit);
}

/**
 * In-flight jobs the worker must close (§20 超时任务处理), on either of two grounds:
 *
 *   created_at < cutoff  the creation has been alive longer than the operator's timeout,
 *                        even though we keep querying it successfully;
 *   updated_at < cutoff  it simply stopped moving — no upstream id, an upstream with no
 *                        query API, or nothing new for a long time.
 *
 * `updated_at` alone is not enough: every status query refreshes it, so a creation that
 * is polled forever but never finishes would never time out and the member's credits
 * would stay frozen forever. `created_at` is the age of the creation itself.
 */
export function listStalledJobs(cutoffIso: string, options: { limit?: number; userId?: string } = {}): PollableJob[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = options.userId
    ? db.prepare(`SELECT * FROM jobs WHERE status IN ${IN_FLIGHT_STATUSES} AND (created_at < ? OR updated_at < ?) AND user_id = ? ORDER BY updated_at ASC LIMIT ?`).all(cutoffIso, cutoffIso, options.userId, limit)
    : db.prepare(`SELECT * FROM jobs WHERE status IN ${IN_FLIGHT_STATUSES} AND (created_at < ? OR updated_at < ?) ORDER BY updated_at ASC LIMIT ?`).all(cutoffIso, cutoffIso, limit);
  return (rows as any[]).map(rowToPollableJob);
}

/**
 * Optimistic claim for one worker pass. Two schedulers (the in-process timer and an
 * operator/cron tick) can look at the same job; only the one whose `updated_at` still
 * matches owns it, so a job is never queried and finalized twice in parallel.
 */
export function claimJobForPoll(id: string, expectedUpdatedAt: string, claimedAt: string): boolean {
  const result = db.prepare(`UPDATE jobs SET last_poll_at=?, updated_at=?
    WHERE id=? AND updated_at=? AND status IN ${IN_FLIGHT_STATUSES}`)
    .run(claimedAt, claimedAt, id, expectedUpdatedAt);
  return result.changes === 1;
}

/** Bookkeeping for one upstream query that did not change the business status. */
export function recordJobPoll(id: string, patch: { attempts?: number; error?: string | null; details?: Record<string, unknown> | null } = {}): void {
  const current = getJob(id);
  if (!current) return;
  db.prepare(`UPDATE jobs SET attempts = attempts + 1, last_poll_at=?, details_json=? WHERE id=?`)
    .run(new Date().toISOString(), JSON.stringify(patch.details ?? current.details), id);
}

/** How many creations a member currently has in flight (§48 每用户同时任务数). */
export function countInFlightJobs(userId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE user_id=? AND status IN ${IN_FLIGHT_STATUSES}`).get(userId) as any;
  return Number(row?.c || 0);
}

/** Platform-wide backlog, for the operations dashboard (§46 任务积压). */
export function countInFlightJobsTotal(): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE status IN ${IN_FLIGHT_STATUSES}`).get() as any;
  return Number(row?.c || 0);
}

/** Jobs whose upstream query has been failing repeatedly, for the risk panel. */
export function countStrugglingJobs(minAttempts: number): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE status IN ${IN_FLIGHT_STATUSES} AND attempts >= ?`).get(minAttempts) as any;
  return Number(row?.c || 0);
}

export function updateJobRemote(id: string, patch: {
  providerJobId?: string | null;
  status?: JobStatus;
  provider?: Record<string, unknown> | null;
  outputs?: ResultMedia[];
  details?: Record<string, unknown> | null;
  error?: string | null;
  requestId?: string | null;
  finishedAt?: string | null;
}) {
  const current = getJob(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const status = patch.status ?? current.status;
  const finishedAt = patch.finishedAt !== undefined
    ? patch.finishedAt
    : (["succeeded", "failed"].includes(status) ? (current.finishedAt || now) : current.finishedAt);
  db.prepare(`UPDATE jobs SET
    provider_job_id=?, status=?, provider_json=?, output_json=?, details_json=?, error=?, request_id=?, updated_at=?, finished_at=?
    WHERE id=?`)
    .run(
      patch.providerJobId !== undefined ? patch.providerJobId : current.providerJobId,
      status,
      JSON.stringify(patch.provider !== undefined ? patch.provider : current.provider),
      JSON.stringify(patch.outputs !== undefined ? mergeOutputMetadata(current.outputs, patch.outputs) : current.outputs),
      JSON.stringify(patch.details !== undefined ? patch.details : current.details),
      patch.error !== undefined ? patch.error : current.error,
      patch.requestId !== undefined ? patch.requestId : current.requestId,
      now,
      finishedAt,
      id,
    );
  return getJob(id);
}

function mergeOutputMetadata(previous: ResultMedia[], next: ResultMedia[]) {
  return next.map((item, index) => {
    const old = previous.find(p => (item.mediaId && p.mediaId === item.mediaId) || (item.outputUrl && p.outputUrl === item.outputUrl)) || previous[index];
    if (!old) return item;
    return { ...item, ...(old.archivedFile ? { archivedFile: old.archivedFile } : {}), ...(old.archivedAt ? { archivedAt: old.archivedAt } : {}) };
  });
}

export function deleteJob(id: string) {
  const membership = db.prepare(`SELECT sj.shot_id, s.selected_job_id
    FROM shot_jobs sj
    JOIN shots s ON s.id = sj.shot_id
    WHERE sj.job_id=?`).get(id) as { shot_id?: string; selected_job_id?: string | null } | undefined;
  const invalidatesFinal = membership?.selected_job_id === id;
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    const changed = db.prepare("DELETE FROM jobs WHERE id=?").run(id).changes > 0;
    if (changed && invalidatesFinal && membership?.shot_id) {
      // FK cleanup already removes the selected relation. Only changing the adopted source
      // invalidates an existing final video; deleting an unused candidate must not create a
      // false “old final” warning.
      db.prepare("UPDATE shots SET updated_at=? WHERE id=?").run(now, membership.shot_id);
      db.prepare("UPDATE projects SET updated_at=? WHERE id=(SELECT project_id FROM shots WHERE id=?)").run(now, membership.shot_id);
    }
    return changed;
  });
  return transaction();
}

export function requestReferenceExists(value: string) {
  return Boolean(db.prepare("SELECT 1 FROM jobs WHERE request_json LIKE ? LIMIT 1").get(`%${value}%`));
}

export function createAsset(input: {
  providerMediaId?: string | null;
  name: string;
  mediaType: string;
  sourceUrl: string;
  provider?: Record<string, unknown> | null;
  userId?: string | null;
}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO assets
    (id, provider_media_id, name, media_type, source_url, provider_json, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
    .run(id, input.providerMediaId || null, input.name, input.mediaType, input.sourceUrl, JSON.stringify(input.provider || null), input.userId || null, now, now);
  return getAsset(id)!;
}

export function getAsset(id: string): StoredAsset | null {
  const row = db.prepare("SELECT * FROM assets WHERE id=?").get(id);
  return row ? rowToAsset(row) : null;
}

export function listAssets(limit = 300): StoredAsset[] {
  return (db.prepare("SELECT * FROM assets ORDER BY created_at DESC LIMIT ?").all(limit) as any[]).map(rowToAsset);
}

export function listAssetsForUser(userId: string, limit = 300): StoredAsset[] {
  return (db.prepare("SELECT * FROM assets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as any[]).map(rowToAsset);
}

export function getAssetForUser(id: string, userId: string, isAdmin = false): StoredAsset | null {
  const asset = getAsset(id);
  if (!asset) return null;
  if (!isAdmin && asset.userId !== userId) return null;
  return asset;
}

export function deleteAsset(id: string) {
  return db.prepare("DELETE FROM assets WHERE id=?").run(id).changes > 0;
}

function defaultTitle(kind: JobKind) {
  return JOB_KIND_LABELS[kind];
}
