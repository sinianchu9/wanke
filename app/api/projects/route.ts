import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assignJobToShot,
  createProject,
  createShot,
  deleteProject,
  deleteShot,
  listProjects,
  reorderShots,
  selectShotJob,
  setProjectSubjects,
  unassignJobFromShot,
  updateProject,
  updateShot,
} from "@/lib/projects";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createProjectSchema = z.object({
  action: z.literal("create_project"),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
});
const updateProjectSchema = z.object({
  action: z.literal("update_project"),
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
});
const createShotSchema = z.object({
  action: z.literal("create_shot"),
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  brief: z.string().max(1500).optional().default(""),
});
const updateShotSchema = z.object({
  action: z.literal("update_shot"),
  shotId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  brief: z.string().max(1500).optional().default(""),
});
const reorderSchema = z.object({ action: z.literal("reorder_shots"), projectId: z.string().min(1), shotIds: z.array(z.string().min(1)).max(200) });
const assignSchema = z.object({ action: z.literal("assign_job"), shotId: z.string().min(1), jobId: z.string().min(1) });
const unassignSchema = z.object({ action: z.literal("unassign_job"), shotId: z.string().min(1), jobId: z.string().min(1) });
const selectSchema = z.object({ action: z.literal("select_job"), shotId: z.string().min(1), jobId: z.string().min(1).nullable() });
const subjectsSchema = z.object({ action: z.literal("set_subjects"), projectId: z.string().min(1), subjectIds: z.array(z.string().min(1)).max(20) });

const actionSchema = z.discriminatedUnion("action", [
  createProjectSchema,
  updateProjectSchema,
  createShotSchema,
  updateShotSchema,
  reorderSchema,
  assignSchema,
  unassignSchema,
  selectSchema,
  subjectsSchema,
]);

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(request: Request) {
  try {
    const input = actionSchema.parse(await request.json());
    let result: unknown = null;
    if (input.action === "create_project") result = createProject(input);
    else if (input.action === "update_project") result = updateProject(input.projectId, input);
    else if (input.action === "create_shot") result = createShot(input);
    else if (input.action === "update_shot") result = updateShot(input.shotId, input);
    else if (input.action === "reorder_shots") reorderShots(input.projectId, input.shotIds);
    else if (input.action === "assign_job") assignJobToShot(input.shotId, input.jobId);
    else if (input.action === "unassign_job") unassignJobFromShot(input.shotId, input.jobId);
    else if (input.action === "select_job") selectShotJob(input.shotId, input.jobId);
    else if (input.action === "set_subjects") setProjectSubjects(input.projectId, input.subjectIds);
    return NextResponse.json({ result, projects: listProjects() }, { status: input.action.startsWith("create_") ? 201 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id") || "";
    if (!id || !["project", "shot"].includes(type || "")) return NextResponse.json({ error: "删除参数无效" }, { status: 400 });
    const ok = type === "project" ? deleteProject(id) : deleteShot(id);
    return ok ? NextResponse.json({ projects: listProjects() }) : NextResponse.json({ error: type === "project" ? "项目不存在" : "镜头不存在" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
