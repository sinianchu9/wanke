import { NextResponse } from "next/server";
import { z } from "zod";
import { assembleProject, deleteProjectAssembly, ffmpegAvailable, listProjectAssemblies } from "@/lib/video/project-assembly";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ projectId: z.string().min(1) });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
  return NextResponse.json({ available: await ffmpegAvailable(), assemblies: listProjectAssemblies(projectId) });
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const result = await assembleProject(input.projectId);
    return NextResponse.json({ ...result, assemblies: listProjectAssemblies(input.projectId) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || "";
    const assemblyId = url.searchParams.get("assemblyId") || "";
    if (!projectId || !assemblyId) return NextResponse.json({ error: "删除参数不完整" }, { status: 400 });
    const deleted = await deleteProjectAssembly(projectId, assemblyId);
    return deleted
      ? NextResponse.json({ ok: true, assemblies: listProjectAssemblies(projectId) })
      : NextResponse.json({ error: "成片记录不存在" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
