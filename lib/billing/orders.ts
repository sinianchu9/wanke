import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { getPlan, planSnapshot, requirePurchasablePlan, type Plan, type PlanSnapshot } from "@/lib/billing/catalog";
import { grantEntitlementForOrder } from "@/lib/billing/entitlements";
import { ensurePaymentRecord, markPaymentSuccess } from "@/lib/billing/payments";
import { alipayAvailable, alipayConfig, buildPaymentUrl, type AlipayChannel } from "@/lib/billing/alipay";
import { writeTransaction } from "@/lib/billing/quota";

/**
 * Order domain.
 *
 * - Money is integer cents; the product snapshot is frozen at creation time so later
 *   catalog edits never rewrite a sold order.
 * - `client_token` is UNIQUE: refreshing the checkout page cannot create endless
 *   orders, and a pending order for the same product is reused instead of duplicated.
 * - Becoming `paid` is a guarded state transition inside one transaction, so a
 *   duplicated payment notification can never grant benefits twice.
 */

export type OrderKind = "membership_new" | "membership_renew" | "membership_upgrade" | "quota_pack";
export type OrderStatus = "pending" | "paying" | "paid" | "closed" | "canceled" | "partial_refund" | "refunded" | "abnormal";
export type OrderDevice = "pc" | "wap";

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  kind: OrderKind;
  planId: string;
  snapshot: PlanSnapshot;
  amountCents: number;
  discountCents: number;
  payableCents: number;
  refundedCents: number;
  couponId: string | null;
  currency: string;
  status: OrderStatus;
  device: OrderDevice;
  clientToken: string;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ORDER_TTL_MINUTES = 30;

function nowIso() {
  return new Date().toISOString();
}

export function orderTtlMinutes(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key='order_ttl_minutes'").get() as { value?: string } | undefined;
  const parsed = Number(row?.value || "");
  return Number.isFinite(parsed) && parsed >= 5 && parsed <= 1440 ? Math.round(parsed) : DEFAULT_ORDER_TTL_MINUTES;
}

function parseSnapshot(value: string | null): PlanSnapshot {
  try {
    return JSON.parse(value || "{}") as PlanSnapshot;
  } catch {
    return {} as PlanSnapshot;
  }
}

