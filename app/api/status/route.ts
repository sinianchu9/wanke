import { NextResponse } from "next/server";
import { yikeConfigSummary } from "@/lib/yike/client";
import { testConnection } from "@/lib/yike/provider";
import { modelStudioConfigSummary } from "@/lib/video/modelstudio";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const yike = yikeConfigSummary();
  const modelStudio = modelStudioConfigSummary();
  const configured = modelStudio.configured || yike.configured;
  const summary = {
    configured,
    regionId: "ap-southeast-1",
    regionName: "新加坡",
    endpoint: modelStudio.configured ? modelStudio.endpoint : yike.endpoint,
    modelStudio,
    yike,
  };

  if (!configured) return NextResponse.json({ ...summary, connected: false, error: "未配置百炼或 Yike 凭证" });
  if (new URL(request.url).searchParams.get("probe") !== "1") return NextResponse.json({ ...summary, connected: null });

  if (!yike.configured) {
    return NextResponse.json({ ...summary, connected: modelStudio.configured, generationReady: modelStudio.configured, note: "视频生成已配置百炼 Model Studio 直连；未配置 Yike，因此其他旧工作流暂不可用。" });
  }

  try {
    const result = await testConnection();
    return NextResponse.json({
      ...summary,
      connected: modelStudio.configured || result.ok,
      generationReady: modelStudio.configured || result.ok,
      ...result,
      ...(result.ok || modelStudio.configured ? {} : { error: result.core?.error || "核心 API 连接失败" }),
    });
  } catch (error) {
    return NextResponse.json({ ...summary, connected: modelStudio.configured, generationReady: modelStudio.configured, yikeError: describeError(error) });
  }
}
