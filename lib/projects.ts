import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { ProductionProject, ProjectShot } from "@/lib/project-types";

function rowToShot(row: any, jobIds: string[]): ProjectShot {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    brief: row.brief || "",
    position: Number(row.position) || 1,
    selectedJobId: row.selected_job_id || null,
    jobIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(): ProductionProject[] {
  const projectRows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC").all() as any[];
  const shotRows = db.prepare("SELECT * FROM shots ORDER BY project_id, position ASC, created_at ASC").all() as any[];
  const jobRows = db.prepare("SELECT shot_id, job_id FROM shot_jobs ORDER BY created_at ASC").all() as any[];
  const subjectRows = db.prepare("SELECT project_id, subject_id FROM project_subjects ORDER BY created_at ASC").all() as any[];

  const jobIdsByShot = new Map<string, string[]>();
  for (const row of jobRows) {
    const list = jobIdsByShot.get(row.shot_id) || [];
    list.push(row.job_id);
    jobIdsByShot.set(row.shot_id, list);
  }

  const shotsByProject = new Map<string, ProjectShot[]>();
  for (const row of shotRows) {
    const list = shotsByProject.get(row.project_id) || [];
    list.push(rowToShot(row, jobIdsByShot.get(row.id) || []));
    shotsByProject.set(row.project_id, list);
  }

  const subjectsByProject = new Map<string, string[]>();
  for (const row of subjectRows) {
    const list = subjectsByProject.get(row.project_id) || [];
    list.push(row.subject_id);
    subjectsByProject.set(row.project_id, list);
  }

  return projectRows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description || "",
    subjectIds: subjectsByProject.get(row.id) || [],
    shots: shotsByProject.get(row.id) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getShot(id: string) {
  return db.prepare("SELECT * FROM shots WHERE id=?").get(id) as any | undefined;
}

export function createProject(input: { name: string; description?: string }) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare("INSERT INTO projects (id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(id, input.name.trim(), input.description?.trim() || "", now, now);
  return listProjects().find(project => project.id === id)!;
}

export function updateProject(id: string, input: { name: string; description?: string }) {
  const changed = db.prepare("UPDATE projects SET name=?, description=?, updated_at=? WHERE id=?")
    .run(input.name.trim(), input.description?.trim() || "", new Date().toISOString(), id).changes;
  if (!changed) throw new Error("项目不存在");
  return listProjects().find(project => project.id === id)!;
}

export function deleteProject(id: string) {
  return db.prepare("DELETE FROM projects WHERE id=?").run(id).changes > 0;
}

export function createShot(input: { projectId: string; name: string; brief?: string }) {
  const project = db.prepare("SELECT id FROM projects WHERE id=?").get(input.projectId);
  if (!project) throw new Error("项目不存在");
  const row = db.prepare("SELECT COALESCE(MAX(position),0) AS max_position FROM shots WHERE project_id=?").get(input.projectId) as any;
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare("INSERT INTO shots (id,project_id,name,brief,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, input.projectId, input.name.trim(), input.brief?.trim() || "", Number(row?.max_position || 0) + 1, now, now);
  touchProject(input.projectId, now);
  return listProjects().flatMap(projectItem => projectItem.shots).find(shot => shot.id === id)!;
}

export function updateShot(id: string, input: { name: string; brief?: string }) {
  const shot = getShot(id);
  if (!shot) throw new Error("镜头不存在");
  const now = new Date().toISOString();
  db.prepare("UPDATE shots SET name=?, brief=?, updated_at=? WHERE id=?")
    .run(input.name.trim(), input.brief?.trim() || "", now, id);
  touchProject(shot.project_id, now);
  return listProjects().flatMap(project => project.shots).find(item => item.id === id)!;
}

export function deleteShot(id: string) {
  const shot = getShot(id);
  if (!shot) return false;
  const changed = db.prepare("DELETE FROM shots WHERE id=?").run(id).changes > 0;
  if (changed) touchProject(shot.project_id);
  return changed;
}

export function assignJobToShot(shotId: string, jobId: string) {
  const target = getShot(shotId);
  if (!target) throw new Error("镜头不存在");
  if (!db.prepare("SELECT 1 FROM jobs WHERE id=?").get(jobId)) throw new Error("任务不存在");

  const transaction = db.transaction(() => {
    const existing = db.prepare("SELECT shot_id FROM shot_jobs WHERE job_id=?").get(jobId) as any;
    if (existing?.shot_id === shotId) return;
    const now = new Date().toISOString();
    if (existing?.shot_id) {
      const oldShot = getShot(existing.shot_id);
      db.prepare("UPDATE shots SET selected_job_id=NULL, updated_at=? WHERE id=? AND selected_job_id=?").run(now, existing.shot_id, jobId);
      db.prepare("DELETE FROM shot_jobs WHERE job_id=?").run(jobId);
      if (oldShot) touchProject(oldShot.project_id, now);
    }
    db.prepare("INSERT INTO shot_jobs (shot_id,job_id,created_at) VALUES (?,?,?)").run(shotId, jobId, now);
    db.prepare("UPDATE shots SET updated_at=? WHERE id=?").run(now, shotId);
    touchProject(target.project_id, now);
  });
  transaction();
}

export function unassignJobFromShot(shotId: string, jobId: string) {
  const shot = getShot(shotId);
  if (!shot) throw new Error("镜头不存在");
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare("UPDATE shots SET selected_job_id=NULL, updated_at=? WHERE id=? AND selected_job_id=?").run(now, shotId, jobId);
    db.prepare("DELETE FROM shot_jobs WHERE shot_id=? AND job_id=?").run(shotId, jobId);
    touchProject(shot.project_id, now);
  });
  transaction();
}

export function selectShotJob(shotId: string, jobId: string | null) {
  const shot = getShot(shotId);
  if (!shot) throw new Error("镜头不存在");
  if (jobId) {
    if (!db.prepare("SELECT 1 FROM shot_jobs WHERE shot_id=? AND job_id=?").get(shotId, jobId)) {
      throw new Error("只能采用当前镜头中的候选任务");
    }
    const job = db.prepare("SELECT status, output_json FROM jobs WHERE id=?").get(jobId) as any;
    let outputs: unknown[] = [];
    try { outputs = JSON.parse(job?.output_json || "[]"); } catch { outputs = []; }
    if (job?.status !== "succeeded" || !Array.isArray(outputs) || outputs.length < 1) {
      throw new Error("只有已完成并产生结果的任务才能设为采用版本");
    }
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE shots SET selected_job_id=?, updated_at=? WHERE id=?").run(jobId, now, shotId);
  touchProject(shot.project_id, now);
}

export function setProjectSubjects(projectId: string, subjectIds: string[]) {
  if (!db.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) throw new Error("项目不存在");
  const unique = [...new Set(subjectIds)];
  for (const subjectId of unique) {
    if (!db.prepare("SELECT 1 FROM subject_cards WHERE id=?").get(subjectId)) throw new Error("项目引用了不存在的主体卡");
  }
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM project_subjects WHERE project_id=?").run(projectId);
    const insert = db.prepare("INSERT INTO project_subjects (project_id,subject_id,created_at) VALUES (?,?,?)");
    const now = new Date().toISOString();
    for (const subjectId of unique) insert.run(projectId, subjectId, now);
    touchProject(projectId, now);
  });
  transaction();
}

function touchProject(projectId: string, now = new Date().toISOString()) {
  db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(now, projectId);
}
