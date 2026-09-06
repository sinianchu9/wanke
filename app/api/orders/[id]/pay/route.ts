import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { getOrderForUser } from "@/lib/billing/orders";
import { getBooleanSetting, getSetting } from "@/lib/system-settings";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ channel: z.enum(["page", "wap"]).default("page") });

export async function POST(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    const input = schema.parse(await request.json().catch(() => ({})));
    const order = getOrderForUser(id, user.id);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "订单不存在");
    if (order.status === "paid") throw new HttpError(409, "ORDER_ALREADY_PAID", "该订单已经支付成功");
    if (order.status === "closed" || order.status === "canceled") {
      throw new HttpError(409, "ORDER_NOT_PAYABLE", "该订单已经关闭，请重新下单");
    }
    if (!getBooleanSetting("alipay_enabled") || !getSetting("alipay_app_id")) {
      throw new HttpError(503, "PAYMENT_CHANNEL_UNAVAILABLE", "支付通道尚未开通，请稍后再试或联系客服");
    }
    void input.channel;
    throw new HttpError(503, "PAYMENT_CHANNEL_UNAVAILABLE", "支付通道尚未开通，请稍后再试或联系客服");
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
