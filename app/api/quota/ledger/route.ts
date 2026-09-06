import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/auth";
import { listLedger } from "@/lib/billing/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);
    const { total, entries } = listLedger(user.id, { limit, offset });
    return NextResponse.json({
      total,
      entries: entries.map(entry => ({
        id: entry.id,
        delta: entry.delta,
        balanceAfter: entry.balanceAfter,
        reasonText: entry.reasonText,
        note: entry.note,
        createdAt: entry.createdAt,
      })),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
