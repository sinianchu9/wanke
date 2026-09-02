import { NextResponse } from "next/server";
import { listAuditLogs } from "@/lib/admin";
import { errorResponse, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ logs: listAuditLogs() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
