import "server-only";
import { db } from "@/lib/db";
import { getPlan, type PlanSnapshot } from "@/lib/billing/catalog";
import { appendCreditLedger, grantBonusCredits, readBalance, writeTransaction } from "@/lib/billing/quota";
import { createNotification } from "@/lib/notifications";

/**
 * Benefit fulfilment. Runs inside the same transaction that turns an order `paid`,
 * so "payment confirmed", "membership active" and "credits added" can never diverge.
 *
 * Idempotent by construction: every ledger write for an order uses the key
 * `order:<orderId>`, and the grant is skipped entirely when that key already exists.
 */

export interface EntitlementOrder {
  id: string;
  orderNo: string;
  userId: string;
  kind: string;
  planId: string;
  snapshot: PlanSnapshot;
  payableCents: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function alreadyGranted(orderId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM quota_ledger WHERE idempotency_key=?").get(`order:${orderId}`));
}

export function grantEntitlementForOrder(order: EntitlementOrder): { granted: boolean; reason: string } {
  if (alreadyGranted(order.id)) return { granted: false, reason: "already_granted" };
  const snapshot = order.snapshot;
  const plan = getPlan(order.planId);
  const validityDays = snapshot?.validityDays || plan?.validityDays || 30;
  const credits = Number(snapshot?.credits ?? plan?.credits ?? 0);
  const productName = snapshot?.name || plan?.name || "套餐";

  if (order.kind === "quota_pack") {
    grantBonusCredits({
      userId: order.userId,
      credits,
      reason: "pack_purchase",
      refType: "order",
      refId: order.id,
      idempotencyKey: `order:${order.id}`,
      note: `购买「${productName}」到账 ${credits} 个创作额度`,
    });
    createNotification({
      userId: order.userId,
      type: "payment_success",
      title: "创作额度已到账",
      body: `「${productName}」已经到账，当前可用创作额度 ${readBalance(order.userId)?.available ?? credits} 个。`,
      link: "/account/credits",
      dedupeKey: `order:${order.id}`,
    });
    return { granted: true, reason: "quota_pack" };
  }

  const isRenewal = order.kind === "membership_renew";
  const now = Date.now();
  const membership = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(order.userId) as any;
  const currentPeriodEnd = membership?.period_end ? new Date(membership.period_end).getTime() : 0;
  const periodStart = isRenewal && currentPeriodEnd > now ? currentPeriodEnd : now;
  const periodEnd = periodStart + validityDays * DAY_MS;
  const before = readBalance(order.userId) || { available: 0, bonus: 0, planLimit: 0, planUsed: 0, planRemaining: 0 };

  writeTransaction(() => {
    if (alreadyGranted(order.id)) return;
    const planId = snapshot?.planId || order.planId;
    if (membership) {
      db.prepare(`UPDATE memberships SET plan=?, plan_id=?, status='active', quota_limit_videos=?, quota_used_videos=0,
        period_start=?, period_end=?, updated_at=? WHERE user_id=?`)
        .run(planId, planId, credits, new Date(periodStart).toISOString(), new Date(periodEnd).toISOString(), nowIso(), order.userId);
    } else {
      db.prepare(`INSERT INTO memberships
        (user_id, plan, plan_id, status, quota_limit_videos, quota_used_videos, bonus_credits, period_start, period_end, updated_at)
        VALUES (?, ?, ?, 'active', ?, 0, 0, ?, ?, ?)`)
        .run(order.userId, planId, planId, credits, new Date(periodStart).toISOString(), new Date(periodEnd).toISOString(), nowIso());
    }
    const after = readBalance(order.userId)!;
    appendCreditLedger({
      userId: order.userId,
      delta: after.available - before.available,
      balanceBefore: before.available,
      balanceAfter: after.available,
      reason: "plan_grant",
      refType: "order",
      refId: order.id,
      idempotencyKey: `order:${order.id}`,
      note: `「${productName}」生效，${credits} 个创作额度已到账`,
    });
  });

  createNotification({
    userId: order.userId,
    type: "payment_success",
    title: isRenewal ? "续费成功" : "开通成功",
    body: `「${productName}」已经生效，有效期至 ${new Date(periodEnd).toLocaleDateString("zh-CN")}，本周期创作额度 ${credits} 个。`,
    link: "/account/membership",
    dedupeKey: `order:${order.id}`,
  });
  return { granted: true, reason: isRenewal ? "renewal" : "membership" };
}

/** Backoffice compensation: re-run fulfilment for an order that is paid but not granted. */
export function replayEntitlement(orderId: string): { granted: boolean; reason: string } {
  const row = db.prepare("SELECT * FROM orders WHERE id=? OR order_no=?").get(orderId, orderId) as any;
  if (!row) return { granted: false, reason: "order_not_found" };
  if (row.status !== "paid") return { granted: false, reason: "order_not_paid" };
  let snapshot: PlanSnapshot = {} as PlanSnapshot;
  try { snapshot = JSON.parse(row.snapshot_json || "{}"); } catch { snapshot = {} as PlanSnapshot; }
  return grantEntitlementForOrder({
    id: row.id, orderNo: row.order_no, userId: row.user_id, kind: row.kind,
    planId: row.plan_id, snapshot, payableCents: Number(row.payable_cents || 0),
  });
}
