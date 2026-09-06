import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { createOrder, listOrders, orderTtlMinutes } from "@/lib/billing/orders";
import { ORDER_STATUS_COPY } from "@/lib/copy";
import { publicSiteSettings } from "@/lib/system-settings";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  planId: z.string().min(1).max(64),
  device: z.enum(["pc", "wap"]).optional(),
  clientToken: z.string().min(8).max(128),
});

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const url = new URL(request.url);
    const { orders } = listOrders({ userId: user.id, limit: 50 });
    return NextResponse.json({
      orders: orders.map(order => ({
        id: order.id,
        orderNo: order.orderNo,
        productName: order.snapshot?.name || "",
        kind: order.kind,
        amountCents: order.payableCents,
        credits: order.snapshot?.credits || 0,
        status: order.status,
        statusText: ORDER_STATUS_COPY[order.status]?.label || order.status,
        statusHint: ORDER_STATUS_COPY[order.status]?.hint || "",
        payable: order.payableCents > 0,
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

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = createSchema.parse(await request.json());
    const order = createOrder({ userId: user.id, planId: input.planId, device: input.device, clientToken: input.clientToken });
    const site = publicSiteSettings();
    return NextResponse.json({
      order: {
        id: order.id,
        orderNo: order.orderNo,
        productName: order.snapshot?.name || "",
        kind: order.kind,
        amountCents: order.amountCents,
        discountCents: order.discountCents,
        payableCents: order.payableCents,
        credits: order.snapshot?.credits || 0,
        validityDays: order.snapshot?.validityDays || 0,
        status: order.status,
        statusText: ORDER_STATUS_COPY[order.status]?.label || order.status,
        expiresAt: order.expiresAt,
        ttlMinutes: orderTtlMinutes(),
        createdAt: order.createdAt,
      },
      paymentAvailable: site.paymentEnabled,
    }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
