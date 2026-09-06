import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";
import { REFUND_STATUS_COPY } from "@/lib/copy";
import { describeError } from "@/lib/errors";
import { executeRefund, listRefunds, refundView, requestRefund } from "@/lib/billing/refunds";
import { runAlipayRefund } from "@/lib/billing/refund-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["requested", "approved", "processing", "succeeded", "failed", "rejected"] as const;

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const createSchema = z.object({
  orderId: z.string().min(1).max(64),
  reason: z.string().trim().min(2).max(500),
  amountCents: z.number().int().positive().optional(),
  execute: z.boolean().default(true),
});

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const input = listSchema.parse({
      status: url.searchParams.get("status") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    const { total, refunds } = listRefunds({ status: input.status, limit: input.limit });
    return NextResponse.json({ total, refunds: refunds.map(refundView) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "查询条件不正确" }, { status: 400 });
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

/**
 * Operator-initiated refund: create the record (already approved, since an operator is
 * the approver) and, unless asked not to, release the money through Alipay immediately.
 */
export async function POST(request: Request) {
  try {
    const admin = requireAdmin(request);
    const input = createSchema.parse(await request.json());
    const requested = requestRefund({
      orderId: input.orderId,
      requestedBy: "admin",
      adminUserId: admin.id,
      reason: input.reason,
      amountCents: input.amountCents,
    });
    if (requested.reused) {
      // An operator must see the record that already exists rather than a second one.
      throw new HttpError(409, "REFUND_IN_FLIGHT", `该订单已经有正在处理的退款 ${requested.refund.refundNo}`);
    }
    let refund = requested.refund;
    writeAudit(admin.id, "refund.request", "order", refund.orderId, {
      refundNo: refund.refundNo, amountCents: refund.amountCents, reason: input.reason,
    });
    if (input.execute) {
      refund = await executeRefund(refund.id, runAlipayRefund, admin.id);
      writeAudit(admin.id, "refund.execute", "refund", refund.id, {
        refundNo: refund.refundNo, status: refund.status, amountCents: refund.amountCents,
      });
    }
    return NextResponse.json({ ok: true, refund: refundView(refund) }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "退款信息填写不正确" }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
