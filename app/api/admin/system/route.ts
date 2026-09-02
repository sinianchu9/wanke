import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { getPublicSettings } from "@/lib/settings";
import { modelStudioConfigSummary } from "@/lib/video/modelstudio";
import { yikeConfigSummary } from "@/lib/yike/client";
import { PLANS } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({
      settings: getPublicSettings(),
      providers: { modelStudio: modelStudioConfigSummary(), yike: yikeConfigSummary() },
      plans: Object.values(PLANS),
      runtime: {
        node: process.version,
        dbPath: process.env.WANKE_DB_PATH || "./data/wanke.db",
        outputDir: process.env.WANKE_OUTPUT_DIR || "./data/outputs",
        adminEmailConfigured: Boolean((process.env.ADMIN_EMAIL || "").trim()),
      },
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
