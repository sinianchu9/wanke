import { NextResponse } from "next/server";
import { businessOverview } from "@/lib/admin";
import { errorResponse, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 经营数据 (§23) + 运营监控 (§46): revenue, payment success, creations, cost and margin,
 * plus the risks an operator has to see before a member reports them — a stopped worker,
 * a task backlog, a creation type failing in a row, abuse blocks and per-user cost alarms.
 */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ business: businessOverview() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
