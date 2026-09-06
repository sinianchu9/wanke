import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { getFreePlan, getPlan } from "@/lib/billing/catalog";

/**
 * Creation-credit authority.
 *
 * Invariants enforced here (and only here):
 * - Every balance change writes exactly one `quota_ledger` row with before/after.
 * - Every change carries an idempotency key with a UNIQUE index: a replayed worker
 *   tick, a double-clicked submit or a duplicated payment notification cannot move
 *   the balance twice.
 * - Balance mutations are single `BEGIN IMMEDIATE` transactions with conditional
 *   UPDATEs, so concurrent processes can never overdraw or double-spend.
 * - A charge has one lifecycle: reserved -> settled | refunded | voided. Terminal
 *   states are guarded by the UPDATE predicate, never by a prior read.
 */

export type LedgerReason =
  | "plan_grant"
  | "cycle_renewal"
  | "pack_purchase"
  | "job_reserve"
  | "job_refund"
  | "admin_grant"
  | "admin_deduct"
  | "order_refund_reclaim"
  | "activity_gift"
  | "migration_baseline";

export const LEDGER_REASON_COPY: Record<LedgerReason, string> = {
  plan_grant: "套餐到账",
  cycle_renewal: "新周期额度到账",
  pack_purchase: "购买创作额度",
  job_reserve: "创作消耗",
  job_refund: "创作退回",
  admin_grant: "平台补偿",
  admin_deduct: "平台调整",
  order_refund_reclaim: "订单退款回收",
  activity_gift: "活动赠送",
  migration_baseline: "历史用量结转",
};

export type ChargeStatus = "reserved" | "settled" | "refunded" | "voided";

export interface CreditBalance {
  planLimit: number;
  planUsed: number;
  planRemaining: number;
  bonus: number;
  available: number;
  periodStart: string;
  periodEnd: string;
  status: "active" | "expired" | "suspended";
}

export interface TaskCharge {
  id: string;
  userId: string;
  jobId: string | null;
  kind: string;
  credits: number;
  planCredits: number;
  bonusCredits: number;
  status: ChargeStatus;
  quote: Record<string, unknown>;
  estimatedCostCents: number;
  actualCostCents: number | null;
  provider: string;
  failureClass: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
  refundedAt: string | null;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: LedgerReason;
  reasonText: string;
  refType: string;
  refId: string;
  note: string;
  createdAt: string;
}

function nowIso() {
  return new Date().toISOString();
}

/** Top-level write transaction. Nested calls fall back to savepoints via better-sqlite3. */
export function writeTransaction<T>(fn: () => T): T {
  const wrapped = db.transaction(fn);
  return (wrapped as any).immediate();
}

function rowToBalance(row: any): CreditBalance {
  const planLimit = Number(row?.quota_limit_videos || 0);
  const planUsed = Number(row?.quota_used_videos || 0);
  const bonus = Number(row?.bonus_credits || 0);
  const planRemaining = Math.max(0, planLimit - planUsed);
  return {
    planLimit,
    planUsed,
    planRemaining,
    bonus,
    available: planRemaining + bonus,
    periodStart: row?.period_start || "",
    periodEnd: row?.period_end || "",
    status: row?.status || "active",
  };
}

export function readBalance(userId: string): CreditBalance | null {
  const row = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId);
  return row ? rowToBalance(row) : null;
}

export function ensureMembershipRow(userId: string, periodDays = 30): void {
  const existing = db.prepare("SELECT 1 FROM memberships WHERE user_id=?").get(userId);
  if (existing) return;
  const free = getFreePlan();
  const now = Date.now();
  db.prepare(`INSERT INTO memberships
    (user_id, plan, plan_id, status, quota_limit_videos, quota_used_videos, bonus_credits, period_start, period_end, updated_at)
    VALUES (?, ?, ?, 'active', ?, 0, 0, ?, ?, ?)`)
    .run(userId, free.id, free.id, free.credits, new Date(now).toISOString(),
      new Date(now + periodDays * 24 * 60 * 60 * 1000).toISOString(), new Date(now).toISOString());
}

