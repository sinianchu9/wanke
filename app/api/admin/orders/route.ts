import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { listOrders, type OrderStatus } from "@/lib/billing/orders";
import { ORDER_STATUS_COPY } from "@/lib/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: OrderStatus[] = ["pending", "paying", "paid", "closed", "canceled", "partial_refund", "refunded", "abnormal"];

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "";
    const { total, orders } = listOrders({
      query: url.searchParams.get("query") || undefined,
      status: STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
      planId: url.searchParams.get("planId") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      limit: Number(url.searchParams.get("limit") || 50),
      offset: Number(url.searchParams.get("offset") || 0),
    });
    return NextResponse.json({
      total,
      orders: orders.map(order => ({
        id: order.id,
        orderNo: order.orderNo,
        userId: order.userId,
        userEmail: order.userEmail,
        userName: order.userName,
        productName: order.snapshot?.name || order.planId,
        kind: order.kind,
        amountCents: order.amountCents,
        discountCents: order.discountCents,
        payableCents: order.payableCents,
        refundedCents: order.refundedCents,
        status: order.status,
        statusText: ORDER_STATUS_COPY[order.status]?.label || order.status,
        device: order.device,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        expiresAt: order.expiresAt,
      })),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
