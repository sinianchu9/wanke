import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { JOB_KIND_LABELS, type JobKind, type JobStatus, type ResultMedia, type StoredAsset, type StoredJob } from "@/lib/types";

const parse = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

function rowToJob(row: any): StoredJob {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    providerJobId: row.provider_job_id,
    status: row.status,
    request: parse(row.request_json, {}),
    provider: parse(row.provider_json, null),
    outputs: parse<ResultMedia[]>(row.output_json, []),
    details: parse(row.details_json, null),
    error: row.error,
    requestId: row.request_id,
    parentJobId: row.parent_job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function rowToAsset(row: any): StoredAsset {
  return {
    id: row.id,
    providerMediaId: row.provider_media_id,
    name: row.name,
    mediaType: row.media_type,
    sourceUrl: row.source_url,
    provider: parse(row.provider_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(input: {
  kind: JobKind;
  title?: string;
  request: Record<string, unknown>;
  parentJobId?: string | null;
}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO jobs
    (id, kind, title, status, request_json, output_json, parent_job_id, created_at, updated_at)
    VALUES (?, ?, ?, 'queued', ?, '[]', ?, ?, ?)`) 
    .run(id, input.kind, input.title?.trim() || defaultTitle(input.kind), JSON.stringify(input.request), input.parentJobId || null, now, now);
  return getJob(id)!;
}

export function getJob(id: string): StoredJob | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return row ? rowToJob(row) : null;
}

export function listJobs(limit = 100): StoredJob[] {
  return (db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as any[]).map(rowToJob);
}

export function listActiveJobs(limit = 20): StoredJob[] {
  const now = Date.now();
  const candidates = (db.prepare("SELECT * FROM jobs WHERE status IN ('queued','running') AND provider_job_id IS NOT NULL ORDER BY updated_at ASC LIMIT 100").all() as any[]).map(rowToJob);
  return candidates.filter(job => {
    const ageMs = Math.max(0, now - new Date(job.createdAt).getTime());
    const sinceUpdateMs = Math.max(0, now - new Date(job.updatedAt).getTime());
    const isModelStudio = job.details?.engine === "modelstudio";
    // Alibaba recommends roughly 15s polling for async video jobs. Keep the faster 6s cadence
    // only for legacy Yike jobs, which already used that behavior before the provider split.
    const minInterval = isModelStudio
      ? (ageMs < 5 * 60_000 ? 15_000 : 30_000)
      : (ageMs < 60_000 ? 6_000 : ageMs < 5 * 60_000 ? 15_000 : 30_000);
    return sinceUpdateMs >= minInterval;
  }).slice(0, limit);
}

export function updateJobRemote(id: string, patch: {
  providerJobId?: string | null;
  status?: JobStatus;
  provider?: Record<string, unknown> | null;
  outputs?: ResultMedia[];
  details?: Record<string, unknown> | null;
  error?: string | null;
  requestId?: string | null;
  finishedAt?: string | null;
}) {
  const current = getJob(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const status = patch.status ?? current.status;
  const finishedAt = patch.finishedAt !== undefined
    ? patch.finishedAt
    : (["succeeded", "failed"].includes(status) ? (current.finishedAt || now) : current.finishedAt);
  db.prepare(`UPDATE jobs SET
    provider_job_id=?, status=?, provider_json=?, output_json=?, details_json=?, error=?, request_id=?, updated_at=?, finished_at=?
    WHERE id=?`)
    .run(
      patch.providerJobId !== undefined ? patch.providerJobId : current.providerJobId,
      status,
      JSON.stringify(patch.provider !== undefined ? patch.provider : current.provider),
      JSON.stringify(patch.outputs !== undefined ? mergeOutputMetadata(current.outputs, patch.outputs) : current.outputs),
      JSON.stringify(patch.details !== undefined ? patch.details : current.details),
      patch.error !== undefined ? patch.error : current.error,
      patch.requestId !== undefined ? patch.requestId : current.requestId,
      now,
      finishedAt,
      id,
    );
  return getJob(id);
}

function mergeOutputMetadata(previous: ResultMedia[], next: ResultMedia[]) {
  return next.map((item, index) => {
    const old = previous.find(p => (item.mediaId && p.mediaId === item.mediaId) || (item.outputUrl && p.outputUrl === item.outputUrl)) || previous[index];
    if (!old) return item;
    return { ...item, ...(old.archivedFile ? { archivedFile: old.archivedFile } : {}), ...(old.archivedAt ? { archivedAt: old.archivedAt } : {}) };
  });
}

export function deleteJob(id: string) {
  return db.prepare("DELETE FROM jobs WHERE id=?").run(id).changes > 0;
}

export function requestReferenceExists(value: string) {
  return Boolean(db.prepare("SELECT 1 FROM jobs WHERE request_json LIKE ? LIMIT 1").get(`%${value}%`));
}

export function createAsset(input: {
  providerMediaId?: string | null;
  name: string;
  mediaType: string;
  sourceUrl: string;
  provider?: Record<string, unknown> | null;
}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO assets
    (id, provider_media_id, name, media_type, source_url, provider_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`) 
    .run(id, input.providerMediaId || null, input.name, input.mediaType, input.sourceUrl, JSON.stringify(input.provider || null), now, now);
  return getAsset(id)!;
}

export function getAsset(id: string): StoredAsset | null {
  const row = db.prepare("SELECT * FROM assets WHERE id=?").get(id);
  return row ? rowToAsset(row) : null;
}

export function listAssets(limit = 300): StoredAsset[] {
  return (db.prepare("SELECT * FROM assets ORDER BY created_at DESC LIMIT ?").all(limit) as any[]).map(rowToAsset);
}

export function deleteAsset(id: string) {
  return db.prepare("DELETE FROM assets WHERE id=?").run(id).changes > 0;
}

function defaultTitle(kind: JobKind) {
  return JOB_KIND_LABELS[kind];
}
