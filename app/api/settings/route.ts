import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicSettings, updateAppSettings } from "@/lib/settings";
import { describeError } from "@/lib/errors";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionalUrl = z.string().max(2048).refine(value => {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "Endpoint 必须是 HTTP/HTTPS 地址");

const schema = z.object({
  videoProviderMode: z.enum(["auto", "modelstudio", "yike"]).optional(),
  modelStudioApiKey: z.string().max(4096).optional(),
  modelStudioWorkspaceId: z.string().max(512).optional(),
  modelStudioBaseUrl: optionalUrl.optional(),
  yikeAccessKeyId: z.string().max(1024).optional(),
  yikeAccessKeySecret: z.string().max(4096).optional(),
  yikeRegionId: z.enum(["ap-southeast-1", "cn-shanghai"]).optional(),
  yikeEndpoint: z.string().max(1024).optional(),
  clearModelStudioApiKey: z.boolean().optional(),
  clearYikeAccessKeyId: z.boolean().optional(),
  clearYikeAccessKeySecret: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    // Creation-service configuration is platform-internal: admins only. Members must
    // never see which upstream service, region or key the platform runs on.
    requireAdmin(request);
    return NextResponse.json({ settings: getPublicSettings() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = requireAdmin(request);
    const input = schema.parse(await request.json());
    const settings = updateAppSettings(input);
    writeAudit(admin.id, "settings.update", "settings", "app", {
      fields: Object.keys(input).filter(key => !(input as Record<string, unknown>)[key]),
    });
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
