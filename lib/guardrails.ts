import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { getNumberSetting } from "@/lib/system-settings";
import { countInFlightJobs } from "@/lib/repository";
import { currentPlan } from "@/lib/membership";

/**
 * Creation cost protection (§48).
 *
 * Video generation costs real money the moment it is submitted, so every submit path
 * passes through here before a single credit is reserved. The limits come from the
 * member's own plan plus operator-tunable bounds, and they are deliberately loose for
 * paying members: the goal is to stop runaway scripts and accidental loops, not to
 * make a normal creator wait.
 *
 * Blocked attempts are recorded (`guard_events`) because a rejected submit leaves no
 * charge row behind — without this table the backoffice could not see an attack.
 */

export type GuardKind = "batch_size" | "concurrent_jobs" | "submit_burst" | "submit_rate";

export interface GuardLimits {
  planId: string;
  planName: string;
  freeTier: boolean;
  concurrentJobs: number;
  maxBatchSize: number;
  submitsPerMinute: number;
  burstWindowSeconds: number;
  burstMaxSubmits: number;
}

const GUARD_COPY: Record<GuardKind, string> = {
  batch_size: "单次提交的创作数量太多，请减少数量后再试。",
  concurrent_jobs: "当前同时进行的创作已经达到上限，等它们完成后就可以继续创作。",
  submit_burst: "提交得太快了，请稍等几秒再继续。",
  submit_rate: "这一分钟提交的创作有点多，请稍等片刻再继续。",
};

export const GUARD_ERROR_CODE: Record<GuardKind, string> = {
  batch_size: "BATCH_TOO_LARGE",
  concurrent_jobs: "CONCURRENT_JOB_LIMIT",
  submit_burst: "SUBMIT_TOO_FAST",
  submit_rate: "SUBMIT_RATE_LIMIT",
};

function intSetting(key: string, fallback: number, min: number, max: number) {
  const value = Math.round(getNumberSetting(key, fallback));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function guardLimits(userId: string): GuardLimits {
  const plan = currentPlan(userId);
  const floor = intSetting("guard_min_concurrent_jobs", 2, 1, 100);
  const ceiling = intSetting("guard_max_concurrent_jobs", 12, floor, 1000);
  const planConcurrent = Math.round(Number(plan.maxConcurrentJobs || 0));
  const freeTier = Number(plan.priceCents || 0) <= 0;
  return {
    planId: plan.id,
    planName: plan.name,
    freeTier,
    // The plan decides the tier; the bounds keep an operator mistake from either
    // locking everybody out or removing the cost protection entirely.
    concurrentJobs: Math.min(ceiling, Math.max(floor, planConcurrent)),
    maxBatchSize: intSetting("guard_max_batch_size", 8, 1, 100),
    submitsPerMinute: intSetting(freeTier ? "guard_free_max_submits_per_minute" : "guard_max_submits_per_minute", freeTier ? 4 : 12, 1, 1000),
    burstWindowSeconds: intSetting("guard_burst_window_seconds", 10, 1, 300),
    burstMaxSubmits: intSetting("guard_burst_max_submits", 5, 2, 1000),
  };
}

/** Submits in a window, counted from charge rows: one submit always writes exactly one. */
function submitsSince(userId: string, sinceIso: string): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=? AND created_at >= ?").get(userId, sinceIso) as any;
  return Number(row?.c || 0);
}

