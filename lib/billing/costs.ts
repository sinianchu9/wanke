import "server-only";
import { db } from "@/lib/db";
import { getNumberSetting } from "@/lib/system-settings";
import { listPlans } from "@/lib/billing/catalog";

/**
 * Task cost and margin (§23).
 *
 * A commercial video platform has to know whether it is losing money on each creation.
 * The record lives on `task_charges` — the row that already knows the job, the credits
 * and the estimated cost — so there is exactly one cost truth per creation:
 *
 *   kind / credits (what the member spent) / user_value_cents (what that was worth)
 *   estimated_cost_cents (our estimate before submit) / actual_cost_cents + cost_source
 *   (what it really cost, only when the upstream reports usage and the operator has
 *   entered an internal unit price) / provider / created_at.
 *
 * `cost_source` is the honesty switch: `actual` only for numbers derived from real
 * upstream usage, `estimated` when we only have our own quote, `unknown` when neither
 * exists. Estimates are never presented as real costs.
 */

export type CostSource = "actual" | "estimated" | "unknown";

export const COST_SOURCE_COPY: Record<CostSource, string> = {
  actual: "实际成本",
  estimated: "预估",
  unknown: "暂无成本数据",
};

/** Internal price of one second of generated video, in cents. 0 = we do not know yet. */
export function costPerSecondCents(): number {
  const value = Math.round(getNumberSetting("cost_per_video_second_cents", 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * What one creation credit is worth in cents, derived from the catalog: the cheapest
 * price at which a member can actually buy credits today. No price is hardcoded here,
 * so a catalog change moves the reported value with it.
 */
export function creditUnitValueCents(): { cents: number; basis: string } {
  const packs = listPlans({ kind: "quota_pack" }).filter(plan => plan.purchasable && plan.credits > 0 && plan.priceCents > 0);
  const memberships = listPlans({ kind: "membership" }).filter(plan => plan.purchasable && plan.credits > 0 && plan.priceCents > 0);
  const cheapest = (plans: typeof packs) => plans.reduce((best, plan) => {
    const unit = Math.ceil(plan.priceCents / plan.credits);
    return best === null || unit < best.unit ? { unit, plan } : best;
  }, null as null | { unit: number; plan: (typeof packs)[number] });

  const pack = cheapest(packs);
  if (pack) return { cents: pack.unit, basis: `额度加油包「${pack.plan.name}」` };
  const membership = cheapest(memberships);
  if (membership) return { cents: membership.unit, basis: `会员套餐「${membership.plan.name}」` };
  return { cents: 0, basis: "商品目录里还没有可购买的创作额度" };
}

export function userValueCents(credits: number): number {
  return Math.max(0, Math.round(credits)) * creditUnitValueCents().cents;
}

/** Seconds of video the upstream really produced, when it reports usage at all. */
export function reportedDurationSeconds(job: { details?: Record<string, unknown> | null; request?: Record<string, unknown> | null }): number | null {
  const usage = (job.details?.usage || null) as Record<string, unknown> | null;
  if (!usage || typeof usage !== "object") return null;
  const direct = Number(usage.video_duration ?? usage.videoDuration ?? usage.duration ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const count = Number(usage.video_count ?? usage.videoCount ?? 0);
  const perUnit = Number((job.request as any)?.duration ?? (job.details as any)?.effectiveDuration ?? 0);
  if (Number.isFinite(count) && count > 0 && Number.isFinite(perUnit) && perUnit > 0) return Math.round(count * perUnit);
  return null;
}

export interface TaskCostAssessment {
  actualCostCents: number | null;
  costSource: CostSource;
  durationSeconds: number | null;
  userValueCents: number;
}

/** Decide what we can honestly record about one finished creation. */
export function assessTaskCost(input: {
  credits: number;
  estimatedCostCents: number;
  durationSeconds: number | null;
  succeeded: boolean;
}): TaskCostAssessment {
  const rate = costPerSecondCents();
  const seconds = input.durationSeconds;
  const canMeasure = input.succeeded && rate > 0 && seconds !== null && seconds > 0;
  return {
    actualCostCents: canMeasure ? Math.round(rate * (seconds as number)) : null,
    costSource: canMeasure ? "actual" : input.estimatedCostCents > 0 ? "estimated" : "unknown",
    durationSeconds: seconds,
    userValueCents: userValueCents(input.credits),
  };
}

/** Persist the cost side of a charge. Safe to run repeatedly: it only overwrites with the same facts. */
export function recordTaskCost(chargeId: string, assessment: TaskCostAssessment): void {
  db.prepare(`UPDATE task_charges
    SET user_value_cents=?, cost_source=?, duration_seconds=?,
        actual_cost_cents=COALESCE(?, actual_cost_cents)
    WHERE id=?`)
    .run(
      Math.max(0, Math.round(assessment.userValueCents)),
      assessment.costSource,
      assessment.durationSeconds,
      assessment.actualCostCents,
      chargeId,
    );
}

export interface TaskCostRow {
  chargeId: string;
  jobId: string | null;
  userId: string;
  email: string;
  kind: string;
  status: string;
  credits: number;
  userValueCents: number;
  estimatedCostCents: number;
  actualCostCents: number | null;
  costSource: CostSource;
  durationSeconds: number | null;
  provider: string;
  createdAt: string;
}

/** §23 任务成本记录: one row per creation, with the value the member paid and our cost. */
export function listTaskCosts(filter: { userId?: string; sinceIso?: string; limit?: number; offset?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) { where.push("c.user_id=?"); params.push(filter.userId); }
  if (filter.sinceIso) { where.push("c.created_at >= ?"); params.push(filter.sinceIso); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = db.prepare(`
    SELECT c.*, u.email FROM task_charges c LEFT JOIN users u ON u.id = c.user_id
    ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];
  const total = Number((db.prepare(`SELECT COUNT(*) AS c FROM task_charges c ${whereSql}`).get(...params) as any).c || 0);
  return {
    total,
    unitValue: creditUnitValueCents(),
    costs: rows.map(row => ({
      chargeId: row.id,
      jobId: row.job_id || null,
      userId: row.user_id,
      email: row.email || "",
      kind: row.kind,
      status: row.status,
      credits: Number(row.credits || 0),
      userValueCents: Number(row.user_value_cents || 0),
      estimatedCostCents: Number(row.estimated_cost_cents || 0),
      actualCostCents: row.actual_cost_cents === null || row.actual_cost_cents === undefined ? null : Number(row.actual_cost_cents),
      costSource: (row.cost_source || "unknown") as CostSource,
      durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined ? null : Number(row.duration_seconds),
      provider: row.provider || "",
      createdAt: row.created_at,
    } as TaskCostRow)),
  };
}

function readTotals(whereSql: string, params: unknown[]) {
  const row = db.prepare(`
    SELECT COUNT(*) AS jobs,
      COALESCE(SUM(c.credits),0) AS credits,
      COALESCE(SUM(c.user_value_cents),0) AS value_cents,
      COALESCE(SUM(c.estimated_cost_cents),0) AS estimated_cents,
      COALESCE(SUM(c.actual_cost_cents),0) AS actual_cents,
      COALESCE(SUM(CASE WHEN c.cost_source='actual' THEN 1 ELSE 0 END),0) AS measured_jobs,
      COALESCE(SUM(COALESCE(c.actual_cost_cents, c.estimated_cost_cents)),0) AS reported_cents
    FROM task_charges c ${whereSql}
  `).get(...params) as any;
  const jobs = Number(row?.jobs || 0);
  const measuredJobs = Number(row?.measured_jobs || 0);
  const estimatedCents = Number(row?.estimated_cents || 0);
  const coverage = jobs > 0 ? measuredJobs / jobs : 0;
  const reportedCents = Number(row?.reported_cents || 0);
  return {
    jobs,
    credits: Number(row?.credits || 0),
    userValueCents: Number(row?.value_cents || 0),
    estimatedCents,
    actualCents: Number(row?.actual_cents || 0),
    measuredJobs,
    /** The number we can defend: measured cost where we have it, estimate where we do not. */
    reportedCents,
    averageCents: jobs > 0 ? Math.round(reportedCents / jobs) : 0,
    basis: (coverage >= 1 && jobs > 0 ? "actual" : estimatedCents > 0 || measuredJobs > 0 ? "estimated" : "unknown") as CostSource,
  } as CostTotals;
}

export interface CostTotals {
  jobs: number;
  credits: number;
  userValueCents: number;
  estimatedCents: number;
  actualCents: number;
  measuredJobs: number;
  reportedCents: number;
  averageCents: number;
  basis: CostSource;
}

export function costTotals(sinceIso?: string, userId?: string): CostTotals {
  const where: string[] = ["c.status <> 'voided'"];
  const params: unknown[] = [];
  if (sinceIso) { where.push("c.created_at >= ?"); params.push(sinceIso); }
  if (userId) { where.push("c.user_id=?"); params.push(userId); }
  return readTotals(`WHERE ${where.join(" AND ")}`, params);
}
