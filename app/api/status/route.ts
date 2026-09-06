import { NextResponse } from "next/server";
import { yikeConfigSummary } from "@/lib/yike/client";
import { modelStudioConfigSummary } from "@/lib/video/modelstudio";
import { getVideoProviderMode } from "@/lib/settings";
import { errorResponse, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Member-facing service status: capability flags only.
 *
 * The upstream provider, region, endpoint and credential state stay in the
 * backoffice (`/api/admin/creation-service`). Members only learn whether a creation
 * capability is available right now, in business language.
 */
export async function GET(request: Request) {
  try {
    requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
  const yike = yikeConfigSummary();
  const modelStudio = modelStudioConfigSummary();
  const providerMode = getVideoProviderMode();
  const configured = modelStudio.configured || yike.configured;
  const generationReady = providerMode === "modelstudio"
    ? modelStudio.configured
    : providerMode === "yike"
      ? yike.configured
      : configured;

  return NextResponse.json({
    available: configured,
    generationReady,
    capabilities: {
      directVideo: modelStudio.configured && providerMode !== "yike",
      extendedUpload: yike.configured,
      advancedWorkflows: yike.configured,
    },
    message: generationReady ? "创作服务正常" : "当前创作服务正在准备中，暂时无法提交新的创作",
  });
}
