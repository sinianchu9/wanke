import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";
import { getOrder, getOrderDetail } from "@/lib/billing/orders";
import { syncOrderWithProvider } from "@/lib/billing/payment-sync";
import { ORDER_STATUS_COPY } from "@/lib/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Operator-triggered active query. Same guarded settlement path as the member-facing
 * status check, so a late or lost notification can be recovered without hand-editing
 * an order — and a paid order can never be created here.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const admin = requireAdmin(request);
    const { id } = await ctx.params;
    const order = getOrder(id);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
    const sync = await syncOrderWithProvider(order);
    const current = getOrder(order.id)!;
    writeAudit(admin.id, "order.sync", "order", order.id, {
      from: order.status, to: current.status, providerAsked: sync.providerAsked,
      tradeStatus: sync.tradeStatus, note: sync.note.slice(0, 200),
    });
    return NextResponse.json({
      ok: true,
      settled: sync.settled,
      note: sync.note,
      providerAsked: sync.providerAsked,
      tradeStatus: sync.tradeStatus,
      order: {
        id: current.id,
        orderNo: current.orderNo,
        status: current.status,
        statusText: ORDER_STATUS_COPY[current.status]?.label || current.status,
      },
      detail: getOrderDetail(current.id),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
