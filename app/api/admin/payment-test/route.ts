import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";
import { describeAlipayChannel, testAlipayConnection } from "@/lib/billing/alipay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Payment channel state for 管理后台 → 支付设置. Key material is never returned. */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ channel: describeAlipayChannel() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

/**
 * Free connection test: query an order number that cannot exist. `ACQ.TRADE_NOT_EXIST`
 * proves the app_id, private key and gateway are all accepted, without moving money.
 */
export async function POST(request: Request) {
  try {
    const admin = requireAdmin(request);
    const result = await testAlipayConnection();
    writeAudit(admin.id, "payment.test", "settings", "alipay", {
      ok: result.ok,
      env: result.detail?.env ?? null,
      code: result.detail?.code ?? null,
      subCode: result.detail?.subCode ?? null,
      warnings: result.warnings.length,
    });
    return NextResponse.json({ ok: result.ok, result, channel: describeAlipayChannel() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
