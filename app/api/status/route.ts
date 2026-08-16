import { NextResponse } from "next/server";
import { yikeConfigSummary } from "@/lib/yike/client";
import { testConnection } from "@/lib/yike/provider";
import { modelStudioConfigSummary } from "@/lib/video/modelstudio";
import { getVideoProviderMode } from "@/lib/settings";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const yike = yikeConfigSummary();
  const modelStudio = modelStudioConfigSummary();
  const providerMode = getVideoProviderMode();
  const configured = modelStudio.configured || yike.configured;
  const generationReady = providerMode === "modelstudio"
    ? modelStudio.configured
    : providerMode === "yike"
      ? yike.configured
      : configured;
  const preferred = providerMode === "yike" ? yike : providerMode === "modelstudio" ? modelStudio : modelStudio.configured ? modelStudio : yike;
  const summary = {
    configured,
    generationReady,
    providerMode,
    regionId: preferred.regionId,
    regionName: preferred.regionName,
    endpoint: preferred.endpoint,
    modelStudio,
    yike,
  };

  if (!generationReady) {
    const error = providerMode === "modelstudio"
      ? "当前已选择百炼，但百炼 API Key 未配置"
      : providerMode === "yike"
        ? "当前已选择万镜一刻，但 AccessKey 未配置完整"
        : "未配置百炼或万镜一刻凭证";
    return NextResponse.json({ ...summary, connected: false, error });
  }

  if (new URL(request.url).searchParams.get("probe") !== "1") {
    return NextResponse.json({ ...summary, connected: null });
  }

  // Extension workflows use Yike regardless of which provider is selected for basic generation.
  // Probe Yike whenever it is configured so the sidebar/settings check remains meaningful.
  if (!yike.configured) {
    return NextResponse.json({
      ...summary,
      connected: null,
      modelStudioVerified: false,
      note: modelStudio.configured
        ? "百炼配置已保存；API Key、Workspace 与模型权限会在首次真实生成时校验。"
        : "万镜一刻尚未配置。",
    });
  }

  try {
    const result = await testConnection();
    const yikeError = !result.ok && "error" in result
      ? result.error || "万镜一刻核心 API 连接失败"
      : undefined;
    return NextResponse.json({
      ...summary,
      connected: result.ok,
      modelStudioVerified: false,
      ...result,
      ...(yikeError ? { yikeError } : {}),
    });
  } catch (error) {
    return NextResponse.json({
      ...summary,
      connected: false,
      modelStudioVerified: false,
      yikeError: describeError(error),
    });
  }
}
