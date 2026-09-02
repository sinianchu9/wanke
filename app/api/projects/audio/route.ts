import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { listAssetsForUser } from "@/lib/repository";
import { getProjectAudioSettings, setProjectAudioSettings } from "@/lib/video/project-audio";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser, type SessionUser } from "@/lib/auth";
import { projectOwnedBy } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  projectId: z.string().min(1),
  bgmAssetId: z.string().min(1).nullable().optional(),
  targetLufs: z.number().min(-24).max(-9),
  originalGainDb: z.number().min(-12).max(6),
  bgmGainDb: z.number().min(-30).max(0),
});

export async function GET(request: Request) {
  let user: SessionUser;
  try {
    user = requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
    if (!projectOwnedBy(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const audioAssets = listAssetsForUser(user.id, 500).filter(asset => asset.mediaType === "audio");
    return NextResponse.json({ settings: getProjectAudioSettings(projectId), audioAssets });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  let user: SessionUser;
  try {
    user = requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
  try {
    const input = updateSchema.parse(await request.json());
    if (!projectOwnedBy(input.projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const settings = setProjectAudioSettings(input);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