function rowToOrder(row: any): Order {
  return {
    id: row.id,
    orderNo: row.order_no,
    userId: row.user_id,
    kind: row.kind,
    planId: row.plan_id,
    snapshot: parseSnapshot(row.snapshot_json),
    amountCents: Number(row.amount_cents || 0),
    discountCents: Number(row.discount_cents || 0),
    payableCents: Number(row.payable_cents || 0),
    refundedCents: Number(row.refunded_cents || 0),
    couponId: row.coupon_id || null,
    currency: row.currency || "CNY",
    status: row.status,
    device: row.device,
    clientToken: row.client_token,
    expiresAt: row.expires_at,
    paidAt: row.paid_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateOrderNo(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `WK${stamp}${suffix}`;
}

export function getOrder(idOrNo: string): Order | null {
  const row = db.prepare("SELECT * FROM orders WHERE id=? OR order_no=?").get(idOrNo, idOrNo);
  return row ? rowToOrder(row) : null;
}

export function getOrderForUser(idOrNo: string, userId: string): Order | null {
  const order = getOrder(idOrNo);
  return order && order.userId === userId ? order : null;
}

export function recordOrderEvent(orderId: string, type: string, payload: Record<string, unknown> = {}) {
  db.prepare("INSERT INTO order_events (id, order_id, type, payload_json, created_at) VALUES (?,?,?,?,?)")
    .run(randomUUID(), orderId, type, JSON.stringify(payload), nowIso());
}

export function listOrderEvents(orderId: string) {
  return (db.prepare("SELECT * FROM order_events WHERE order_id=? ORDER BY created_at ASC, rowid ASC").all(orderId) as any[])
    .map(row => {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(row.payload_json || "{}"); } catch { payload = {}; }
      return { id: row.id, type: row.type, payload, createdAt: row.created_at };
    });
}

interface MembershipState {
  planId: string;
  periodEnd: string;
  status: string;
}

function currentMembershipState(userId: string): MembershipState | null {
  const row = db.prepare("SELECT plan, plan_id, period_end, status FROM memberships WHERE user_id=?").get(userId) as any;
  if (!row) return null;
  return { planId: row.plan_id || row.plan || "free", periodEnd: row.period_end || "", status: row.status };
}

export function resolveOrderKind(userId: string, plan: Plan): OrderKind {
  if (plan.kind === "quota_pack") return "quota_pack";
  const state = currentMembershipState(userId);
  if (!state) return "membership_new";
  const current = getPlan(state.planId);
  if (!current || current.priceCents <= 0) return "membership_new";
  if (current.id === plan.id) return "membership_renew";
  return plan.priceCents > current.priceCents ? "membership_upgrade" : "membership_new";
}

/** Unused value of the current paid membership, applied as an upgrade discount. */
export function upgradeCreditCents(userId: string, target: Plan): { discountCents: number; remainingDays: number; fromPlanName: string } {
  const state = currentMembershipState(userId);
  if (!state) return { discountCents: 0, remainingDays: 0, fromPlanName: "" };
  const current = getPlan(state.planId);
  if (!current || current.priceCents <= 0 || current.id === target.id) return { discountCents: 0, remainingDays: 0, fromPlanName: current?.name || "" };
  const remainingMs = new Date(state.periodEnd).getTime() - Date.now();
  const remainingDays = Math.max(0, Math.ceil(remainingMs / DAY_MS));
  if (remainingDays <= 0) return { discountCents: 0, remainingDays: 0, fromPlanName: current.name };
  const validity = current.validityDays > 0 ? current.validityDays : 30;
  const discountCents = Math.min(target.priceCents, Math.floor((current.priceCents * remainingDays) / validity));
  return { discountCents, remainingDays, fromPlanName: current.name };
}

export interface CreateOrderInput {
  userId: string;
  planId: string;
  device?: OrderDevice;
  clientToken: string;
  kind?: OrderKind;
}

export function createOrder(input: CreateOrderInput): Order {
  const clientToken = String(input.clientToken || "").trim();
  if (clientToken.length < 8 || clientToken.length > 128) {
    throw new HttpError(400, "INVALID_CLIENT_TOKEN", "下单会话已失效，请重新选择套餐");
  }
  const existingByToken = db.prepare("SELECT * FROM orders WHERE client_token=?").get(clientToken) as any;
  if (existingByToken) {
    const existing = rowToOrder(existingByToken);
    if (existing.userId !== input.userId) throw new HttpError(403, "FORBIDDEN", "无权访问该订单");
    return existing;
  }

  const plan = requirePurchasablePlan(input.planId);
  if (plan.priceCents <= 0) {
    // The free tier is not a product. Selling it for ¥0 would fulfil instantly and
    // reset `quota_used`, letting a member mint fresh credits without paying.
    throw new HttpError(400, "PLAN_NOT_PURCHASABLE", "免费套餐无需购买，注册后即可使用");
  }
  const kind = input.kind ? input.kind : resolveOrderKind(input.userId, plan);
  if (plan.kind === "quota_pack" && kind !== "quota_pack") {
    throw new HttpError(400, "INVALID_ORDER_KIND", "额度加油包订单类型不正确");
  }
  if (plan.kind === "membership" && kind === "quota_pack") {
    throw new HttpError(400, "INVALID_ORDER_KIND", "会员套餐订单类型不正确");
  }

  const upgrade = kind === "membership_upgrade" ? upgradeCreditCents(input.userId, plan) : null;
  const discountCents = upgrade ? upgrade.discountCents : 0;
  const payableCents = Math.max(0, plan.priceCents - discountCents);
  const now = Date.now();
  const orderId = randomUUID();
  const orderNo = generateOrderNo();
  const snapshot = planSnapshot(plan);
  const expiresAt = new Date(now + orderTtlMinutes() * 60 * 1000).toISOString();
  const device: OrderDevice = input.device === "wap" ? "wap" : "pc";

  // A still-valid pending order for the same product is reused, so repeatedly opening
  // the checkout page does not pile up unpaid orders.
  const reusable = db.prepare(`SELECT * FROM orders
    WHERE user_id=? AND plan_id=? AND kind=? AND status IN ('pending','paying') AND expires_at > ? AND payable_cents=?
    ORDER BY created_at DESC LIMIT 1`)
    .get(input.userId, plan.id, kind, new Date(now).toISOString(), payableCents) as any;
  if (reusable) return rowToOrder(reusable);

  const order = writeTransaction(() => {
    db.prepare(`INSERT INTO orders
      (id, order_no, user_id, kind, plan_id, snapshot_json, amount_cents, discount_cents, payable_cents,
       refunded_cents, coupon_id, currency, status, device, client_token, expires_at, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'CNY', ?, ?, ?, ?, NULL, ?, ?)`)
      .run(orderId, orderNo, input.userId, kind, plan.id, JSON.stringify(snapshot), plan.priceCents, discountCents,
        payableCents, payableCents > 0 ? "pending" : "paid", device, clientToken, expiresAt,
        new Date(now).toISOString(), new Date(now).toISOString());
    db.prepare(`INSERT INTO order_items
      (id, order_id, item_type, plan_id, name, quantity, unit_price_cents, amount_cents, credits, validity_days, snapshot_json)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), orderId, plan.kind === "quota_pack" ? "quota_pack" : kind === "membership_renew" ? "renewal" : kind === "membership_upgrade" ? "upgrade" : "membership",
        plan.id, plan.name, plan.priceCents, plan.priceCents, plan.credits, plan.validityDays, JSON.stringify(snapshot));
    recordOrderEvent(orderId, "created", {
      orderNo, planId: plan.id, kind, payableCents, discountCents, device,
      upgradeFrom: upgrade?.fromPlanName || null,
      upgradeRemainingDays: upgrade?.remainingDays ?? null,
    });
    return rowToOrder(db.prepare("SELECT * FROM orders WHERE id=?").get(orderId)!);
  });

  if (order.payableCents === 0) {
    // Zero-payable upgrades are fulfilled server-side; there is nothing to collect.
    return finalizePaidOrder(order.id, {
      provider: "none",
      channel: "page",
      tradeNo: `FREE${orderNo}`,
      amountCents: 0,
      verified: true,
      buyerLogonId: null,
      note: "抵扣后应付金额为 0，权益已直接发放",
    });
  }
  return order;
}

export interface PaymentConfirmation {
  provider: string;
  channel: OrderDevice | "page";
  tradeNo: string;
  amountCents: number;
  verified: boolean;
  buyerLogonId?: string | null;
  notifyJson?: Record<string, unknown> | null;
  paidAt?: string;
  note?: string;
}

/**
 * Single entry point for "money arrived". Idempotent and amount-checked:
 * - the order must still be payable (pending/paying/abnormal),
 * - the paid amount must equal the order's payable amount,
 * - benefits are granted in the same transaction as the state change.
 */
export function finalizePaidOrder(orderId: string, confirmation: PaymentConfirmation): Order {
  const order = getOrder(orderId);
  if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
  if (order.status === "paid" || order.status === "partial_refund" || order.status === "refunded") return order;
  if (order.status === "closed" || order.status === "canceled") {
    markOrderAbnormal(order.id, `订单已${order.status === "closed" ? "超时关闭" : "取消"}但收到支付结果`);
    throw new HttpError(409, "ORDER_NOT_PAYABLE", "该订单已关闭，支付结果已记录，请联系客服处理");
  }
  if (new Date(order.expiresAt).getTime() < Date.now() - 60_000) {
    markOrderAbnormal(order.id, "订单已过期仍收到支付结果");
    throw new HttpError(409, "ORDER_EXPIRED", "该订单已过期，支付结果已记录，请联系客服处理");
  }
  if (confirmation.amountCents !== order.payableCents) {
    markOrderAbnormal(order.id, `支付金额不符：收到 ${confirmation.amountCents}，应为 ${order.payableCents}`);
    throw new HttpError(409, "AMOUNT_MISMATCH", "支付金额与订单金额不一致，权益未发放");
  }

  const now = nowIso();
  const paidAt = confirmation.paidAt || now;

  return writeTransaction(() => {
    // One payment row per order (`out_trade_no` is UNIQUE): checkout may already have
    // created it as `created`, so confirmation updates that row instead of inserting.
    markPaymentSuccess(order, {
      provider: confirmation.provider,
      channel: confirmation.channel === "wap" ? "wap" : "page",
      tradeNo: confirmation.tradeNo,
      amountCents: confirmation.amountCents,
      verified: confirmation.verified,
      buyerLogonId: confirmation.buyerLogonId || null,
      notifyJson: confirmation.notifyJson || null,
      paidAt,
    });

    const transition = db.prepare(`UPDATE orders SET status='paid', paid_at=?, updated_at=?
      WHERE id=? AND status IN ('pending','paying','abnormal')`)
      .run(paidAt, now, order.id);
    if (transition.changes !== 1) {
      // Another notification/worker won the race: keep exactly one grant.
      return getOrder(order.id)!;
    }
    recordOrderEvent(order.id, "paid", {
      tradeNo: confirmation.tradeNo, amountCents: confirmation.amountCents,
      provider: confirmation.provider, verified: confirmation.verified, note: confirmation.note || null,
    });
    grantEntitlementForOrder(order);
    return getOrder(order.id)!;
  });
}

export function markOrderAbnormal(orderId: string, reason: string) {
  writeTransaction(() => {
    db.prepare("UPDATE orders SET status='abnormal', updated_at=? WHERE id=? AND status NOT IN ('paid','refunded','partial_refund')")
      .run(nowIso(), orderId);
    recordOrderEvent(orderId, "abnormal", { reason });
  });
}

/** Idempotent: re-opening the cashier keeps one order and only records the device used. */
export function markOrderPaying(orderId: string, channel: OrderDevice) {
  db.prepare("UPDATE orders SET status='paying', device=?, updated_at=? WHERE id=? AND status IN ('pending','paying')")
    .run(channel, nowIso(), orderId);
}

export interface StartPaymentInput {
  orderId: string;
  userId: string;
  channel: AlipayChannel;
  /** Request origin, used only when the operator has not configured callback addresses. */
  requestOrigin?: string;
}

export interface StartPaymentResult {
  payUrl: string;
  channel: AlipayChannel;
  channelText: string;
  orderNo: string;
  productName: string;
  amountCents: number;
  expiresAt: string;
  resultUrl: string;
}

function safeOrigin(value?: string): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

/**
 * Open the cashier for an existing order.
 *
 * Deliberately does not create a second order and does not touch benefits: it checks
 * that the order is still payable, records the payment attempt, and hands back a signed
 * Alipay URL. Fulfilment only ever happens through `finalizePaidOrder`, driven by a
 * verified notification or an active query — never by this redirect.
 */
export function startPayment(input: StartPaymentInput): StartPaymentResult {
  const order = getOrderForUser(input.orderId, input.userId);
  if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
  if (order.status === "paid" || order.status === "partial_refund" || order.status === "refunded") {
    throw new HttpError(409, "ORDER_ALREADY_PAID", "该订单已经支付成功，权益已经到账");
  }
  if (order.status === "closed" || order.status === "canceled") {
    throw new HttpError(409, "ORDER_NOT_PAYABLE", "该订单已经关闭，请重新下单");
  }
  if (order.payableCents <= 0) {
    throw new HttpError(409, "ORDER_NOT_PAYABLE", "该订单无需支付");
  }
  if (new Date(order.expiresAt).getTime() <= Date.now()) {
    // An expired order must never become payable again: close it, then ask for a new one.
    writeTransaction(() => {
      const changed = db.prepare("UPDATE orders SET status='closed', updated_at=? WHERE id=? AND status IN ('pending','paying')")
        .run(nowIso(), order.id).changes;
      if (changed === 1) recordOrderEvent(order.id, "closed", { reason: "超时未支付" });
    });
    throw new HttpError(409, "ORDER_EXPIRED", "该订单已经超过有效期，请重新下单");
  }

  const config = alipayConfig();
  if (!alipayAvailable(config)) {
    throw new HttpError(503, "PAYMENT_CHANNEL_UNAVAILABLE", "支付通道尚未开通，请稍后再试或联系客服");
  }

  const origin = safeOrigin(input.requestOrigin);
  const notifyUrl = config.notifyUrl || (origin ? `${origin}/api/payments/alipay/notify` : "");
  const resultUrl = `/payment/result?orderNo=${encodeURIComponent(order.orderNo)}`;
  const returnUrl = config.returnUrl || (origin ? `${origin}${resultUrl}` : "");

  let payUrl: string;
  try {
    payUrl = buildPaymentUrl({
      orderNo: order.orderNo,
      subject: `${order.snapshot?.name || "Wanke 创作服务"}`,
      body: `Wanke · ${order.snapshot?.name || "创作服务"}（订单 ${order.orderNo}）`,
      amountCents: order.payableCents,
      channel: input.channel,
      notifyUrl,
      returnUrl,
      expiresAt: order.expiresAt,
    }, config);
  } catch {
    // A malformed key or a missing callback address must not leak protocol detail.
    throw new HttpError(503, "PAYMENT_CHANNEL_UNAVAILABLE", "支付通道暂时不可用，请稍后再试或联系客服");
  }

  ensurePaymentRecord(order, { channel: input.channel });
  markOrderPaying(order.id, input.channel === "wap" ? "wap" : "pc");
  recordOrderEvent(order.id, "payment_started", {
    channel: input.channel,
    amountCents: order.payableCents,
    gateway: safeOrigin(config.gatewayUrl) || config.gatewayUrl,
    env: config.env,
  });

  return {
    payUrl,
    channel: input.channel,
    channelText: input.channel === "wap" ? "手机支付" : "电脑支付",
    orderNo: order.orderNo,
    productName: order.snapshot?.name || "",
    amountCents: order.payableCents,
    expiresAt: order.expiresAt,
    resultUrl,
  };
}

export function cancelOrder(orderId: string, userId: string): Order {
  const order = getOrderForUser(orderId, userId);
  if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
  if (order.status === "paid") throw new HttpError(409, "ORDER_ALREADY_PAID", "订单已支付，如需退款请在订单详情申请");
  if (order.status !== "pending" && order.status !== "paying") return order;
  writeTransaction(() => {
    const changed = db.prepare("UPDATE orders SET status='canceled', updated_at=? WHERE id=? AND status IN ('pending','paying')")
      .run(nowIso(), orderId).changes;
    if (changed === 1) recordOrderEvent(orderId, "canceled", { by: "user" });
  });
  return getOrder(orderId)!;
}

/** Worker duty: expire unpaid orders so a stale order can never be paid later. */
export function closeExpiredOrders(limit = 50): number {
  const now = nowIso();
  const rows = db.prepare(`SELECT id FROM orders WHERE status IN ('pending','paying') AND expires_at <= ? ORDER BY expires_at ASC LIMIT ?`)
    .all(now, limit) as Array<{ id: string }>;
  let closed = 0;
  for (const row of rows) {
    const changed = writeTransaction(() => {
      const result = db.prepare("UPDATE orders SET status='closed', updated_at=? WHERE id=? AND status IN ('pending','paying')").run(now, row.id);
      if (result.changes === 1) recordOrderEvent(row.id, "closed", { reason: "超时未支付" });
      return result.changes;
    });
    closed += changed;
  }
  return closed;
}

export interface OrderListFilter {
  userId?: string;
  status?: OrderStatus;
  query?: string;
  planId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function listOrders(filter: OrderListFilter = {}): { total: number; orders: Array<Order & { userEmail?: string | null; userName?: string | null }> } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) { where.push("o.user_id=?"); params.push(filter.userId); }
  if (filter.status) { where.push("o.status=?"); params.push(filter.status); }
  if (filter.planId) { where.push("o.plan_id=?"); params.push(filter.planId); }
  if (filter.query) {
    where.push("(o.order_no LIKE ? OR u.email LIKE ? OR u.name LIKE ?)");
    const like = `%${filter.query}%`;
    params.push(like, like, like);
  }
  if (filter.from) { where.push("o.created_at >= ?"); params.push(filter.from); }
  if (filter.to) { where.push("o.created_at <= ?"); params.push(filter.to); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = db.prepare(`SELECT o.*, u.email AS user_email, u.name AS user_name FROM orders o
    LEFT JOIN users u ON u.id = o.user_id ${whereSql}
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
  const total = Number((db.prepare(`SELECT COUNT(*) AS c FROM orders o LEFT JOIN users u ON u.id=o.user_id ${whereSql}`).get(...params) as any).c || 0);
  return {
    total,
    orders: rows.map(row => ({ ...rowToOrder(row), userEmail: row.user_email || null, userName: row.user_name || null })),
  };
}

export function listOrderItems(orderId: string) {
  return (db.prepare("SELECT * FROM order_items WHERE order_id=? ORDER BY rowid ASC").all(orderId) as any[]).map(row => ({
    id: row.id,
    itemType: row.item_type,
    planId: row.plan_id,
    name: row.name,
    quantity: Number(row.quantity || 1),
    unitPriceCents: Number(row.unit_price_cents || 0),
    amountCents: Number(row.amount_cents || 0),
    credits: Number(row.credits || 0),
    validityDays: Number(row.validity_days || 0),
    snapshot: parseSnapshot(row.snapshot_json),
  }));
}

export function getOrderDetail(orderId: string) {
  const order = getOrder(orderId);
  if (!order) return null;
  const payments = (db.prepare("SELECT * FROM payments WHERE order_id=? ORDER BY created_at DESC").all(orderId) as any[])
    .map(row => ({
      id: row.id, provider: row.provider, channel: row.channel, outTradeNo: row.out_trade_no, tradeNo: row.trade_no,
      amountCents: Number(row.amount_cents || 0), status: row.status, verified: Boolean(row.verified),
      notifyCount: Number(row.notify_count || 0), buyerLogonId: row.buyer_logon_id || null, error: row.error || null,
      paidAt: row.paid_at || null, createdAt: row.created_at,
    }));
  const refunds = (db.prepare("SELECT * FROM refunds WHERE order_id=? ORDER BY created_at DESC").all(orderId) as any[])
    .map(row => ({
      id: row.id, refundNo: row.refund_no, amountCents: Number(row.amount_cents || 0), status: row.status,
      reason: row.reason || "", requestedBy: row.requested_by, creditsReclaimed: Number(row.credits_reclaimed || 0),
      error: row.error || null, createdAt: row.created_at, completedAt: row.completed_at || null,
    }));
  return { order, items: listOrderItems(orderId), payments, refunds, events: listOrderEvents(orderId) };
}
