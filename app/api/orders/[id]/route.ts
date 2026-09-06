import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { cancelOrder, getOrderDetail } from "@/lib/billing/orders";
import { refundEligibility } from "@/lib/billing/refunds";
import { ORDER_STATUS_COPY, PAYMENT_STATUS_COPY, REFUND_STATUS_COPY } from "@/lib/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    const detail = getOrderDetail(id);
    // Cross-user access is reported as "not found" so order numbers cannot be probed.
    if (!detail || detail.order.userId !== user.id) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
    const { order, items, payments, refunds } = detail;
    return NextResponse.json({
      order: {
        id: order.id,
        orderNo: order.orderNo,
        kind: order.kind,
        status: order.status,
        statusText: ORDER_STATUS_COPY[order.status]?.label || order.status,
        statusHint: ORDER_STATUS_COPY[order.status]?.hint || "",
        productName: order.snapshot?.name || "",
        productSubtitle: order.snapshot?.subtitle || "",
        credits: order.snapshot?.credits || 0,
        validityDays: order.snapshot?.validityDays || 0,
        amountCents: order.amountCents,
        discountCents: order.discountCents,
        payableCents: order.payableCents,
        refundedCents: order.refundedCents,
        createdAt: order.createdAt,
        expiresAt: order.expiresAt,
        paidAt: order.paidAt,
      },
      items: items.map(item => ({ name: item.name, credits: item.credits, validityDays: item.validityDays, amountCents: item.amountCents })),
      payments: payments.map(payment => ({
        channel: payment.channel === "wap" ? "手机支付" : "电脑支付",
        amountCents: payment.amountCents,
        statusText: PAYMENT_STATUS_COPY[payment.status] || payment.status,
        paidAt: payment.paidAt,
      })),
      refunds: refunds.map(refund => ({
        refundNo: refund.refundNo,
        amountCents: refund.amountCents,
        statusText: REFUND_STATUS_COPY[refund.status] || refund.status,
        reason: refund.reason,
        createdAt: refund.createdAt,
        completedAt: refund.completedAt,
      })),
      refundEligibility: refundEligibility(order.id),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "cancel") throw new HttpError(400, "UNSUPPORTED_ACTION", "不支持的操作");
    const order = cancelOrder(id, user.id);
    return NextResponse.json({
      ok: true,
      order: { id: order.id, status: order.status, statusText: ORDER_STATUS_COPY[order.status]?.label || order.status },
    });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
