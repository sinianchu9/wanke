import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getProjectTransitionSettings, setProjectTransitionSettings } from "@/lib/video/project-transitions";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser, type SessionUser } from "@/lib/auth";
import { projectOwnedBy } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  projectId: z.string().min(1),
  transitionType: z.enum(["cut", "fade"]),
  duration: z.number().min(0.2).max(1.5),
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
    return NextResponse.json({ settings: getProjectTransitionSettings(projectId) });
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
    const input = schema.parse(await request.json());
    if (!projectOwnedBy(input.projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    return NextResponse.json({ settings: setProjectTransitionSettings(input) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
