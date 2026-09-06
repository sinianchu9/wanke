import "server-only";
import { HttpError } from "@/lib/auth";
import { db } from "@/lib/db";
import { finalizePaidOrder, getOrder, markOrderAbnormal, recordOrderEvent, type Order } from "@/lib/billing/orders";
import {
  bumpNotifyCount, getPaymentByOutTradeNo, markPaymentAbnormal, markPaymentClosed, recordNotification,
} from "@/lib/billing/payments";
import {
  TRADE_SUCCESS_STATUSES, alipayConfig, beijingToIso, verifyNotifySignature, yuanToCents,
  type AlipayChannel, type AlipayConfig,
} from "@/lib/billing/alipay";
import { writeTransaction } from "@/lib/billing/quota";

/**
 * Asynchronous payment notification handling.
 *
 * Rules this module lives by:
 * - Signature first. Nothing is believed before the notification is verified with the
 *   Alipay public key, and every inbound notification is stored raw (verified or not)
 *   so "the same notification ten times" and "a forged notification" are provable.
 * - Money facts are cross-checked: app_id, merchant order number, amount and payee.
 * - Fulfilment is delegated to `finalizePaidOrder`, whose guarded state transition and
 *   `order:<id>` ledger key make duplicate notifications grant benefits exactly once.
 * - `success` is returned when retrying cannot change the outcome (processed, duplicate,
 *   or recorded for manual handling); `failure` only when a retry could still help
 *   (bad signature, unknown order number, internal error).
 */

export type NotifyReply = "success" | "failure";

export interface NotifyOutcome {
  reply: NotifyReply;
  reason: string;
  verified: boolean;
  accepted: boolean;
  duplicate: boolean;
  orderId: string | null;
  outTradeNo: string;
  tradeStatus: string;
}

function nowIso() {
  return new Date().toISOString();
}

export function handleAlipayNotification(params: Record<string, string>): NotifyOutcome {
  const outTradeNo = String(params.out_trade_no || "").trim();
  const tradeNo = String(params.trade_no || "").trim();
  const tradeStatus = String(params.trade_status || "").trim();
  const amountCents = yuanToCents(params.total_amount);
  const config = alipayConfig();

  const base = { outTradeNo, tradeStatus, orderId: null as string | null };

  const verification = verifyNotifySignature(params, config);
  if (!verification.verified) {
    recordNotification({
      payload: params, outTradeNo, tradeNo, amountCents, tradeStatus,
      verified: false, accepted: false, orderId: null, error: verification.reason,
    });
    return { ...base, reply: "failure", reason: verification.reason, verified: false, accepted: false, duplicate: false };
  }

  const appId = String(params.app_id || "").trim();
  if (!config.appId || appId !== config.appId) {
    const reason = config.appId ? `应用编号不匹配（通知 ${appId || "空"}）` : "平台还没有配置应用编号";
    recordNotification({
      payload: params, outTradeNo, tradeNo, amountCents, tradeStatus,
      verified: true, accepted: false, orderId: null, error: reason,
    });
    return { ...base, reply: "failure", reason, verified: true, accepted: false, duplicate: false };
  }

  if (!outTradeNo) {
    const reason = "通知缺少商户订单号";
    recordNotification({
      payload: params, outTradeNo: "", tradeNo, amountCents, tradeStatus,
      verified: true, accepted: false, orderId: null, error: reason,
    });
    return { ...base, reply: "failure", reason, verified: true, accepted: false, duplicate: false };
  }

  const order = getOrder(outTradeNo);
  if (!order) {
    // Signed by Alipay but unknown to us: retrying for 24h cannot fix it, so stop the
    // retries and keep the evidence for the operator (it surfaces in 经营概览).
    const reason = `商户订单号 ${outTradeNo} 不存在`;
    recordNotification({
      payload: params, outTradeNo, tradeNo, amountCents, tradeStatus,
      verified: true, accepted: false, orderId: null, error: reason,
    });
    return { ...base, reply: "success", reason, verified: true, accepted: false, duplicate: false };
  }

  bumpNotifyCount(outTradeNo);
  const withOrder = { ...base, orderId: order.id, verified: true };

  try {
    if ((TRADE_SUCCESS_STATUSES as readonly string[]).includes(tradeStatus)) {
      return handleTradeSuccess(withOrder, params, { order, tradeNo, amountCents, config });
    }
    if (tradeStatus === "WAIT_BUYER_PAY") {
      recordOrderEvent(order.id, "payment_waiting", { tradeNo, note: "买家已下单，等待付款" });
      recordNotification({
        payload: params, outTradeNo, tradeNo, amountCents, tradeStatus,
        verified: true, accepted: true, orderId: order.id, error: null,
      });
      return { ...withOrder, reply: "success", reason: "等待买家付款", accepted: true, duplicate: false };
    }
    if (tradeStatus === "TRADE_CLOSED") {
      return handleTradeClosed(withOrder, params, { order, tradeNo, amountCents });
    }
    const reason = `未知的交易状态 ${tradeStatus || "（空）"}`;
    recordNotification({
      payload: params, outTradeNo, tradeNo, amountCents, tradeStatus,
      verified: true, accepted: false, orderId: order.id, error: reason,
    });
    return { ...withOrder, reply: "success", reason, accepted: false, duplicate: false };
  } catch (error) {
    // Anything unexpected (database, disk) must be retried by Alipay.
    const reason = error instanceof Error ? error.message : String(error);
    recordNotification({
      payload: params, outTradeNo, tradeNo, amountCents, tradeStatus,
      verified: true, accepted: false, orderId: order.id, error: reason.slice(0, 500),
    });
    return { ...withOrder, reply: "failure", reason: "平台内部错误，等待支付宝重试", accepted: false, duplicate: false };
  }
}

