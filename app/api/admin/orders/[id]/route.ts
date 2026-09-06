import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { getOrderDetail } from "@/lib/billing/orders";
import { refundEligibility } from "@/lib/billing/refunds";
import { ORDER_STATUS_COPY } from "@/lib/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    requireAdmin(request);
    const { id } = await ctx.params;
    const detail = getOrderDetail(id);
    if (!detail) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
    return NextResponse.json({
      ...detail,
      statusText: ORDER_STATUS_COPY[detail.order.status]?.label || detail.order.status,
      refundEligibility: refundEligibility(detail.order.id),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
