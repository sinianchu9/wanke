import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getProjectTransitionSettings, setProjectTransitionSettings } from "@/lib/video/project-transitions";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  projectId: z.string().min(1),
  transitionType: z.enum(["cut", "fade"]),
  duration: z.number().min(0.2).max(1.5),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || "";
    if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
    if (!db.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    return NextResponse.json({ settings: getProjectTransitionSettings(projectId) });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json({ settings: setProjectTransitionSettings(input) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