function handleTradeSuccess(
  withOrder: { outTradeNo: string; tradeStatus: string; orderId: string; verified: boolean },
  params: Record<string, string>,
  context: { order: Order; tradeNo: string; amountCents: number | null; config: AlipayConfig },
): NotifyOutcome {
  const { order, tradeNo, amountCents, config } = context;
  const outTradeNo = order.orderNo;
  const buyerLogonId = String(params.buyer_logon_id || "").trim() || null;
  const sellerId = String(params.seller_id || "").trim();

  const abnormal = (reason: string): NotifyOutcome => {
    markOrderAbnormal(order.id, reason);
    const payment = getPaymentByOutTradeNo(outTradeNo);
    if (payment) markPaymentAbnormal(payment.id, reason);
    recordOrderEvent(order.id, "payment_abnormal", { tradeNo, reason, amountCents, sellerId: sellerId || null });
    recordNotification({
      payload: params, outTradeNo, tradeNo, amountCents, tradeStatus: withOrder.tradeStatus,
      verified: true, accepted: false, orderId: order.id, error: reason,
    });
    // The money exists but does not match this order: a human must settle it, and
    // another 24h of retries would not change that.
    return { ...withOrder, reply: "success", reason, accepted: false, duplicate: false };
  };

  if (amountCents === null) return abnormal(`到账金额无法解析：${String(params.total_amount || "（空）")}`);
  if (amountCents !== order.payableCents) {
    return abnormal(`支付金额不符：到账 ¥${(amountCents / 100).toFixed(2)}，订单应付 ¥${(order.payableCents / 100).toFixed(2)}`);
  }
  if (config.sellerId && sellerId && sellerId !== config.sellerId) {
    return abnormal(`收款主体不符：通知 ${sellerId}，配置 ${config.sellerId}`);
  }

  const alreadyPaid = order.status === "paid" || order.status === "partial_refund" || order.status === "refunded";
  const channel: AlipayChannel = getPaymentByOutTradeNo(outTradeNo)?.channel
    || (order.device === "wap" ? "wap" : "page");

  try {
    finalizePaidOrder(order.id, {
      provider: "alipay",
      channel,
      tradeNo: tradeNo || `NOTRADE${outTradeNo}`,
      amountCents,
      verified: true,
      buyerLogonId,
      notifyJson: params,
      paidAt: beijingToIso(params.gmt_payment) || nowIso(),
      note: "支付宝异步通知",
    });
  } catch (error) {
    // Expired/closed/amount problems are already marked abnormal by the order service.
    if (error instanceof HttpError) {
      recordNotification({
        payload: params, outTradeNo, tradeNo, amountCents, tradeStatus: withOrder.tradeStatus,
        verified: true, accepted: false, orderId: order.id, error: error.message,
      });
      return { ...withOrder, reply: "success", reason: error.message, accepted: false, duplicate: false };
    }
    throw error;
  }

  recordNotification({
    payload: params, outTradeNo, tradeNo, amountCents, tradeStatus: withOrder.tradeStatus,
    verified: true, accepted: true, orderId: order.id, error: null,
  });
  return {
    ...withOrder,
    reply: "success",
    reason: alreadyPaid ? "重复通知：权益此前已经发放" : "支付成功，权益已经发放",
    accepted: true,
    duplicate: alreadyPaid,
  };
}

function handleTradeClosed(
  withOrder: { outTradeNo: string; tradeStatus: string; orderId: string; verified: boolean },
  params: Record<string, string>,
  context: { order: Order; tradeNo: string; amountCents: number | null },
): NotifyOutcome {
  const { order, tradeNo, amountCents } = context;
  const outTradeNo = order.orderNo;

  if (order.status === "paid" || order.status === "partial_refund") {
    const reason = "已支付订单收到交易关闭通知，需要人工核对";
    markOrderAbnormal(order.id, reason);
    recordNotification({
      payload: params, outTradeNo, tradeNo, amountCents, tradeStatus: "TRADE_CLOSED",
      verified: true, accepted: false, orderId: order.id, error: reason,
    });
    return { ...withOrder, reply: "success", reason, accepted: false, duplicate: false };
  }

  writeTransaction(() => {
    const changed = db.prepare("UPDATE orders SET status='closed', updated_at=? WHERE id=? AND status IN ('pending','paying','abnormal')")
      .run(nowIso(), order.id).changes;
    if (changed === 1) recordOrderEvent(order.id, "closed", { reason: "支付宝交易关闭", tradeNo });
  });
  const payment = getPaymentByOutTradeNo(outTradeNo);
  if (payment) markPaymentClosed(payment.id);
  recordNotification({
    payload: params, outTradeNo, tradeNo, amountCents, tradeStatus: "TRADE_CLOSED",
    verified: true, accepted: true, orderId: order.id, error: null,
  });
  return { ...withOrder, reply: "success", reason: "交易已关闭", accepted: true, duplicate: false };
}

/** Parse Alipay's `application/x-www-form-urlencoded` notification body. */
export function parseNotifyBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  new URLSearchParams(body).forEach((value, key) => { params[key] = value; });
  return params;
}
