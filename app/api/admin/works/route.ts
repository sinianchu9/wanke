import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { listAllWorks } from "@/lib/works";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ works: listAllWorks() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
