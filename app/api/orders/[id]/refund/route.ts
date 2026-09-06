import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { REFUND_STATUS_COPY } from "@/lib/copy";
import { publicErrorMessage } from "@/lib/copy";
import { requestRefund } from "@/lib/billing/refunds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ reason: z.string().trim().min(2).max(500) });

/**
 * A member can ask for a refund; only an operator can release the money. The request is
 * recorded with the order and stays `requested` until the backoffice approves it.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    const input = schema.parse(await request.json().catch(() => ({})));
    const { refund, reused } = requestRefund({
      orderId: id,
      requestedBy: "user",
      userId: user.id,
      reason: input.reason,
    });
    const alreadyInFlight = reused;
    return NextResponse.json({
      ok: true,
      refund: {
        refundNo: refund.refundNo,
        amountCents: refund.amountCents,
        status: refund.status,
        statusText: REFUND_STATUS_COPY[refund.status] || refund.status,
      },
      notice: alreadyInFlight
        ? "这笔订单的退款申请已经在处理中，无需重复提交。"
        : "退款申请已经提交，我们会尽快处理，结果会在通知中心和订单详情里更新。",
    }, { status: alreadyInFlight ? 200 : 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "请填写退款原因（至少 2 个字）" }, { status: 400 });
    // Members never see raw protocol or crypto output.
    return NextResponse.json({ error: publicErrorMessage(error) || "操作没有完成，请稍后再试" }, { status: 400 });
  }
}
