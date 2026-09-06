import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";
import { describeError } from "@/lib/errors";
import { approveRefund, executeRefund, getRefund, refundView, rejectRefund } from "@/lib/billing/refunds";
import { runAlipayRefund } from "@/lib/billing/refund-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum(["approve", "reject", "execute"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Approve, reject or release a refund. Every branch is a guarded state transition, so
 * clicking twice cannot refund twice and a rejected request cannot be paid out later
 * without going through the flow again.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const admin = requireAdmin(request);
    const { id } = await ctx.params;
    const input = schema.parse(await request.json().catch(() => ({})));
    const existing = getRefund(id);
    if (!existing) throw new HttpError(404, "REFUND_NOT_FOUND", "退款记录不存在");

    let refund = existing;
    if (input.action === "approve") {
      refund = approveRefund(id, admin.id);
      writeAudit(admin.id, "refund.approve", "refund", refund.id, { refundNo: refund.refundNo });
    } else if (input.action === "reject") {
      refund = rejectRefund(id, admin.id, input.reason || "");
      writeAudit(admin.id, "refund.reject", "refund", refund.id, { refundNo: refund.refundNo, reason: input.reason || "" });
    } else {
      refund = await executeRefund(id, runAlipayRefund, admin.id);
      writeAudit(admin.id, "refund.execute", "refund", refund.id, {
        refundNo: refund.refundNo, status: refund.status, amountCents: refund.amountCents, error: refund.error,
      });
    }
    return NextResponse.json({ ok: true, refund: refundView(refund) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "操作不正确" }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
