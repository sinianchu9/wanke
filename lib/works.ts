import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { getJob } from "@/lib/repository";
import { addStorageRef, ensureStorageBackfill, getStorageObject, releaseStorageRef } from "@/lib/storage";

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
  sizeBytes: number;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSource {
  jobId: string;
  jobTitle: string;
  jobKind: string;
  projectId: string | null;
  projectName: string | null;
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
    sizeBytes: Number(row.size_bytes || 0),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Member-facing work payload (§39): playback, download, rename, delete, source, basics. */
export function workView(work: StoredWork) {
  return {
    id: work.id,
    title: work.title,
    description: work.description,
    videoUrl: work.videoUrl,
    archivedFile: work.archivedFile,
    status: work.status,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    sizeBytes: work.sizeBytes,
    durationSeconds: work.durationSeconds,
    format: work.archivedFile ? path.extname(work.archivedFile).replace(/^\./, "").toUpperCase() || null : null,
    source: workSource(work),
  };
}

/** Where the work came from: the creation task and, through its shot, the project. */
export function workSource(work: StoredWork): WorkSource | null {
  for (const jobId of work.jobIds) {
    const job = db.prepare("SELECT id, title, kind FROM jobs WHERE id=?").get(jobId) as any;
    if (!job) continue;
    const shot = db.prepare(`
      SELECT p.id, p.name FROM shot_jobs sj
      JOIN shots s ON s.id = sj.shot_id
      JOIN projects p ON p.id = s.project_id
      WHERE sj.job_id=? LIMIT 1
    `).get(jobId) as any;
    return {
      jobId: String(job.id),
      jobTitle: String(job.title || ""),
      jobKind: String(job.kind || ""),
      projectId: shot ? String(shot.id) : null,
      projectName: shot ? String(shot.name) : null,
    };
  }
  return null;
}

/**
 * Save one successful job output as a work. The work snapshots the playback URL and
 * local archive file so it survives later job cleanup, and takes a storage reference
 * so the archive file is only deleted when neither task nor work needs it.
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
  ensureStorageBackfill();
  const object = output.archivedFile ? getStorageObject(output.archivedFile) : null;
  db.prepare(`INSERT INTO works
    (id, user_id, title, description, cover_url, video_url, archived_file, job_ids_json, status, visibility, size_bytes, storage_key, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'active', 'private', ?, ?, ?, ?)`)
    .run(
      id,
      userId,
      (input.title?.trim() || job.title).slice(0, 160),
      input.description?.trim().slice(0, 2000) || "",
      null,
      output.outputUrl || null,
      output.archivedFile || null,
      JSON.stringify([job.id]),
      object?.sizeBytes || 0,
      output.archivedFile || null,
      now,
      now,
    );
  if (output.archivedFile && object) addStorageRef(output.archivedFile, "work", id);
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

/** Best-effort media facts for the work page; a missing ffprobe never blocks saving. */
export function refreshWorkMediaFacts(id: string, facts: { durationSeconds?: number | null }) {
  if (facts.durationSeconds == null) return;
  db.prepare("UPDATE works SET duration_seconds=? WHERE id=?").run(facts.durationSeconds, id);
}

/**
 * Delete is a real delete: the work row goes, and the archive file follows once no
 * task or other work references it. A file that cannot be removed throws, so the
 * caller reports the failure instead of leaving a silent orphan.
 */
export function deleteWork(id: string): boolean {
  const work = getWork(id);
  if (!work) return false;
  const removed = db.prepare("DELETE FROM works WHERE id=?").run(id).changes > 0;
  if (removed && work.archivedFile) releaseStorageRef(work.archivedFile, "work", id);
  return removed;
}
