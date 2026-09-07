import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { runStorageSweep, storageStats } from "@/lib/storage-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator storage view (§9.3.10): totals, per-user and per-bucket usage, the
 * registry-vs-disk reconciliation, disk headroom, the last housekeeping sweep and
 * the manual "sweep now" action. Members never see any of this.
 */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ storage: storageStats() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    if (body?.action !== "sweep") return NextResponse.json({ error: "未知操作" }, { status: 400 });
    const summary = runStorageSweep();
    return NextResponse.json({ sweep: summary, storage: storageStats() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
