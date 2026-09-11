import { NextResponse } from "next/server";
import { errorResponse, getCurrentUser, HttpError } from "@/lib/auth";
import { getOrder, getOrderForUser } from "@/lib/billing/orders";
import { syncOrderWithProvider } from "@/lib/billing/payment-sync";
import { ORDER_STATUS_COPY, PAYMENT_RESULT_COPY } from "@/lib/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The result page polls while a payment is in flight; this keeps one member's refresh
// from turning into a flood of gateway queries.
const QUERY_THROTTLE_MS = 3000;
const lastQueryAt = new Map<string, number>();

/**
 * Member-facing payment status. Answers from the database first, and only while the
 * order is still in flight does it ask Alipay directly — then it settles the order
 * server-side through the same guarded path as the notification. It never reports
 * "payment failed" for money that may still arrive.
 */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const user = getCurrentUser(request);
    const { id } = await ctx.params;
    const order = user ? getOrderForUser(id, user.id) : getOrder(id);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");

    let note = "";
    let providerAsked = false;
    let current = order;

    if (order.status === "pending" || order.status === "paying") {
      const last = lastQueryAt.get(order.id) || 0;
      if (Date.now() - last >= QUERY_THROTTLE_MS) {
        lastQueryAt.set(order.id, Date.now());
        const sync = await syncOrderWithProvider(order);
        note = sync.note;
        providerAsked = sync.providerAsked;
        current = user ? (getOrderForUser(id, user.id) || order) : (getOrder(id) || order);
      }
    }

    const copy = PAYMENT_RESULT_COPY[current.status] || PAYMENT_RESULT_COPY.paying;
    return NextResponse.json({
      orderNo: current.orderNo,
      productName: current.snapshot?.name || "",
      credits: current.snapshot?.credits || 0,
      amountCents: current.payableCents,
      status: current.status,
      statusText: ORDER_STATUS_COPY[current.status]?.label || current.status,
      headline: copy.headline,
      hint: user ? copy.hint : (current.status === "paid" ? "套餐或创作额度已经发放，登录下单账号即可开始创作。" : copy.hint),
      tone: copy.tone,
      settled: copy.settled,
      providerAsked,
      note,
      paidAt: current.paidAt,
      expiresAt: current.expiresAt,
      refundable: Boolean(user && (current.status === "paid" || current.status === "partial_refund")),
      isLoggedIn: Boolean(user),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
