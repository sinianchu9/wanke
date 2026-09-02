import { NextResponse } from "next/server";
import fsp from "node:fs/promises";
import { z } from "zod";
import {
  assignJobToShot,
  createProject,
  createShot,
  deleteProject,
  deleteShot,
  listProjectsForUser,
  projectOwnedBy,
  reorderShots,
  selectShotJob,
  setProjectSubjects,
  shotOwnedBy,
  unassignJobFromShot,
  updateProject,
  updateShot,
} from "@/lib/projects";
import { archivedFilePath } from "@/lib/archive";
import { db } from "@/lib/db";
import { getJob, getJobForUser } from "@/lib/repository";
import { getSubjectCardForUser } from "@/lib/subjects";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser, type SessionUser } from "@/lib/auth";

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

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const projects = listProjectsForUser(user.id);
    return NextResponse.json({ projects, jobs: projectJobs(projects) });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

function ownProject(user: SessionUser, projectId: string) {
  if (!projectOwnedBy(projectId, user.id)) throw new OwnedResourceError();
}
function ownShot(user: SessionUser, shotId: string) {
  if (!shotOwnedBy(shotId, user.id)) throw new OwnedResourceError();
}
class OwnedResourceError extends Error {
  constructor() { super("资源不存在"); }
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
    const input = actionSchema.parse(await request.json());
    let result: unknown = null;
    if (input.action === "create_project") result = createProject({ ...input, userId: user.id });
    else if (input.action === "update_project") { ownProject(user, input.projectId); result = updateProject(input.projectId, input); }
    else if (input.action === "create_shot") { ownProject(user, input.projectId); result = createShot(input); }
    else if (input.action === "update_shot") { ownShot(user, input.shotId); result = updateShot(input.shotId, input); }
    else if (input.action === "reorder_shots") { ownProject(user, input.projectId); reorderShots(input.projectId, input.shotIds); }
    else if (input.action === "assign_job") { ownShot(user, input.shotId); requireOwnedJob(user, input.jobId); assignJobToShot(input.shotId, input.jobId); }
    else if (input.action === "unassign_job") { ownShot(user, input.shotId); requireOwnedJob(user, input.jobId); unassignJobFromShot(input.shotId, input.jobId); }
    else if (input.action === "select_job") { ownShot(user, input.shotId); if (input.jobId) requireOwnedJob(user, input.jobId); selectShotJob(input.shotId, input.jobId); }
    else if (input.action === "set_subjects") {
      ownProject(user, input.projectId);
      for (const subjectId of input.subjectIds) {
        if (!getSubjectCardForUser(subjectId, user.id)) throw new OwnedResourceError();
      }
      setProjectSubjects(input.projectId, input.subjectIds);
    }
    return NextResponse.json({ result, projects: listProjectsForUser(user.id) }, { status: input.action.startsWith("create_") ? 201 : 200 });
  } catch (error) {
    if (error instanceof OwnedResourceError) return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

function requireOwnedJob(user: SessionUser, jobId: string) {
  if (!getJobForUser(jobId, user.id)) throw new OwnedResourceError();
}

export async function DELETE(request: Request) {
  let user: SessionUser;
  try {
    user = requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id") || "";
    if (!id || !["project", "shot"].includes(type || "")) return NextResponse.json({ error: "删除参数无效" }, { status: 400 });
    const owned = type === "project" ? projectOwnedBy(id, user.id) : shotOwnedBy(id, user.id);
    if (!owned) return NextResponse.json({ error: type === "project" ? "项目不存在" : "镜头不存在" }, { status: 404 });

    const assemblyFiles = type === "project" ? allAssemblyFiles(id) : [];
    const ok = type === "project" ? deleteProject(id) : deleteShot(id);
    if (!ok) return NextResponse.json({ error: type === "project" ? "项目不存在" : "镜头不存在" }, { status: 404 });

    if (type === "project" && assemblyFiles.length) {
      await Promise.allSettled(assemblyFiles.map(async fileName => {
        try { await fsp.unlink(archivedFilePath(fileName)); } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
      }));
    }
    return NextResponse.json({ projects: listProjectsForUser(user.id) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

function allAssemblyFiles(projectId: string) {
  return (db.prepare("SELECT file_name FROM project_assemblies WHERE project_id=?").all(projectId) as any[]).map(row => String(row.file_name));
}

function projectJobs(projects: ReturnType<typeof listProjectsForUser>) {
  const ids = [...new Set(projects.flatMap(project => project.shots.flatMap(shot => shot.jobIds)))];
  return ids.map(id => getJob(id)).filter(Boolean);
}
