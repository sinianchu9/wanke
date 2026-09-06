import "server-only";
import { alipayAvailable, alipayConfig, queryRefund, refundTrade } from "@/lib/billing/alipay";
import type { Refund, RefundExecutorResult } from "@/lib/billing/refunds";

/**
 * Alipay refund executor.
 *
 * `fund_change=Y` is the only answer that proves money moved. `fund_change=N` means this
 * very `out_request_no` was already settled before, so it is confirmed with
 * `alipay.trade.fastpay.refund.query`; if that cannot confirm `REFUND_SUCCESS` the refund
 * stays failed with an "unknown result" error for a human to settle. An unknown provider
 * state is never resubmitted automatically — that is how double refunds happen.
 */
export async function runAlipayRefund(
  refund: Refund,
  order: { id: string; orderNo: string; payableCents: number },
): Promise<RefundExecutorResult> {
  const config = alipayConfig();
  if (!alipayAvailable(config)) {
    return { success: false, error: "支付通道未开通或未配置完整，无法原路退款" };
  }

  const call = await refundTrade({
    outTradeNo: order.orderNo,
    outRequestNo: refund.outRequestNo,
    amountCents: refund.amountCents,
    reason: refund.reason,
  }, { config });

  if (call.ok && call.fundChange) {
    return {
      success: true,
      providerRefundNo: call.tradeNo || null,
      result: { fund_change: "Y", refund_fee: call.refundFeeCents, code: call.response.code },
    };
  }

  if (call.ok && !call.fundChange) {
    const confirmation = await queryRefund({ outTradeNo: order.orderNo, outRequestNo: refund.outRequestNo }, { config });
    if (confirmation.refunded) {
      return {
        success: true,
        providerRefundNo: null,
        result: { fund_change: "N", confirmed: "REFUND_SUCCESS", refundAmountCents: confirmation.refundAmountCents },
      };
    }
    return {
      success: false,
      error: "退款结果未知：支付宝没有返回资金变动，退款查询也没有确认成功。请到支付宝商家后台核对后人工处理，不要重复提交。",
      result: { fund_change: "N", query: confirmation.response.data },
    };
  }

  const detail = [call.response.code, call.response.subCode, call.response.subMsg || call.response.msg].filter(Boolean).join(" ");
  return { success: false, error: `支付宝退款未成功：${detail || "未知原因"}`, result: call.response.data };
}
