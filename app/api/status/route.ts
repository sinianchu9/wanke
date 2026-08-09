import { NextResponse } from "next/server";
import { yikeConfigSummary } from "@/lib/yike/client";
import { testConnection } from "@/lib/yike/provider";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const summary = yikeConfigSummary();
  if (!summary.configured) return NextResponse.json({ ...summary, connected: false, error: "未配置凭证" });
  if (new URL(request.url).searchParams.get("probe") !== "1") return NextResponse.json({ ...summary, connected: null });
  try {
    const result = await testConnection();
    return NextResponse.json({ ...summary, connected: result.ok, ...result, ...(result.ok ? {} : { error: result.core?.error || "核心 API 连接失败" }) });
  } catch (error) {
    return NextResponse.json({ ...summary, connected: false, error: describeError(error) });
  }
}