/**
 * Lazy cycle renewal. When the paid/free cycle has ended the plan credits refresh and
 * the change is written to the ledger (unused credits do not silently disappear).
 * Bonus credits (packs, gifts, compensation) never expire with the cycle.
 */
export function renewCycleIfNeeded(userId: string): void {
  ensureMembershipRow(userId);
  const row = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
  if (!row) return;
  const now = Date.now();
  const periodEnd = new Date(row.period_end).getTime();
  if (periodEnd > now) return;
  const plan = getPlan(row.plan_id || row.plan) || getFreePlan();
  const validityDays = plan.validityDays > 0 ? plan.validityDays : 30;
  const dayMs = 24 * 60 * 60 * 1000;
  let start = periodEnd;
  let end = periodEnd + validityDays * dayMs;
  while (end <= now) {
    start = end;
    end += validityDays * dayMs;
  }
  const before = rowToBalance(row);
  writeTransaction(() => {
    const result = db.prepare(`UPDATE memberships
      SET plan=?, plan_id=?, quota_limit_videos=?, quota_used_videos=0, period_start=?, period_end=?, updated_at=?
      WHERE user_id=? AND period_end=?`)
      .run(plan.id, plan.id, plan.credits, new Date(start).toISOString(), new Date(end).toISOString(), nowIso(), userId, row.period_end);
    if (result.changes !== 1) return;
    const after = { ...before, planLimit: plan.credits, planUsed: 0, planRemaining: plan.credits, available: plan.credits + before.bonus };
    appendCreditLedger({
      userId,
      delta: after.available - before.available,
      balanceBefore: before.available,
      balanceAfter: after.available,
      reason: "cycle_renewal",
      refType: "membership",
      refId: userId,
      idempotencyKey: `cycle:${userId}:${end}`,
      note: `${plan.name}新周期到账 ${plan.credits} 个创作额度`,
    });
  });
}

