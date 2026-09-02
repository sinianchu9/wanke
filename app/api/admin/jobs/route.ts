import { NextResponse } from "next/server";
import { listAdminJobs } from "@/lib/admin";
import { errorResponse, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const result = listAdminJobs({
      userId: url.searchParams.get("userId") || undefined,
      status: url.searchParams.get("status") || undefined,
      kind: url.searchParams.get("kind") || undefined,
      limit: Number(url.searchParams.get("limit") || 50) || 50,
      offset: Number(url.searchParams.get("offset") || 0) || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
