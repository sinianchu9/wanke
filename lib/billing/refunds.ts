import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { getFreePlan, getPlan } from "@/lib/billing/catalog";
import { appendCreditLedger, readBalance, reclaimBonusCredits, renewCycleIfNeeded, writeTransaction } from "@/lib/billing/quota";
import { recordOrderEvent } from "@/lib/billing/orders";
import { createNotification } from "@/lib/notifications";

/**
 * Refund domain.
 *
 * Refunds always go through this service: the backoffice cannot flip an order to
 * `refunded` directly, and the provider call is injected so the same lifecycle works
 * for Alipay, for a manual bank transfer and for tests.
 *
 * Hard guarantees: no double refund (status transitions are guarded by the UPDATE
 * predicate), no over-refund (amount is bounded by payable - already refunded), no
 * refund of an unpaid order, and benefit reclamation is ledgered exactly once.
 */

export type RefundStatus = "requested" | "approved" | "processing" | "succeeded" | "failed" | "rejected";

export interface Refund {
  id: string;
  refundNo: string;
  orderId: string;
  paymentId: string | null;
  userId: string;
  outRequestNo: string;
  amountCents: number;
  creditsReclaimed: number;
  reason: string;
  status: RefundStatus;
  requestedBy: "user" | "admin";
  adminUserId: string | null;
  providerRefundNo: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

function rowToRefund(row: any): Refund {
  return {
    id: row.id,
    refundNo: row.refund_no,
    orderId: row.order_id,
    paymentId: row.payment_id || null,
    userId: row.user_id,
    outRequestNo: row.out_request_no,
    amountCents: Number(row.amount_cents || 0),
    creditsReclaimed: Number(row.credits_reclaimed || 0),
    reason: row.reason || "",
    status: row.status,
    requestedBy: row.requested_by === "admin" ? "admin" : "user",
    adminUserId: row.admin_user_id || null,
    providerRefundNo: row.provider_refund_no || null,
    error: row.error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

export function getRefund(idOrNo: string): Refund | null {
  const row = db.prepare("SELECT * FROM refunds WHERE id=? OR refund_no=?").get(idOrNo, idOrNo);
  return row ? rowToRefund(row) : null;
}

export function listRefunds(filter: { userId?: string; orderId?: string; status?: RefundStatus; limit?: number; offset?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) { where.push("r.user_id=?"); params.push(filter.userId); }
  if (filter.orderId) { where.push("r.order_id=?"); params.push(filter.orderId); }
  if (filter.status) { where.push("r.status=?"); params.push(filter.status); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = db.prepare(`SELECT r.*, o.order_no, u.email AS user_email FROM refunds r
    LEFT JOIN orders o ON o.id = r.order_id
    LEFT JOIN users u ON u.id = r.user_id
    ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
  const total = Number((db.prepare(`SELECT COUNT(*) AS c FROM refunds r ${whereSql}`).get(...params) as any).c || 0);
  return {
    total,
    refunds: rows.map(row => ({ ...rowToRefund(row), orderNo: row.order_no || null, userEmail: row.user_email || null })),
  };
}

function inFlightRefund(orderId: string): Refund | null {
  const row = db.prepare(`SELECT * FROM refunds WHERE order_id=? AND status IN ('requested','approved','processing') ORDER BY created_at DESC LIMIT 1`).get(orderId);
  return row ? rowToRefund(row) : null;
}

export function refundableAmountCents(orderId: string): number {
  const order = db.prepare("SELECT payable_cents, refunded_cents, status FROM orders WHERE id=?").get(orderId) as any;
  if (!order) return 0;
  if (order.status !== "paid" && order.status !== "partial_refund") return 0;
  return Math.max(0, Number(order.payable_cents || 0) - Number(order.refunded_cents || 0));
}

export function requestRefund(input: {
  orderId: string;
  requestedBy: "user" | "admin";
  userId?: string;
  adminUserId?: string;
  reason: string;
  amountCents?: number;
}): Refund {
  const order = db.prepare("SELECT * FROM orders WHERE id=? OR order_no=?").get(input.orderId, input.orderId) as any;
  if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
  if (input.requestedBy === "user" && order.user_id !== input.userId) {
    throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
  }
  if (!input.reason.trim()) throw new HttpError(400, "REASON_REQUIRED", "请填写退款原因");
  if (order.status !== "paid" && order.status !== "partial_refund") {
    throw new HttpError(409, "ORDER_NOT_REFUNDABLE", "该订单当前不能申请退款");
  }
  const existing = inFlightRefund(order.id);
  if (existing) return existing;
  const remaining = refundableAmountCents(order.id);
  if (remaining <= 0) throw new HttpError(409, "ALREADY_REFUNDED", "该订单已经完成退款");
  const amountCents = input.amountCents === undefined ? remaining : Math.round(input.amountCents);
  if (amountCents <= 0) throw new HttpError(400, "INVALID_AMOUNT", "退款金额必须大于 0");
  if (amountCents > remaining) throw new HttpError(400, "AMOUNT_TOO_LARGE", "退款金额不能超过可退金额");

  const payment = db.prepare("SELECT id FROM payments WHERE order_id=? AND status='success' ORDER BY paid_at DESC LIMIT 1").get(order.id) as any;
  const id = randomUUID();
  const refundNo = `RF${order.order_no.replace(/^WK/, "")}`;
  const now = nowIso();
  const status: RefundStatus = input.requestedBy === "admin" ? "approved" : "requested";
  writeTransaction(() => {
    db.prepare(`INSERT INTO refunds
      (id, refund_no, order_id, payment_id, user_id, out_request_no, amount_cents, credits_reclaimed, reason,
       status, requested_by, admin_user_id, provider_refund_no, result_json, error, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)`)
      .run(id, refundNo, order.id, payment?.id || null, order.user_id, id, amountCents, input.reason.trim().slice(0, 500),
        status, input.requestedBy, input.adminUserId || null, now, now);
    recordOrderEvent(order.id, "refund_requested", { refundNo, amountCents, by: input.requestedBy, reason: input.reason.trim() });
  });
  return getRefund(id)!;
}

export function approveRefund(refundId: string, adminUserId: string): Refund {
  return transition(refundId, ["requested"], "approved", adminUserId, "退款已通过审核");
}

export function rejectRefund(refundId: string, adminUserId: string, reason: string): Refund {
  if (!reason.trim()) throw new HttpError(400, "REASON_REQUIRED", "请填写驳回原因");
  return transition(refundId, ["requested", "approved"], "rejected", adminUserId, `退款被驳回：${reason.trim()}`);
}

function transition(refundId: string, from: RefundStatus[], to: RefundStatus, adminUserId: string, note: string): Refund {
  const refund = getRefund(refundId);
  if (!refund) throw new HttpError(404, "REFUND_NOT_FOUND", "退款记录不存在");
  if (!from.includes(refund.status)) throw new HttpError(409, "INVALID_REFUND_STATE", `当前退款状态不能执行该操作`);
  writeTransaction(() => {
    const changed = db.prepare(`UPDATE refunds SET status=?, admin_user_id=?, updated_at=? WHERE id=? AND status IN (${from.map(() => "?").join(",")})`)
      .run(to, adminUserId, nowIso(), refundId, ...from).changes;
    if (changed !== 1) throw new HttpError(409, "INVALID_REFUND_STATE", "退款状态已经变化，请刷新后重试");
    recordOrderEvent(refund.orderId, `refund_${to}`, { refundNo: refund.refundNo, note, adminUserId });
  });
  return getRefund(refundId)!;
}

export interface RefundExecutorResult {
  success: boolean;
  providerRefundNo?: string | null;
  error?: string | null;
  result?: Record<string, unknown> | null;
}

export type RefundExecutor = (refund: Refund, order: { id: string; orderNo: string; payableCents: number }) => Promise<RefundExecutorResult>;

/** Move an approved refund into processing, run the provider call, then settle it. */
export async function executeRefund(refundId: string, executor: RefundExecutor, adminUserId?: string): Promise<Refund> {
  const refund = getRefund(refundId);
  if (!refund) throw new HttpError(404, "REFUND_NOT_FOUND", "退款记录不存在");
  if (refund.status === "succeeded") return refund;
  if (refund.status !== "requested" && refund.status !== "approved" && refund.status !== "processing" && refund.status !== "failed") {
    throw new HttpError(409, "INVALID_REFUND_STATE", "当前退款状态不能发起退款");
  }
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(refund.orderId) as any;
  if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");

  const claimed = db.prepare(`UPDATE refunds SET status='processing', updated_at=?, admin_user_id=COALESCE(?, admin_user_id)
    WHERE id=? AND status <> 'succeeded'`).run(nowIso(), adminUserId || null, refundId).changes === 1;
  if (!claimed) return getRefund(refundId)!;

  let result: RefundExecutorResult;
  try {
    result = await executor(refund, { id: order.id, orderNo: order.order_no, payableCents: Number(order.payable_cents || 0) });
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!result.success) return failRefund(refundId, result.error || "退款失败");
  return completeRefund(refundId, { providerRefundNo: result.providerRefundNo || null, resultJson: result.result || null });
}

export function failRefund(refundId: string, error: string): Refund {
  db.prepare("UPDATE refunds SET status='failed', error=?, updated_at=? WHERE id=? AND status <> 'succeeded'")
    .run(String(error).slice(0, 1000), nowIso(), refundId);
  const refund = getRefund(refundId);
  if (refund) recordOrderEvent(refund.orderId, "refund_failed", { refundNo: refund.refundNo, error: String(error).slice(0, 300) });
  return getRefund(refundId)!;
}

/**
 * Settle a successful refund exactly once: order totals, benefit reclamation,
 * ledger and notification all happen in one transaction.
 */
export function completeRefund(refundId: string, input: { providerRefundNo?: string | null; resultJson?: Record<string, unknown> | null } = {}): Refund {
  const refund = getRefund(refundId);
  if (!refund) throw new HttpError(404, "REFUND_NOT_FOUND", "退款记录不存在");
  if (refund.status === "succeeded") return refund;

  writeTransaction(() => {
    const claimed = db.prepare(`UPDATE refunds SET status='succeeded', provider_refund_no=?, result_json=?, completed_at=?, updated_at=?
      WHERE id=? AND status <> 'succeeded'`)
      .run(input.providerRefundNo || null, JSON.stringify(input.resultJson || {}), nowIso(), nowIso(), refundId).changes;
    if (claimed !== 1) return;

    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(refund.orderId) as any;
    if (!order) return;
    const refundedCents = Number(order.refunded_cents || 0) + refund.amountCents;
    const fullyRefunded = refundedCents >= Number(order.payable_cents || 0);
    db.prepare("UPDATE orders SET refunded_cents=?, status=?, updated_at=? WHERE id=?")
      .run(refundedCents, fullyRefunded ? "refunded" : "partial_refund", nowIso(), order.id);
    db.prepare("UPDATE payments SET status='closed', updated_at=? WHERE order_id=? AND status='success' AND ? = 1")
      .run(nowIso(), order.id, fullyRefunded ? 1 : 0);
    recordOrderEvent(order.id, fullyRefunded ? "refunded" : "partial_refund", {
      refundNo: refund.refundNo, amountCents: refund.amountCents, refundedCents, providerRefundNo: input.providerRefundNo || null,
    });

    const reclaimed = reclaimBenefitsForRefund(order, refund);
    db.prepare("UPDATE refunds SET credits_reclaimed=? WHERE id=?").run(reclaimed, refundId);

    createNotification({
      userId: order.user_id,
      type: "refund_done",
      title: fullyRefunded ? "退款已完成" : "部分退款已完成",
      body: `订单 ${order.order_no} 退款 ¥${(refund.amountCents / 100).toFixed(2)} 已经原路退回，${reclaimed > 0 ? `同时回收了 ${reclaimed} 个创作额度。` : "对应权益已按规则处理。"}`,
      link: "/account/orders",
      dedupeKey: `refund:${refund.id}`,
      ignorePreference: true,
    });
  });
  return getRefund(refundId)!;
}

function reclaimBenefitsForRefund(order: any, refund: Refund): number {
  const userId = order.user_id;
  let snapshot: any = {};
  try { snapshot = JSON.parse(order.snapshot_json || "{}"); } catch { snapshot = {}; }
  renewCycleIfNeeded(userId);

  if (order.kind === "quota_pack") {
    const { reclaimed } = reclaimBonusCredits({
      userId,
      credits: Number(snapshot.credits || 0),
      reason: "order_refund_reclaim",
      refType: "refund",
      refId: refund.id,
      idempotencyKey: `refund:${refund.id}`,
      note: `订单 ${order.order_no} 退款，回收加油包创作额度`,
    });
    return reclaimed;
  }

  const membership = db.prepare("SELECT * FROM memberships WHERE user_id=?").get(userId) as any;
  if (!membership || (membership.plan_id || membership.plan) !== order.plan_id) return 0;
  const before = readBalance(userId)!;
  const free = getFreePlan();
  const now = Date.now();
  const validityDays = free.validityDays > 0 ? free.validityDays : 30;
  db.prepare(`UPDATE memberships SET plan=?, plan_id=?, status='active', quota_limit_videos=?, quota_used_videos=0,
    period_start=?, period_end=?, updated_at=? WHERE user_id=?`)
    .run(free.id, free.id, free.credits, new Date(now).toISOString(), new Date(now + validityDays * 24 * 60 * 60 * 1000).toISOString(), nowIso(), userId);
  const after = readBalance(userId)!;
  appendCreditLedger({
    userId,
    delta: after.available - before.available,
    balanceBefore: before.available,
    balanceAfter: after.available,
    reason: "order_refund_reclaim",
    refType: "refund",
    refId: refund.id,
    idempotencyKey: `refund:${refund.id}`,
    note: `订单 ${order.order_no} 退款，会员权益回收为「${free.name}」`,
  });
  const plan = getPlan(order.plan_id);
  return Math.max(0, Math.round((plan?.credits ?? Number(snapshot.credits || 0)) - after.planRemaining));
}

/** User-facing refund eligibility for the order detail page. */
export function refundEligibility(orderId: string): { eligible: boolean; amountCents: number; reason: string } {
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as any;
  if (!order) return { eligible: false, amountCents: 0, reason: "订单不存在" };
  if (order.status !== "paid" && order.status !== "partial_refund") {
    return { eligible: false, amountCents: 0, reason: "订单未支付或已经关闭" };
  }
  if (inFlightRefund(order.id)) return { eligible: false, amountCents: 0, reason: "退款正在处理中" };
  const amountCents = refundableAmountCents(order.id);
  if (amountCents <= 0) return { eligible: false, amountCents: 0, reason: "该订单已经完成退款" };
  return { eligible: true, amountCents, reason: "" };
}
