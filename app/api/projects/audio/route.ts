import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { listAssets } from "@/lib/repository";
import { getProjectAudioSettings, setProjectAudioSettings } from "@/lib/video/project-audio";
import { describeError } from "@/lib/errors";

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
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
    if (!db.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const audioAssets = listAssets(500).filter(asset => asset.mediaType === "audio");
    return NextResponse.json({ settings: getProjectAudioSettings(projectId), audioAssets });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const input = updateSchema.parse(await request.json());
    const settings = setProjectAudioSettings(input);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
