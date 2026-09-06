import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/billing/quota";

/**
 * Payment records and the raw inbound-notification trail.
 *
 * `payments` holds one row per order (out_trade_no is UNIQUE) and tracks the channel
 * actually used. `payment_notifications` stores every notification we receive,
 * including forged or unknown ones, so "the same notification ten times" and "a fake
 * notification" are provable from the database rather than from log grepping.
 */

export type PaymentStatus = "created" | "success" | "failed" | "closed" | "abnormal";
export type PaymentChannel = "page" | "wap";

export interface Payment {
  id: string;
  orderId: string;
  userId: string;
  provider: string;
  channel: PaymentChannel;
  outTradeNo: string;
  tradeNo: string | null;
  amountCents: number;
  status: PaymentStatus;
  verified: boolean;
  notifyCount: number;
  buyerLogonId: string | null;
  error: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function nowIso() {
  return new Date().toISOString();
}

function rowToPayment(row: any): Payment {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    provider: row.provider || "alipay",
    channel: row.channel === "wap" ? "wap" : "page",
    outTradeNo: row.out_trade_no,
    tradeNo: row.trade_no || null,
    amountCents: Number(row.amount_cents || 0),
    status: row.status,
    verified: Boolean(row.verified),
    notifyCount: Number(row.notify_count || 0),
    buyerLogonId: row.buyer_logon_id || null,
    error: row.error || null,
    paidAt: row.paid_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPaymentByOutTradeNo(outTradeNo: string): Payment | null {
  const row = db.prepare("SELECT * FROM payments WHERE out_trade_no=?").get(outTradeNo);
  return row ? rowToPayment(row) : null;
}

export function getPayment(id: string): Payment | null {
  const row = db.prepare("SELECT * FROM payments WHERE id=?").get(id);
  return row ? rowToPayment(row) : null;
}

export function listPaymentsForOrder(orderId: string): Payment[] {
  return (db.prepare("SELECT * FROM payments WHERE order_id=? ORDER BY created_at DESC").all(orderId) as any[]).map(rowToPayment);
}

/** One payment row per order; re-opening checkout only updates the channel. */
export function ensurePaymentRecord(order: { id: string; orderNo: string; userId: string; payableCents: number }, input: {
  provider?: string;
  channel: PaymentChannel;
}): Payment {
  const existing = getPaymentByOutTradeNo(order.orderNo);
  if (existing) {
    db.prepare("UPDATE payments SET channel=?, status=CASE WHEN status IN ('failed','closed','abnormal') THEN 'created' ELSE status END, error=NULL, updated_at=? WHERE id=?")
      .run(input.channel, nowIso(), existing.id);
    return getPayment(existing.id)!;
  }
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO payments
    (id, order_id, user_id, provider, channel, out_trade_no, trade_no, amount_cents, status, verified,
     notify_count, notify_json, buyer_logon_id, error, paid_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'created', 0, 0, NULL, NULL, NULL, NULL, ?, ?)`)
    .run(id, order.id, order.userId, input.provider || "alipay", input.channel, order.orderNo, order.payableCents, now, now);
  return getPayment(id)!;
}

export function markPaymentFailed(paymentId: string, error: string) {
  db.prepare("UPDATE payments SET status='failed', error=?, updated_at=? WHERE id=? AND status <> 'success'")
    .run(String(error).slice(0, 1000), nowIso(), paymentId);
}

export function markPaymentClosed(paymentId: string) {
  db.prepare("UPDATE payments SET status='closed', updated_at=? WHERE id=? AND status IN ('created','failed')")
    .run(nowIso(), paymentId);
}

export function markPaymentAbnormal(paymentId: string, error: string) {
  db.prepare("UPDATE payments SET status='abnormal', error=?, updated_at=? WHERE id=? AND status <> 'success'")
    .run(String(error).slice(0, 1000), nowIso(), paymentId);
}

export interface NotificationRecordInput {
  provider?: string;
  payload: Record<string, unknown>;
  outTradeNo?: string;
  tradeNo?: string;
  amountCents?: number | null;
  tradeStatus?: string;
  verified: boolean;
  accepted: boolean;
  orderId?: string | null;
  error?: string | null;
}

/** Store one inbound notification. Returns null when the exact same payload was seen before. */
export function recordNotification(input: NotificationRecordInput): { id: string; duplicate: boolean } {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      provider: input.provider || "alipay",
      outTradeNo: input.outTradeNo || "",
      tradeNo: input.tradeNo || "",
      tradeStatus: input.tradeStatus || "",
      amount: input.amountCents ?? null,
      payload: input.payload,
    }))
    .digest("hex");
  const existing = db.prepare("SELECT id FROM payment_notifications WHERE fingerprint=?").get(fingerprint) as { id?: string } | undefined;
  if (existing?.id) return { id: existing.id, duplicate: true };
  const id = randomUUID();
  db.prepare(`INSERT INTO payment_notifications
    (id, provider, fingerprint, out_trade_no, trade_no, amount_cents, trade_status, verified, accepted, order_id, payload_json, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.provider || "alipay", fingerprint, input.outTradeNo || "", input.tradeNo || "",
      input.amountCents ?? null, input.tradeStatus || "", input.verified ? 1 : 0, input.accepted ? 1 : 0,
      input.orderId || null, JSON.stringify(input.payload), input.error || null, nowIso());
  return { id, duplicate: false };
}

export function bumpNotifyCount(outTradeNo: string) {
  db.prepare("UPDATE payments SET notify_count = notify_count + 1, updated_at=? WHERE out_trade_no=?").run(nowIso(), outTradeNo);
}

export function listNotifications(filter: { limit?: number; accepted?: boolean; verified?: boolean } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.accepted !== undefined) { where.push("accepted=?"); params.push(filter.accepted ? 1 : 0); }
  if (filter.verified !== undefined) { where.push("verified=?"); params.push(filter.verified ? 1 : 0); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return (db.prepare(`SELECT * FROM payment_notifications ${whereSql} ORDER BY created_at DESC LIMIT ?`).all(limit, ...params) as any[])
    .map(row => ({
      id: row.id,
      provider: row.provider,
      outTradeNo: row.out_trade_no,
      tradeNo: row.trade_no,
      amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
      tradeStatus: row.trade_status,
      verified: Boolean(row.verified),
      accepted: Boolean(row.accepted),
      orderId: row.order_id || null,
      error: row.error || null,
      createdAt: row.created_at,
    }));
}

/** Finance view: totals over paid payments, used by 财务 and 经营数据. */
export function paymentSummary(filter: { from?: string; to?: string } = {}) {
  const where: string[] = ["status='success'"];
  const params: unknown[] = [];
  if (filter.from) { where.push("paid_at >= ?"); params.push(filter.from); }
  if (filter.to) { where.push("paid_at <= ?"); params.push(filter.to); }
  const row = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE ${where.join(" AND ")}`)
    .get(...params) as any;
  const abnormal = Number((db.prepare("SELECT COUNT(*) AS c FROM payments WHERE status IN ('failed','abnormal')").get() as any).c || 0);
  return { count: Number(row?.c || 0), totalCents: Number(row?.total || 0), abnormalCount: abnormal };
}

export function countPendingNotifications(): number {
  return Number((db.prepare("SELECT COUNT(*) AS c FROM payment_notifications WHERE verified=0").get() as any).c || 0);
}

export { writeTransaction };
