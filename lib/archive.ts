import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import type { ResultMedia, StoredJob } from "@/lib/types";
import { db } from "@/lib/db";
import {
  addStorageRef, contentTypeFor, outputDirectory, registerStorageObject, releaseStorageRef, storageFilePath,
} from "@/lib/storage";

export { contentTypeFor, outputDirectory };

export function archivedFilePath(name: string) {
  return storageFilePath("outputs", name);
}

export async function archiveJobOutput(job: StoredJob, index: number) {
  const output = job.outputs[index];
  if (!output?.outputUrl) throw new Error("该结果没有远端 URL");
  if (output.archivedFile) return output;

  const response = await fetch(output.outputUrl, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(archiveTimeoutMs()),
  });
  if (!response.ok || !response.body) throw new Error(`下载结果失败：HTTP ${response.status}`);

  const maxBytes = archiveMaxBytes();
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`文件超过归档上限 ${Math.round(maxBytes / 1024 / 1024)} MB`);

  const ext = extensionFor(output, response.headers.get("content-type"));
  const fileName = `${job.id}-${index + 1}${ext}`;
  const dir = outputDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const dest = archivedFilePath(fileName);
  // Auto-archive and an explicit “generate final video” request can legitimately download
  // the same provider result at the same time. Use a unique temp file so one request does
  // not fail merely because another request in the same Node process is still writing.
  const temp = `${dest}.part-${process.pid}-${randomUUID()}`;
  let received = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error(`文件超过归档上限 ${Math.round(maxBytes / 1024 / 1024)} MB`));
      else callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body as any), limit, fs.createWriteStream(temp, { flags: "wx" }));
    try {
      fs.renameSync(temp, dest);
    } catch (error) {
      // On platforms where rename does not replace an existing destination, another
      // concurrent archive may already have completed successfully. A non-empty final
      // file is sufficient; otherwise keep the original error.
      const existing = safeStat(dest);
      if (!existing?.isFile() || existing.size <= 0) throw error;
      try { fs.unlinkSync(temp); } catch {}
    }
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }

  // The file is final; register ownership in the same step so the download guard and
  // the orphan sweep can both trust the registry (file and row live and die together).
  const sizeBytes = safeStat(dest)?.size || received;
  try {
    registerStorageObject({
      bucket: "outputs",
      key: fileName,
      userId: job.userId,
      contentType: response.headers.get("content-type") || contentTypeFor(fileName),
      sizeBytes,
      refType: "job",
      refId: job.id,
    });
  } catch (error) {
    try { fs.unlinkSync(dest); } catch {}
    throw error;
  }
  attachArchiveToWorks(job, output, fileName, sizeBytes);

  return { ...output, archivedFile: fileName, archivedAt: new Date().toISOString() } satisfies ResultMedia;
}

/**
 * A work saved before the archive existed must survive the remote link expiring:
 * when the archive lands, every work that snapshots this output switches to the
 * local file and takes a reference so later task cleanup cannot pull it away.
 */
function attachArchiveToWorks(job: StoredJob, output: ResultMedia, fileName: string, sizeBytes: number) {
  if (!output.outputUrl) return;
  const rows = db.prepare(
    "SELECT id FROM works WHERE archived_file IS NULL AND video_url=? AND job_ids_json LIKE ?",
  ).all(output.outputUrl, `%${job.id}%`) as any[];
  const now = new Date().toISOString();
  for (const row of rows) {
    db.prepare("UPDATE works SET archived_file=?, storage_key=?, size_bytes=?, updated_at=? WHERE id=?")
      .run(fileName, fileName, sizeBytes, now, row.id);
    addStorageRef(fileName, "work", String(row.id));
  }
}

/**
 * Task deletion releases the task's reference on every archived output. The file
 * only disappears when no work (or other consumer) references it any more; a delete
 * that fails throws so the caller surfaces it instead of leaving a silent orphan.
 */
export function deleteArchivedOutputs(outputs: ResultMedia[], jobId?: string) {
  for (const output of outputs) {
    if (!output.archivedFile) continue;
    if (jobId) {
      releaseStorageRef(output.archivedFile, "job", jobId);
    } else {
      releaseStorageRef(output.archivedFile, "job", "");
    }
  }
}

function archiveTimeoutMs() {
  const configured = Number(process.env.WANKE_ARCHIVE_TIMEOUT_MS || 1_800_000);
  if (!Number.isFinite(configured)) return 1_800_000;
  return Math.min(24 * 60 * 60 * 1000, Math.max(60_000, Math.round(configured)));
}

function archiveMaxBytes() {
  const configuredMb = Number(process.env.WANKE_MAX_ARCHIVE_MB || 2048);
  const mb = Number.isFinite(configuredMb) ? Math.min(20_480, Math.max(10, configuredMb)) : 2048;
  return Math.round(mb * 1024 * 1024);
}

function safeStat(filePath: string) {
  try { return fs.statSync(filePath); } catch { return null; }
}

function extensionFor(output: ResultMedia, contentType: string | null) {
  const pathname = safePath(output.outputUrl || "");
  const ext = path.extname(pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,6}$/.test(ext)) return ext;
  if (output.kind === "subtitle") return ".srt";
  if (output.kind === "json") return ".json";
  if (contentType?.includes("webm")) return ".webm";
  if (contentType?.includes("quicktime")) return ".mov";
  if (contentType?.includes("audio/mpeg")) return ".mp3";
  if (contentType?.startsWith("audio/")) return ".m4a";
  return ".mp4";
}

function safePath(value: string) {
  try { return new URL(value).pathname; } catch { return ""; }
}
