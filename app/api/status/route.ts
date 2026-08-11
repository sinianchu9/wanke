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
  const directGeneration = modelStudio.configured;
  const summary = {
    configured,
    regionId: directGeneration ? modelStudio.regionId : yike.regionId,
    regionName: directGeneration ? modelStudio.regionName : yike.regionName,
    endpoint: directGeneration ? modelStudio.endpoint : yike.endpoint,
    modelStudio,
    yike,
  };

  if (!configured) return NextResponse.json({ ...summary, connected: false, generationReady: false, error: "未配置百炼或 Yike 凭证" });
  if (new URL(request.url).searchParams.get("probe") !== "1") {
    return NextResponse.json({ ...summary, connected: null, generationReady: configured });
  }

  // Model Studio does not expose a zero-cost health check for this video route. Having a key
  // configured means the direct route is ready to try, not that the key/model permission has
  // already been verified. The first real generation request performs that validation.
  if (!yike.configured) {
    return NextResponse.json({
      ...summary,
      connected: null,
      generationReady: modelStudio.configured,
      modelStudioVerified: false,
      note: "百炼视频直连已配置；API Key、Workspace 与模型权限会在首次生成时校验。",
    });
  }

  try {
    const result = await testConnection();
    return NextResponse.json({
      ...summary,
      connected: result.ok,
      generationReady: modelStudio.configured || result.ok,
      modelStudioVerified: false,
      ...result,
      ...(result.ok ? {} : { yikeError: result.core?.error || "Yike 核心 API 连接失败" }),
    });
  } catch (error) {
    return NextResponse.json({
      ...summary,
      connected: false,
      generationReady: modelStudio.configured,
      modelStudioVerified: false,
      yikeError: describeError(error),
    });
  }
}
