import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { getJob } from "@/lib/repository";

export interface StoredWork {
  id: string;
  userId: string;
  title: string;
  description: string;
  coverUrl: string | null;
  videoUrl: string | null;
  archivedFile: string | null;
  jobIds: string[];
  status: "active" | "archived";
  visibility: "private";
  createdAt: string;
  updatedAt: string;
}

function rowToWork(row: any): StoredWork {
  let jobIds: string[] = [];
  try { jobIds = JSON.parse(row.job_ids_json || "[]"); } catch { jobIds = []; }
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description || "",
    coverUrl: row.cover_url || null,
    videoUrl: row.video_url || null,
    archivedFile: row.archived_file || null,
    jobIds,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Save one successful job output as a work. The work snapshots the playback URL and
 * local archive file so it survives later job cleanup.
 */
export function createWorkFromJob(userId: string, input: { jobId: string; outputIndex: number; title?: string; description?: string }): StoredWork {
  const job = getJob(input.jobId);
  if (!job || job.userId !== userId) throw new HttpError(404, "NOT_FOUND", "任务不存在");
  if (job.status !== "succeeded") throw new HttpError(400, "JOB_NOT_READY", "只有生成成功的任务可以保存为作品");
  const output = job.outputs[input.outputIndex];
  if (!output || (!output.outputUrl && !output.archivedFile)) {
    throw new HttpError(400, "INVALID_OUTPUT", "该结果没有可播放的视频");
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO works
    (id, user_id, title, description, cover_url, video_url, archived_file, job_ids_json, status, visibility, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'active', 'private', ?, ?)`)
    .run(
      id,
      userId,
      (input.title?.trim() || job.title).slice(0, 160),
      input.description?.trim().slice(0, 2000) || "",
      null,
      output.outputUrl || null,
      output.archivedFile || null,
      JSON.stringify([job.id]),
      now,
      now,
    );
  return getWork(id)!;
}

export function getWork(id: string): StoredWork | null {
  const row = db.prepare("SELECT * FROM works WHERE id=?").get(id) as any;
  return row ? rowToWork(row) : null;
}

export function getWorkForUser(id: string, userId: string, isAdmin = false): StoredWork | null {
  const work = getWork(id);
  if (!work) return null;
  if (!isAdmin && work.userId !== userId) return null;
  return work;
}

export function listWorksForUser(userId: string, includeArchived = false): StoredWork[] {
  const rows = includeArchived
    ? db.prepare("SELECT * FROM works WHERE user_id=? ORDER BY created_at DESC LIMIT 500").all(userId) as any[]
    : db.prepare("SELECT * FROM works WHERE user_id=? AND status='active' ORDER BY created_at DESC LIMIT 500").all(userId) as any[];
  return rows.map(rowToWork);
}

export function listAllWorks(limit = 200): Array<StoredWork & { ownerEmail: string | null }> {
  const rows = db.prepare(`
    SELECT w.*, u.email AS owner_email FROM works w LEFT JOIN users u ON u.id = w.user_id
    ORDER BY w.created_at DESC LIMIT ?
  `).all(limit) as any[];
  return rows.map(row => ({ ...rowToWork(row), ownerEmail: row.owner_email || null }));
}

export function updateWork(id: string, patch: { title?: string; description?: string; status?: "active" | "archived" }): StoredWork | null {
  const current = getWork(id);
  if (!current) return null;
  db.prepare("UPDATE works SET title=?, description=?, status=?, updated_at=? WHERE id=?").run(
    patch.title?.trim() ? patch.title.trim().slice(0, 160) : current.title,
    patch.description !== undefined ? patch.description.trim().slice(0, 2000) : current.description,
    patch.status || current.status,
    new Date().toISOString(),
    id,
  );
  return getWork(id);
}

export function deleteWork(id: string): boolean {
  return db.prepare("DELETE FROM works WHERE id=?").run(id).changes > 0;
}
