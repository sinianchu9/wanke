import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicSettings, updateAppSettings } from "@/lib/settings";
import { describeError } from "@/lib/errors";

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

export async function GET() {
  return NextResponse.json({ settings: getPublicSettings() });
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json({ ok: true, settings: updateAppSettings(input) });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
