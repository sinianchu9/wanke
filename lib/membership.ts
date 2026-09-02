import "server-only";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";

export const PLAN_IDS = ["free", "pro", "studio"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDefinition {
  id: PlanId;
  label: string;
  monthlyVideos: number;
  priceMonthly: number;
  tagline: string;
  features: string[];
}

// Configurable commercial constants. Keep in sync with docs/SAAS.md.
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    label: "免费版",
    monthlyVideos: 10,
    priceMonthly: 0,
    tagline: "体验完整的 AI 视频工作台",
    features: ["每月 10 条生成额度", "全部基础生成能力", "作品库与素材库", "单用户工作台"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    monthlyVideos: 100,
    priceMonthly: 99,
    tagline: "面向持续创作的创作者",
    features: ["每月 100 条生成额度", "全部高级工作流", "批量版本与快速向导", "优先排队（规划中）"],
  },
  studio: {
    id: "studio",
    label: "Studio",
    monthlyVideos: 1000,
    priceMonthly: 699,
    tagline: "面向重度用户与小团队",
    features: ["每月 1000 条生成额度", "全部高级工作流", "更高并发与配额", "专属支持（规划中）"],
  },
};

export const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface MembershipView {
  userId: string;
  plan: PlanId;
  status: "active" | "expired" | "suspended";
  quotaLimitVideos: number;
  quotaUsedVideos: number;
  quotaRemainingVideos: number;
  periodStart: string;
  periodEnd: string;
  planInfo: PlanDefinition;
}

function rowToView(row: any): MembershipView {
  const plan = PLANS[row.plan as PlanId] || PLANS.free;
  return {
    userId: row.user_id,
    plan: row.plan,
    status: row.status,
    quotaLimitVideos: row.quota_limit_videos,
    quotaUsedVideos: row.quota_used_videos,
    quotaRemainingVideos: Math.max(0, row.quota_limit_videos - row.quota_used_videos),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    planInfo: plan,
  };
}

/** Ensure a membership exists. New users default to the free plan with an active cycle. */
export function ensureMembership(userId: string): void {
  const existing = db.prepare("SELECT 1 FROM memberships WHERE user_id=?").get(userId);
  if (existing) return;
  const now = Date.now();
  db.prepare(`INSERT INTO memberships (user_id, plan, status, quota_limit_videos, quota_used_videos, period_start, period_end, updated_at)
    VALUES (?, 'free', 'active', ?, 0, ?, ?, ?)`)
    .run(userId, PLANS.free.monthlyVideos, new Date(now).toISOString(), new Date(now + PERIOD_MS).toISOString(), new Date(now).toISOString());
}

/**
 * Lazy period rollover: when the paid/free cycle has ended, reset usage and start a
 * fresh 30-day cycle. Membership stays active; real payment renewal is an extension
 * point (see docs/SAAS.md).
 */
function rollPeriodIfNeeded(userId: string) {
  const row = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
  if (!row) return;
  const now = Date.now();
  if (new Date(row.period_end).getTime() > now) return;
  let end = new Date(row.period_end).getTime();
  while (end <= now) end += PERIOD_MS;
  db.prepare("UPDATE memberships SET quota_used_videos=0, period_start=?, period_end=?, updated_at=? WHERE user_id=?")
    .run(new Date(end - PERIOD_MS).toISOString(), new Date(end).toISOString(), new Date(now).toISOString(), userId);
}

export function getMembership(userId: string): MembershipView {
  ensureMembership(userId);
  rollPeriodIfNeeded(userId);
  const row = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
  return rowToView(row);
}

/**
 * Quota policy (single source of truth):
 * - Reserve-at-submit: quota is consumed when a generation job is accepted into the queue.
 * - Synchronous submit failure (provider rejected before queueing) refunds the unit.
 * - Asynchronous provider failure keeps the consumed unit (documented commercial rule).
 * - Atomic UPDATE with a bound check prevents double-spend under concurrent submits;
 *   better-sqlite3 serializes writes on one connection.
 */
export function reserveQuota(userId: string, amount = 1): void {
  ensureMembership(userId);
  rollPeriodIfNeeded(userId);
  const done = db.transaction(() => {
    const membership = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
    if (!membership || membership.status !== "active") {
      throw new HttpError(403, "MEMBERSHIP_INACTIVE", "会员状态不可用，请联系管理员或重新激活套餐");
    }
    const result = db.prepare(`
      UPDATE memberships
      SET quota_used_videos = quota_used_videos + ?, updated_at = ?
      WHERE user_id = ? AND quota_used_videos + ? <= quota_limit_videos
    `).run(amount, new Date().toISOString(), userId, amount);
    if (result.changes !== 1) {
      const view = rowToView(membership);
      throw new HttpError(
        402,
        "QUOTA_EXCEEDED",
        `本周期 ${view.quotaLimitVideos} 条生成额度已用完（已用 ${view.quotaUsedVideos} 条）。请在会员中心升级套餐后继续创作。`,
      );
    }
  });
  done();
}

export function refundQuota(userId: string, amount = 1): void {
  db.prepare(`
    UPDATE memberships SET quota_used_videos = MAX(0, quota_used_videos - ?), updated_at=? WHERE user_id=?
  `).run(amount, new Date().toISOString(), userId);
}

/**
 * Plan switch (demo billing). Real payment is an extension point; until then the
 * switch simulates a completed payment: a fresh cycle starts and usage resets.
 */
export function switchPlan(userId: string, planId: PlanId): MembershipView {
  const plan = PLANS[planId];
  if (!plan) throw new HttpError(400, "INVALID_PLAN", "未知套餐");
  ensureMembership(userId);
  const now = Date.now();
  db.prepare(`
    UPDATE memberships SET plan=?, status='active', quota_limit_videos=?, quota_used_videos=0,
      period_start=?, period_end=?, updated_at=?
    WHERE user_id=?
  `).run(planId, plan.monthlyVideos, new Date(now).toISOString(), new Date(now + PERIOD_MS).toISOString(), new Date(now).toISOString(), userId);
  return getMembership(userId);
}

/** Admin adjustment: set plan and/or usage without resetting the whole cycle. */
export function adminSetMembership(userId: string, patch: { plan?: PlanId; quotaUsed?: number; status?: "active" | "expired" | "suspended" }): MembershipView {
  ensureMembership(userId);
  if (patch.plan && !PLANS[patch.plan]) throw new HttpError(400, "INVALID_PLAN", "未知套餐");
  const current = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
  const plan = patch.plan || current.plan;
  const limit = PLANS[plan as PlanId].monthlyVideos;
  db.prepare(`
    UPDATE memberships SET plan=?, quota_limit_videos=?, quota_used_videos=?, status=?, updated_at=? WHERE user_id=?
  `).run(
    plan,
    limit,
    patch.quotaUsed !== undefined ? Math.max(0, Math.floor(patch.quotaUsed)) : current.quota_used_videos,
    patch.status || current.status,
    new Date().toISOString(),
    userId,
  );
  return getMembership(userId);
}
