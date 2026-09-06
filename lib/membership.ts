import "server-only";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { getFreePlan, getPlan, listPlans, publicPlanView, type Plan } from "@/lib/billing/catalog";
import {
  ensureMembershipRow, readBalance, renewCycleIfNeeded, writeTransaction, appendCreditLedger, type CreditBalance,
} from "@/lib/billing/quota";
import { MEMBERSHIP_STATUS_COPY } from "@/lib/copy";

/**
 * Membership view layer.
 *
 * The catalog (`plans` table) is the only source of truth for names, prices, credits
 * and limits; the credit ledger (`lib/billing/quota`) is the only source of truth for
 * balances. Benefits are granted by a confirmed payment (`lib/billing/entitlements`),
 * never by a user-callable "switch plan" endpoint.
 */

export type MembershipStatus = "active" | "expired" | "suspended";

export interface MembershipView {
  userId: string;
  plan: string;
  planName: string;
  status: MembershipStatus;
  statusText: string;
  credits: CreditBalance & { usedThisCycle: number };
  periodStart: string;
  periodEnd: string;
  daysUntilRenewal: number;
  planInfo: ReturnType<typeof publicPlanView>;
  limits: {
    maxConcurrentJobs: number;
    maxAssetMb: number;
    maxWorks: number;
    maxResolution: string;
  };
}

export function currentPlan(userId: string): Plan {
  const row = db.prepare("SELECT plan, plan_id FROM memberships WHERE user_id=?").get(userId) as any;
  return getPlan(row?.plan_id || row?.plan || "") || getFreePlan();
}

export function purchasablePlans(kind?: "membership" | "quota_pack") {
  return listPlans({ kind, publicOnly: true }).filter(plan => plan.purchasable).map(publicPlanView);
}

export function catalogPlans(filter: { kind?: "membership" | "quota_pack"; includeArchived?: boolean } = {}) {
  return listPlans(filter).map(publicPlanView);
}

export function ensureMembership(userId: string): void {
  ensureMembershipRow(userId, getFreePlan().validityDays || 30);
}

export function getMembership(userId: string): MembershipView {
  ensureMembership(userId);
  renewCycleIfNeeded(userId);
  const row = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
  const balance = readBalance(userId)!;
  const plan = getPlan(row.plan_id || row.plan) || getFreePlan();
  const daysUntilRenewal = Math.max(0, Math.ceil((new Date(row.period_end).getTime() - Date.now()) / 86_400_000));
  return {
    userId,
    plan: plan.id,
    planName: plan.name,
    status: row.status as MembershipStatus,
    statusText: MEMBERSHIP_STATUS_COPY[row.status] || "生效中",
    credits: { ...balance, usedThisCycle: balance.planUsed },
    periodStart: row.period_start,
    periodEnd: row.period_end,
    daysUntilRenewal,
    planInfo: publicPlanView(plan),
    limits: {
      maxConcurrentJobs: plan.maxConcurrentJobs,
      maxAssetMb: plan.maxAssetMb,
      maxWorks: plan.maxWorks,
      maxResolution: plan.maxResolution,
    },
  };
}

/**
 * Backoffice plan change (support/compensation). It is not a purchase: it never
 * touches money, it always writes a ledger row, and the caller must record a reason
 * in the audit log.
 */
export function adminSetMembership(userId: string, patch: {
  plan?: string;
  status?: MembershipStatus;
  validityDays?: number;
  note?: string;
  adminUserId?: string;
}): MembershipView {
  ensureMembership(userId);
  const current = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
  if (!current) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在");
  const plan = patch.plan ? getPlan(patch.plan) : getPlan(current.plan_id || current.plan);
  if (patch.plan && !plan) throw new HttpError(400, "INVALID_PLAN", "未知套餐");
  const target = plan || getFreePlan();
  const validityDays = patch.validityDays && patch.validityDays > 0 ? patch.validityDays : (target.validityDays || 30);
  const now = Date.now();
  const periodEnd = patch.plan
    ? new Date(now + validityDays * 86_400_000).toISOString()
    : current.period_end;
  const periodStart = patch.plan ? new Date(now).toISOString() : current.period_start;
  const before = readBalance(userId)!;

  writeTransaction(() => {
    db.prepare(`UPDATE memberships SET plan=?, plan_id=?, status=?, quota_limit_videos=?, quota_used_videos=?,
      period_start=?, period_end=?, updated_at=? WHERE user_id=?`)
      .run(target.id, target.id, patch.status || current.status,
        patch.plan ? target.credits : current.quota_limit_videos,
        patch.plan ? 0 : current.quota_used_videos,
        periodStart, periodEnd, new Date(now).toISOString(), userId);
    const after = readBalance(userId)!;
    appendCreditLedger({
      userId,
      delta: after.available - before.available,
      balanceBefore: before.available,
      balanceAfter: after.available,
      reason: "admin_grant",
      refType: "admin_membership",
      refId: target.id,
      idempotencyKey: `admin_membership:${userId}:${target.id}:${periodEnd}:${before.available}`,
      note: patch.note?.trim() || `管理员调整会员为「${target.name}」`,
      adminUserId: patch.adminUserId || null,
    });
  });
  return getMembership(userId);
}

/** Extend the current membership without changing the plan (support compensation). */
export function adminExtendMembership(userId: string, days: number, note: string, adminUserId: string): MembershipView {
  if (!Number.isFinite(days) || days <= 0 || days > 3650) throw new HttpError(400, "INVALID_DAYS", "延长天数必须在 1 到 3650 之间");
  if (!note.trim()) throw new HttpError(400, "REASON_REQUIRED", "请填写延长原因");
  ensureMembership(userId);
  const current = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
  const base = Math.max(Date.now(), new Date(current.period_end).getTime());
  const periodEnd = new Date(base + days * 86_400_000).toISOString();
  db.prepare("UPDATE memberships SET period_end=?, status='active', updated_at=? WHERE user_id=?")
    .run(periodEnd, new Date().toISOString(), userId);
  appendCreditLedger({
    userId, delta: 0, balanceBefore: readBalance(userId)!.available, balanceAfter: readBalance(userId)!.available,
    reason: "admin_grant", refType: "admin_membership", refId: current.plan_id || current.plan,
    note: `管理员延长会员 ${days} 天：${note.trim()}`, adminUserId,
  });
  return getMembership(userId);
}
