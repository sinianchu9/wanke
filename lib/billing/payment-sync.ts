import "server-only";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { finalizePaidOrder, markOrderAbnormal, recordOrderEvent, type Order } from "@/lib/billing/orders";
import { getPaymentByOutTradeNo, markPaymentAbnormal, markPaymentClosed } from "@/lib/billing/payments";
import { queryTrade, alipayAvailable, alipayConfig, beijingToIso, type AlipayChannel } from "@/lib/billing/alipay";
import { writeTransaction } from "@/lib/billing/quota";

/**
 * Active order query.
 *
 * The notification is the primary source of truth, but it can be late, lost or blocked.
 * This module asks Alipay directly and feeds the answer through the very same guarded
 * `finalizePaidOrder` path, so a member who closes the browser, a delayed callback and a
 * manual refresh all converge on one fulfilment — never two.
 */

export interface SyncResult {
  /** True when the order reached a state that will not change by itself any more. */
  settled: boolean;
  status: Order["status"];
  /** What the provider told us, in words an operator can act on. */
  note: string;
  providerAsked: boolean;
  tradeStatus: string;
}

function nowIso() {
  return new Date().toISOString();
}

function terminalNote(order: Order): SyncResult {
  const settled = !["pending", "paying"].includes(order.status);
  return { settled, status: order.status, note: "", providerAsked: false, tradeStatus: "" };
}

export async function syncOrderWithProvider(order: Order): Promise<SyncResult> {
  if (!["pending", "paying", "abnormal"].includes(order.status)) return terminalNote(order);
  const config = alipayConfig();
  if (!alipayAvailable(config)) {
    return { settled: false, status: order.status, note: "支付通道未开通，无法主动查询", providerAsked: false, tradeStatus: "" };
  }

  let trade;
  try {
    trade = await queryTrade(order.orderNo, { config });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { settled: false, status: order.status, note: `查询支付结果失败：${reason.slice(0, 200)}`, providerAsked: true, tradeStatus: "" };
  }

  const response = trade.response;
  if (!trade.found) {
    // `ACQ.TRADE_NOT_EXIST` simply means the buyer has not paid (or never opened the
    // cashier). It is never "payment failed".
    const note = response.subCode === "ACQ.TRADE_NOT_EXIST"
      ? "支付宝还没有收到这笔付款"
      : `查询未返回交易：${[response.code, response.subCode, response.subMsg || response.msg].filter(Boolean).join(" ")}`;
    return { settled: false, status: order.status, note, providerAsked: true, tradeStatus: "" };
  }

  if (trade.paid) {
    if (trade.amountCents === null || trade.amountCents !== order.payableCents) {
      const reason = `主动查询金额不符：支付宝 ¥${((trade.amountCents ?? 0) / 100).toFixed(2)}，订单应付 ¥${(order.payableCents / 100).toFixed(2)}`;
      markOrderAbnormal(order.id, reason);
      const payment = getPaymentByOutTradeNo(order.orderNo);
      if (payment) markPaymentAbnormal(payment.id, reason);
      recordOrderEvent(order.id, "payment_abnormal", { reason, source: "active_query", tradeNo: trade.tradeNo });
      return { settled: true, status: "abnormal", note: reason, providerAsked: true, tradeStatus: trade.status };
    }
    if (config.sellerId && trade.sellerId && trade.sellerId !== config.sellerId) {
      const reason = `主动查询收款主体不符：支付宝 ${trade.sellerId}，配置 ${config.sellerId}`;
      markOrderAbnormal(order.id, reason);
      recordOrderEvent(order.id, "payment_abnormal", { reason, source: "active_query" });
      return { settled: true, status: "abnormal", note: reason, providerAsked: true, tradeStatus: trade.status };
    }
    if (order.status === "abnormal") {
      // A previously abnormal order that Alipay confirms as paid is settled properly.
      recordOrderEvent(order.id, "payment_recovered", { source: "active_query", tradeNo: trade.tradeNo });
    }
    try {
      const channel: AlipayChannel = getPaymentByOutTradeNo(order.orderNo)?.channel
        || (order.device === "wap" ? "wap" : "page");
      const paid = finalizePaidOrder(order.id, {
        provider: "alipay",
        channel,
        tradeNo: trade.tradeNo || `QUERY${order.orderNo}`,
        amountCents: trade.amountCents,
        verified: true,
        buyerLogonId: trade.buyerLogonId || null,
        notifyJson: { source: "active_query", trade_status: trade.status },
        paidAt: trade.paidAt || nowIso(),
        note: "主动查询确认支付成功",
      });
      return { settled: true, status: paid.status, note: "支付成功，权益已经到账", providerAsked: true, tradeStatus: trade.status };
    } catch (error) {
      if (error instanceof HttpError) {
        return { settled: true, status: "abnormal", note: error.message, providerAsked: true, tradeStatus: trade.status };
      }
      throw error;
    }
  }

  if (trade.status === "TRADE_CLOSED") {
    writeTransaction(() => {
      const changed = db.prepare("UPDATE orders SET status='closed', updated_at=? WHERE id=? AND status IN ('pending','paying')")
        .run(nowIso(), order.id).changes;
      if (changed === 1) recordOrderEvent(order.id, "closed", { reason: "支付宝交易关闭", tradeNo: trade.tradeNo, source: "active_query" });
    });
    const payment = getPaymentByOutTradeNo(order.orderNo);
    if (payment) markPaymentClosed(payment.id);
    const current = db.prepare("SELECT status FROM orders WHERE id=?").get(order.id) as { status: Order["status"] };
    return { settled: true, status: current.status, note: "交易已关闭", providerAsked: true, tradeStatus: trade.status };
  }

  return {
    settled: false,
    status: order.status,
    note: trade.status === "WAIT_BUYER_PAY" ? "买家已下单，等待付款" : `交易状态 ${trade.status}`,
    providerAsked: true,
    tradeStatus: trade.status,
  };
}