export function appendCreditLedger(entry: {
  userId: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
  idempotencyKey?: string | null;
  note?: string;
  adminUserId?: string | null;
}): string | null {
  if (entry.delta === 0 && entry.reason !== "migration_baseline") {
    // Zero-delta rows are noise; lifecycle evidence lives in task_charges/orders.
    return null;
  }
  if (entry.idempotencyKey) {
    const existing = db.prepare("SELECT id FROM quota_ledger WHERE idempotency_key=?").get(entry.idempotencyKey) as { id?: string } | undefined;
    if (existing?.id) return null;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO quota_ledger
    (id, user_id, delta, balance_before, balance_after, reason, ref_type, ref_id, idempotency_key, note, admin_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, entry.userId, entry.delta, entry.balanceBefore, entry.balanceAfter, entry.reason,
      entry.refType || "", entry.refId || "", entry.idempotencyKey || null, entry.note || "",
      entry.adminUserId || null, nowIso());
  return id;
}

export function listLedger(userId: string, options: { limit?: number; offset?: number } = {}): { total: number; entries: LedgerEntry[] } {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db.prepare(`SELECT * FROM quota_ledger WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(userId, limit, offset) as any[];
  const total = Number((db.prepare("SELECT COUNT(*) AS c FROM quota_ledger WHERE user_id=?").get(userId) as any).c || 0);
  return {
    total,
    entries: rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      delta: Number(row.delta),
      balanceBefore: Number(row.balance_before || 0),
      balanceAfter: Number(row.balance_after || 0),
      reason: row.reason as LedgerReason,
      reasonText: LEDGER_REASON_COPY[row.reason as LedgerReason] || "额度变动",
      refType: row.ref_type || "",
      refId: row.ref_id || "",
      note: row.note || "",
      createdAt: row.created_at,
    })),
  };
}

/** Add credits that do not expire with the membership cycle (packs, gifts, compensation). */
export function grantBonusCredits(input: {
  userId: string;
  credits: number;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
  idempotencyKey?: string | null;
  note?: string;
  adminUserId?: string | null;
}): { changed: boolean; balance: CreditBalance } {
  const credits = Math.round(input.credits);
  if (credits <= 0) throw new HttpError(400, "INVALID_CREDITS", "创作额度数量必须大于 0");
  renewCycleIfNeeded(input.userId);
  let changed = false;
  writeTransaction(() => {
    if (input.idempotencyKey) {
      const seen = db.prepare("SELECT 1 FROM quota_ledger WHERE idempotency_key=?").get(input.idempotencyKey);
      if (seen) return;
    }
    const before = rowToBalance(db.prepare("SELECT * FROM memberships WHERE user_id=?").get(input.userId));
    const result = db.prepare("UPDATE memberships SET bonus_credits = bonus_credits + ?, updated_at=? WHERE user_id=?")
      .run(credits, nowIso(), input.userId);
    if (result.changes !== 1) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在");
    changed = true;
    appendCreditLedger({
      userId: input.userId,
      delta: credits,
      balanceBefore: before.available,
      balanceAfter: before.available + credits,
      reason: input.reason,
      refType: input.refType,
      refId: input.refId,
      idempotencyKey: input.idempotencyKey ?? null,
      note: input.note,
      adminUserId: input.adminUserId ?? null,
    });
  });
  return { changed, balance: readBalance(input.userId)! };
}

/**
 * Remove bonus credits (admin correction or reclaiming benefits after a refund).
 * Never drives the balance negative: it reclaims at most what is still available.
 */
export function reclaimBonusCredits(input: {
  userId: string;
  credits: number;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
  idempotencyKey?: string | null;
  note?: string;
  adminUserId?: string | null;
  allowPlanUsage?: boolean;
}): { reclaimed: number; balance: CreditBalance } {
  const requested = Math.round(input.credits);
  if (requested <= 0) return { reclaimed: 0, balance: readBalance(input.userId)! };
  let reclaimed = 0;
  writeTransaction(() => {
    if (input.idempotencyKey) {
      const seen = db.prepare("SELECT 1 FROM quota_ledger WHERE idempotency_key=?").get(input.idempotencyKey);
      if (seen) return;
    }
    const before = rowToBalance(db.prepare("SELECT * FROM memberships WHERE user_id=?").get(input.userId));
    const fromBonus = Math.min(requested, before.bonus);
    const fromPlan = input.allowPlanUsage ? Math.min(requested - fromBonus, before.planRemaining) : 0;
    reclaimed = fromBonus + fromPlan;
    if (reclaimed <= 0) {
      appendCreditLedger({
        userId: input.userId, delta: 0, balanceBefore: before.available, balanceAfter: before.available,
        reason: input.reason, refType: input.refType, refId: input.refId,
        idempotencyKey: input.idempotencyKey ?? null,
        note: `${input.note || ""}（已消耗，无可回收额度）`.trim(), adminUserId: input.adminUserId ?? null,
      });
      return;
    }
    db.prepare("UPDATE memberships SET bonus_credits = bonus_credits - ?, quota_used_videos = quota_used_videos + ?, updated_at=? WHERE user_id=?")
      .run(fromBonus, fromPlan, nowIso(), input.userId);
    appendCreditLedger({
      userId: input.userId,
      delta: -reclaimed,
      balanceBefore: before.available,
      balanceAfter: before.available - reclaimed,
      reason: input.reason,
      refType: input.refType,
      refId: input.refId,
      idempotencyKey: input.idempotencyKey ?? null,
      note: input.note,
      adminUserId: input.adminUserId ?? null,
    });
  });
  return { reclaimed, balance: readBalance(input.userId)! };
}

/** Batch guard: refuse the whole submission before charging any part of it. */
export function ensureSufficientCredits(userId: string, credits: number, context?: string): CreditBalance {
  renewCycleIfNeeded(userId);
  const balance = readBalance(userId);
  if (!balance) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在");
  if (balance.status !== "active") throw new HttpError(403, "MEMBERSHIP_INACTIVE", "会员状态不可用，请在会员中心确认后重试");
  if (credits > 0 && balance.available < credits) {
    throw new HttpError(402, "QUOTA_EXCEEDED", context || "当前创作额度不足");
  }
  return balance;
}

function rowToCharge(row: any): TaskCharge {
  let quote: Record<string, unknown> = {};
  try { quote = JSON.parse(row.quote_json || "{}"); } catch { quote = {}; }
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id || null,
    kind: row.kind,
    credits: Number(row.credits || 0),
    planCredits: Number(row.plan_credits || 0),
    bonusCredits: Number(row.bonus_credits || 0),
    status: row.status,
    quote,
    estimatedCostCents: Number(row.estimated_cost_cents || 0),
    actualCostCents: row.actual_cost_cents === null || row.actual_cost_cents === undefined ? null : Number(row.actual_cost_cents),
    provider: row.provider || "",
    failureClass: row.failure_class || null,
    idempotencyKey: row.idempotency_key || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settledAt: row.settled_at || null,
    refundedAt: row.refunded_at || null,
  };
}

export function getCharge(id: string): TaskCharge | null {
  const row = db.prepare("SELECT * FROM task_charges WHERE id=?").get(id);
  return row ? rowToCharge(row) : null;
}

export function getChargeByJob(jobId: string): TaskCharge | null {
  const row = db.prepare("SELECT * FROM task_charges WHERE job_id=? ORDER BY created_at DESC LIMIT 1").get(jobId);
  return row ? rowToCharge(row) : null;
}

export function getChargeByIdempotencyKey(key: string): TaskCharge | null {
  const row = db.prepare("SELECT * FROM task_charges WHERE idempotency_key=?").get(key);
  return row ? rowToCharge(row) : null;
}

/**
 * Reserve credits for one creation. Idempotent on both the client token and the job:
 * refreshing the page, retrying a request or restarting the worker cannot charge twice.
 */
export function reserveForJob(input: {
  userId: string;
  kind: string;
  credits: number;
  jobId?: string | null;
  quote?: Record<string, unknown>;
  estimatedCostCents?: number;
  provider?: string;
  idempotencyKey: string;
}): TaskCharge {
  const credits = Math.max(0, Math.round(input.credits));
  const existingByKey = getChargeByIdempotencyKey(input.idempotencyKey);
  if (existingByKey) return existingByKey;
  if (input.jobId) {
    const existingByJob = getChargeByJob(input.jobId);
    if (existingByJob && existingByJob.status !== "voided") return existingByJob;
  }
  renewCycleIfNeeded(input.userId);

  let charge: TaskCharge | null = null;
  writeTransaction(() => {
    const membershipRow = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(input.userId) as any;
    if (!membershipRow) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在");
    if (membershipRow.status !== "active") {
      throw new HttpError(403, "MEMBERSHIP_INACTIVE", "会员状态不可用，请在会员中心确认后重试");
    }
    const before = rowToBalance(membershipRow);
    if (credits > 0 && before.available < credits) {
      throw new HttpError(402, "QUOTA_EXCEEDED", "当前创作额度不足");
    }
    const fromPlan = Math.min(credits, before.planRemaining);
    const fromBonus = credits - fromPlan;
    const chargeId = randomUUID();
    const now = nowIso();
    if (credits > 0) {
      const result = db.prepare(`UPDATE memberships
        SET quota_used_videos = quota_used_videos + ?, bonus_credits = bonus_credits - ?, updated_at=?
        WHERE user_id=? AND quota_used_videos + ? <= quota_limit_videos AND bonus_credits - ? >= 0`)
        .run(fromPlan, fromBonus, now, input.userId, fromPlan, fromBonus);
      if (result.changes !== 1) throw new HttpError(402, "QUOTA_EXCEEDED", "当前创作额度不足");
    }
    db.prepare(`INSERT INTO task_charges
      (id, user_id, job_id, kind, credits, plan_credits, bonus_credits, status, quote_json,
       estimated_cost_cents, actual_cost_cents, provider, failure_class, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, NULL, ?, NULL, ?, ?, ?)`)
      .run(chargeId, input.userId, input.jobId || null, input.kind, credits, fromPlan, fromBonus,
        JSON.stringify(input.quote || {}), Math.max(0, Math.round(input.estimatedCostCents || 0)),
        input.provider || "", input.idempotencyKey, now, now);
    appendCreditLedger({
      userId: input.userId,
      delta: -credits,
      balanceBefore: before.available,
      balanceAfter: before.available - credits,
      reason: "job_reserve",
      refType: "job",
      refId: input.jobId || chargeId,
      idempotencyKey: `charge:${input.idempotencyKey}`,
      note: `创作预扣 ${credits} 个创作额度`,
    });
    charge = getCharge(chargeId);
  });
  return charge!;
}

export function attachChargeToJob(chargeId: string, jobId: string): void {
  db.prepare("UPDATE task_charges SET job_id=?, updated_at=? WHERE id=? AND job_id IS NULL").run(jobId, nowIso(), chargeId);
  db.prepare("UPDATE jobs SET charge_id=? WHERE id=? AND charge_id IS NULL").run(chargeId, jobId);
}

/** Creation finished successfully: the reservation becomes the final charge. No new deduction. */
export function settleCharge(chargeId: string, input: { actualCostCents?: number | null; provider?: string } = {}): boolean {
  let settled = false;
  writeTransaction(() => {
    const result = db.prepare(`UPDATE task_charges
      SET status='settled', settled_at=?, updated_at=?, provider=COALESCE(NULLIF(?, ''), provider),
          actual_cost_cents=COALESCE(?, actual_cost_cents)
      WHERE id=? AND status='reserved'`)
      .run(nowIso(), input.provider || "", input.actualCostCents ?? null, chargeId);
    settled = result.changes === 1;
  });
  return settled;
}

export function settleChargeByJob(jobId: string, input: { actualCostCents?: number | null; provider?: string } = {}): boolean {
  const charge = getChargeByJob(jobId);
  return charge ? settleCharge(charge.id, input) : false;
}

/**
 * Return credits for a creation that did not complete. Refunds exactly once and puts
 * the credits back where they came from (plan cycle first, then bonus balance).
 */
export function refundCharge(chargeId: string, input: { failureClass?: string | null; note?: string; credits?: number } = {}): { refunded: number } {
  let refunded = 0;
  writeTransaction(() => {
    const row = db.prepare("SELECT * FROM task_charges WHERE id=?").get(chargeId) as any;
    if (!row) return;
    const result = db.prepare(`UPDATE task_charges
      SET status='refunded', refunded_at=?, updated_at=?, failure_class=COALESCE(?, failure_class)
      WHERE id=? AND status='reserved'`)
      .run(nowIso(), input.failureClass ?? null, chargeId);
    if (result.changes !== 1) return;
    const amount = Math.min(Number(row.credits || 0), Math.max(0, Math.round(input.credits ?? Number(row.credits || 0))));
    if (amount <= 0) return;
    const planPart = Math.min(Number(row.plan_credits || 0), amount);
    const bonusPart = amount - planPart;
    const before = rowToBalance(db.prepare("SELECT * FROM memberships WHERE user_id=?").get(row.user_id));
    db.prepare("UPDATE memberships SET quota_used_videos = MAX(0, quota_used_videos - ?), bonus_credits = bonus_credits + ?, updated_at=? WHERE user_id=?")
      .run(planPart, bonusPart, nowIso(), row.user_id);
    refunded = amount;
    appendCreditLedger({
      userId: row.user_id,
      delta: amount,
      balanceBefore: before.available,
      balanceAfter: before.available + amount,
      reason: "job_refund",
      refType: "job",
      refId: row.job_id || chargeId,
      idempotencyKey: `refund:${chargeId}`,
      note: input.note || `创作未完成，退回 ${amount} 个创作额度`,
    });
  });
  return { refunded };
}

export function refundChargeByJob(jobId: string, input: { failureClass?: string | null; note?: string } = {}): { refunded: number } {
  const charge = getChargeByJob(jobId);
  return charge ? refundCharge(charge.id, input) : { refunded: 0 };
}

/** Mark a reservation as never charged (rejected before the creation started). */
export function voidCharge(chargeId: string, note = "创作未开始"): boolean {
  let voided = false;
  writeTransaction(() => {
    const row = db.prepare("SELECT * FROM task_charges WHERE id=? AND status='reserved'").get(chargeId) as any;
    if (!row) return;
    const result = db.prepare("UPDATE task_charges SET status='voided', updated_at=? WHERE id=? AND status='reserved'")
      .run(nowIso(), chargeId);
    if (result.changes !== 1) return;
    voided = true;
    if (Number(row.credits || 0) > 0) {
      const before = rowToBalance(db.prepare("SELECT * FROM memberships WHERE user_id=?").get(row.user_id));
      const planPart = Number(row.plan_credits || 0);
      const bonusPart = Number(row.bonus_credits || 0);
      db.prepare("UPDATE memberships SET quota_used_videos = MAX(0, quota_used_videos - ?), bonus_credits = bonus_credits + ?, updated_at=? WHERE user_id=?")
        .run(planPart, bonusPart, nowIso(), row.user_id);
      appendCreditLedger({
        userId: row.user_id,
        delta: Number(row.credits || 0),
        balanceBefore: before.available,
        balanceAfter: before.available + Number(row.credits || 0),
        reason: "job_refund",
        refType: "job",
        refId: row.job_id || chargeId,
        idempotencyKey: `void:${chargeId}`,
        note,
      });
    }
  });
  return voided;
}

/** Backoffice credit adjustment. Always ledgered, always with a reason. */
export function adminAdjustCredits(input: {
  userId: string;
  delta: number;
  note: string;
  adminUserId: string;
}): { balance: CreditBalance; applied: number } {
  const delta = Math.round(input.delta);
  if (delta === 0) throw new HttpError(400, "INVALID_ADJUSTMENT", "调整数量不能为 0");
  if (!input.note.trim()) throw new HttpError(400, "REASON_REQUIRED", "请填写调整原因");
  renewCycleIfNeeded(input.userId);
  let applied = 0;
  writeTransaction(() => {
    const before = rowToBalance(db.prepare("SELECT * FROM memberships WHERE user_id=?").get(input.userId));
    if (!before) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在");
    if (delta > 0) {
      db.prepare("UPDATE memberships SET bonus_credits = bonus_credits + ?, updated_at=? WHERE user_id=?")
        .run(delta, nowIso(), input.userId);
      applied = delta;
    } else {
      const amount = Math.min(-delta, before.available);
      if (amount <= 0) throw new HttpError(400, "NOTHING_TO_DEDUCT", "该用户当前没有可扣减的创作额度");
      const fromBonus = Math.min(amount, before.bonus);
      const fromPlan = amount - fromBonus;
      db.prepare("UPDATE memberships SET bonus_credits = bonus_credits - ?, quota_used_videos = quota_used_videos + ?, updated_at=? WHERE user_id=?")
        .run(fromBonus, fromPlan, nowIso(), input.userId);
      applied = -amount;
    }
    appendCreditLedger({
      userId: input.userId,
      delta: applied,
      balanceBefore: before.available,
      balanceAfter: before.available + applied,
      reason: applied > 0 ? "admin_grant" : "admin_deduct",
      refType: "admin_adjustment",
      refId: input.adminUserId,
      note: input.note.trim(),
      adminUserId: input.adminUserId,
    });
  });
  return { balance: readBalance(input.userId)!, applied };
}

export function listCharges(filter: { userId?: string; status?: ChargeStatus; limit?: number; offset?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) { where.push("c.user_id=?"); params.push(filter.userId); }
  if (filter.status) { where.push("c.status=?"); params.push(filter.status); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = db.prepare(`SELECT c.*, u.email AS owner_email FROM task_charges c
    LEFT JOIN users u ON u.id = c.user_id ${whereSql}
    ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
  const total = Number((db.prepare(`SELECT COUNT(*) AS c FROM task_charges c ${whereSql}`).get(...params) as any).c || 0);
  return {
    total,
    charges: rows.map(row => ({ ...rowToCharge(row), ownerEmail: row.owner_email || null })),
  };
}