export function recordGuardEvent(userId: string | null, kind: GuardKind | string, reason: string, detail: Record<string, unknown> = {}) {
  db.prepare("INSERT INTO guard_events (id, user_id, kind, reason, detail_json, created_at) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), userId, kind, reason.slice(0, 300), JSON.stringify(detail), new Date().toISOString());
}

/**
 * Refuse a submission before any credit moves. `quantity` is the whole submission
 * (one version, a batch, or every shot of a quick creation plan).
 */
export function assertSubmitAllowed(userId: string, input: { quantity?: number; kind?: string } = {}): GuardLimits {
  const quantity = Math.max(1, Math.round(input.quantity ?? 1));
  const limits = guardLimits(userId);
  const block = (kind: GuardKind, detail: Record<string, unknown>) => {
    recordGuardEvent(userId, kind, GUARD_COPY[kind], { ...detail, jobKind: input.kind || "", plan: limits.planId });
    throw new HttpError(kind === "batch_size" ? 400 : 429, GUARD_ERROR_CODE[kind], guardMessage(kind, limits, detail));
  };

  if (quantity > limits.maxBatchSize) {
    block("batch_size", { quantity, limit: limits.maxBatchSize });
  }

  const inFlight = countInFlightJobs(userId);
  if (inFlight >= limits.concurrentJobs) {
    block("concurrent_jobs", { inFlight, limit: limits.concurrentJobs });
  }

  const now = Date.now();
  const burstWindow = limits.burstWindowSeconds * 1000;
  const burstCount = submitsSince(userId, new Date(now - burstWindow).toISOString());
  if (burstCount + quantity > limits.burstMaxSubmits && burstCount > 0) {
    block("submit_burst", { windowSeconds: limits.burstWindowSeconds, recent: burstCount, limit: limits.burstMaxSubmits });
  }

  const minuteCount = submitsSince(userId, new Date(now - 60_000).toISOString());
  if (minuteCount + quantity > limits.submitsPerMinute) {
    block("submit_rate", { recent: minuteCount, limit: limits.submitsPerMinute });
  }

  return limits;
}

function guardMessage(kind: GuardKind, limits: GuardLimits, detail: Record<string, unknown>) {
  if (kind === "batch_size") return `单次最多提交 ${limits.maxBatchSize} 个创作版本，请减少数量后再试。`;
  if (kind === "concurrent_jobs") {
    return `当前同时进行的创作已经有 ${detail.inFlight} 个，达到「${limits.planName}」的上限 ${limits.concurrentJobs} 个。等它们完成后就可以继续创作，升级会员可以同时创作更多。`;
  }
  if (kind === "submit_burst") return `提交得太快了（${limits.burstWindowSeconds} 秒内最多 ${limits.burstMaxSubmits} 次），请稍等几秒再继续。`;
  return `这一分钟提交的创作有点多（上限 ${limits.submitsPerMinute} 次），请稍等片刻再继续。`;
}

/** Per-user cost alarm (§48 单用户成本异常报警) for one calendar day. */
export function userCostAlerts(dayStartIso: string) {
  const threshold = intSetting("guard_user_daily_cost_cents", 2000, 0, 100_000_000);
  const rows = db.prepare(`
    SELECT c.user_id, u.email, COUNT(*) AS jobs,
      COALESCE(SUM(c.estimated_cost_cents),0) AS estimated_cents,
      COALESCE(SUM(COALESCE(c.actual_cost_cents, c.estimated_cost_cents)),0) AS reported_cents,
      COALESCE(SUM(c.credits),0) AS credits
    FROM task_charges c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.created_at >= ? AND c.status <> 'voided'
    GROUP BY c.user_id
    ORDER BY reported_cents DESC LIMIT 20
  `).all(dayStartIso) as any[];
  return rows.map(row => ({
    userId: row.user_id,
    email: row.email || "",
    jobs: Number(row.jobs || 0),
    credits: Number(row.credits || 0),
    estimatedCents: Number(row.estimated_cents || 0),
    reportedCents: Number(row.reported_cents || 0),
    // `threshold === 0` means the operator turned the alarm off.
    alarmed: threshold > 0 && Number(row.reported_cents || 0) >= threshold,
  }));
}

/** What the backoffice needs to see an abuse pattern instead of guessing (§46). */
export function guardStats(sinceIso: string) {
  const rows = db.prepare("SELECT kind, COUNT(*) AS c FROM guard_events WHERE created_at >= ? GROUP BY kind").all(sinceIso) as any[];
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byKind[row.kind] = Number(row.c || 0);
    total += Number(row.c || 0);
  }
  const topRows = db.prepare(`
    SELECT g.user_id, u.email, COUNT(*) AS c, MAX(g.created_at) AS last_at
    FROM guard_events g LEFT JOIN users u ON u.id = g.user_id
    WHERE g.created_at >= ? AND g.user_id IS NOT NULL
    GROUP BY g.user_id ORDER BY c DESC LIMIT 5
  `).all(sinceIso) as any[];
  const lastRow = db.prepare("SELECT kind, reason, created_at FROM guard_events ORDER BY created_at DESC LIMIT 1").get() as any;
  return {
    blocked: total,
    byKind,
    topUsers: topRows.map(row => ({ userId: row.user_id, email: row.email || "", blocked: Number(row.c || 0), lastAt: row.last_at })),
    last: lastRow ? { kind: lastRow.kind, reason: lastRow.reason, createdAt: lastRow.created_at } : null,
    costAlerts: userCostAlerts(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()).filter(item => item.alarmed),
  };
}

export function listGuardEvents(limit = 100) {
  const rows = db.prepare(`
    SELECT g.*, u.email FROM guard_events g LEFT JOIN users u ON u.id = g.user_id
    ORDER BY g.created_at DESC LIMIT ?
  `).all(Math.min(Math.max(limit, 1), 500)) as any[];
  return rows.map(row => {
    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(row.detail_json || "{}"); } catch { detail = {}; }
    return {
      id: row.id, userId: row.user_id, email: row.email || "", kind: row.kind,
      reason: row.reason, detail, createdAt: row.created_at,
    };
  });
}
