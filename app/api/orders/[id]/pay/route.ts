import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { startPayment } from "@/lib/billing/orders";
import { publicBaseUrl } from "@/lib/mailer";
import { publicErrorMessage } from "@/lib/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ channel: z.enum(["page", "wap"]).default("page") });

/**
 * Open the Alipay cashier for an existing order.
 *
 * The browser is redirected to the returned URL; benefits are never granted here.
 * Fulfilment happens only through the verified notification or an active query, so
 * closing the browser right after paying still results in a delivered order.
 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    const input = schema.parse(await request.json().catch(() => ({})));
    const result = startPayment({
      orderId: id,
      userId: user.id,
      channel: input.channel,
      requestOrigin: publicBaseUrl(request),
    });
    return NextResponse.json({
      ok: true,
      payUrl: result.payUrl,
      orderNo: result.orderNo,
      productName: result.productName,
      amountCents: result.amountCents,
      channel: result.channel,
      channelText: result.channelText,
      expiresAt: result.expiresAt,
      resultUrl: result.resultUrl,
      notice: "支付完成后权益会自动到账。如果没有自动跳转，请回到「我的订单」查看结果，不要重复付款。",
    });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "支付方式不正确，请重新选择" }, { status: 400 });
    // Members never see raw protocol or crypto output.
    return NextResponse.json({ error: publicErrorMessage(error) || "操作没有完成，请稍后再试" }, { status: 400 });
  }
}
