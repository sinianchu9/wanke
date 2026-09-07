import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/system-settings";

/**
 * Thin storage layer (§8.2 / §9).
 *
 * Local disk is the production driver for single-machine deployments. The
 * `storage_objects` table is the ownership and accounting registry: every file a
 * member can reach has exactly one row with the owner's user id, and every consumer
 * (a job output, a work, an uploader) holds a row in `storage_object_refs`. A file
 * is deleted only when its last reference goes away, so a work survives the cleanup
 * of its source task while a delete stays a real delete.
 *
 * The OSS driver is only a switch position this phase: selecting it fails loudly
 * instead of silently writing to local disk.
 */

export type StorageBucket = "outputs" | "inputs";

export interface StorageObject {
  id: string;
  userId: string | null;
  bucket: StorageBucket;
  key: string;
  driver: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  lastAccessedAt: string | null;
}

export function outputDirectory() {
  return path.resolve(process.env.WANKE_OUTPUT_DIR || "./data/outputs");
}

export function inputDirectory() {
  return path.resolve(process.env.WANKE_INPUT_DIR || "./data/inputs");
}

function bucketDirectory(bucket: StorageBucket) {
  return bucket === "inputs" ? inputDirectory() : outputDirectory();
}

/** Keys are single path segments of safe characters; nothing user-chosen ever becomes a path. */
export function assertSafeStorageKey(key: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key) || key.includes("..") || path.basename(key) !== key) {
    throw new Error("非法存储键");
  }
  return key;
}

export function storageFilePath(bucket: StorageBucket, key: string) {
  return path.join(bucketDirectory(bucket), assertSafeStorageKey(key));
}

/** The OSS switch position exists, but the driver itself is not delivered this phase. */
export function assertUsableDriver() {
  const driver = (getSetting("storage_driver") || "local").trim();
  if (driver !== "local") {
    throw new Error("对象存储尚未开通：当前版本只交付本地存储，请在后台「系统设置 → 存储」把存储方式改回本地存储。");
  }
  return driver;
}

export function contentTypeFor(name: string) {
  const ext = path.extname(name).toLowerCase();
  return ({
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".srt": "application/x-subrip", ".vtt": "text/vtt", ".json": "application/json; charset=utf-8",
  } as Record<string, string>)[ext] || "application/octet-stream";
}

function rowToObject(row: any): StorageObject {
  return {
    id: row.id,
    userId: row.user_id || null,
    bucket: row.bucket,
    key: row.storage_key,
    driver: row.driver,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at || null,
  };
}

export function getStorageObject(key: string): StorageObject | null {
  const row = db.prepare("SELECT * FROM storage_objects WHERE storage_key=?").get(key) as any;
  return row ? rowToObject(row) : null;
}

export function touchStorageAccess(key: string) {
  db.prepare("UPDATE storage_objects SET last_accessed_at=? WHERE storage_key=?").run(new Date().toISOString(), key);
}

export function addStorageRef(key: string, refType: string, refId: string) {
  db.prepare("INSERT OR IGNORE INTO storage_object_refs (storage_key, ref_type, ref_id, created_at) VALUES (?,?,?,?)")
    .run(key, refType, refId, new Date().toISOString());
}

function refCount(key: string): number {
  return Number((db.prepare("SELECT COUNT(*) AS c FROM storage_object_refs WHERE storage_key=?").get(key) as any)?.c || 0);
}

/**
 * Register a file that already exists on disk, together with its first reference.
 * The file write happens before this call (network and disk IO never sit inside the
 * SQLite transaction); callers delete the file when this throws, so a file and its
 * registry row still live and die together.
 */
export function registerStorageObject(input: {
  bucket: StorageBucket;
  key: string;
  userId: string | null;
  contentType?: string;
  sizeBytes: number;
  refType: string;
  refId: string;
}): StorageObject {
  assertUsableDriver();
  assertSafeStorageKey(input.key);
  const now = new Date().toISOString();
  const register = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM storage_objects WHERE storage_key=?").get(input.key) as any;
    if (existing) {
      db.prepare("UPDATE storage_objects SET user_id=COALESCE(user_id, ?), size_bytes=?, content_type=? WHERE storage_key=?")
        .run(input.userId, input.sizeBytes, input.contentType || existing.content_type, input.key);
    } else {
      db.prepare(`INSERT INTO storage_objects
        (id, user_id, bucket, storage_key, driver, content_type, size_bytes, ref_type, ref_id, created_at, last_accessed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`)
        .run(randomUUID(), input.userId, input.bucket, input.key, "local", input.contentType || contentTypeFor(input.key),
          Math.max(0, Math.round(input.sizeBytes)), input.refType, input.refId, now);
    }
    addStorageRef(input.key, input.refType, input.refId);
  });
  register();
  return getStorageObject(input.key)!;
}

/**
 * Drop one reference. When the last reference goes away the file and the registry
 * row are deleted together; a file that cannot be deleted is an operator-visible
 * error, never a silent orphan.
 */
export function releaseStorageRef(key: string, refType: string, refId: string): { deleted: boolean } {
  assertSafeStorageKey(key);
  const object = getStorageObject(key);
  if (!object) {
    // Pre-registry legacy file that even the backfill could not place: only delete
    // it outright when no work still points at it, otherwise adopt it on the spot.
    const works = db.prepare("SELECT id, user_id FROM works WHERE archived_file=?").all(key) as any[];
    if (works.length) {
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(storageFilePath("outputs", key)).size; } catch {}
      registerStorageObject({
        bucket: "outputs", key, userId: works[0].user_id || null, sizeBytes,
        refType: "work", refId: String(works[0].id),
      });
      for (const work of works.slice(1)) addStorageRef(key, "work", String(work.id));
      return { deleted: false };
    }
    try { fs.unlinkSync(storageFilePath("outputs", key)); } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
    return { deleted: true };
  }
  db.prepare("DELETE FROM storage_object_refs WHERE storage_key=? AND ref_type=? AND ref_id=?").run(key, refType, refId);
  if (refCount(key) > 0) return { deleted: false };
  db.prepare("DELETE FROM storage_object_refs WHERE storage_key=?").run(key);
  db.prepare("DELETE FROM storage_objects WHERE storage_key=?").run(key);
  try { fs.unlinkSync(storageFilePath(object.bucket, key)); } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  return { deleted: true };
}

/** Remove a file and its registry row regardless of remaining refs (single-owner objects only). */
export function deleteStorageObjectNow(bucket: StorageBucket, key: string): boolean {
  assertSafeStorageKey(key);
  db.prepare("DELETE FROM storage_object_refs WHERE storage_key=?").run(key);
  db.prepare("DELETE FROM storage_objects WHERE storage_key=?").run(key);
  try {
    fs.unlinkSync(storageFilePath(bucket, key));
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

// ---------- one-time backfill of pre-registry files ----------

let backfillAttempted = false;

/**
 * Register files written before `storage_objects` existed. Ownership is recovered
 * from the rows that already know the file (`works.archived_file`, job outputs), so
 * downloads keep working for their owners and the orphan sweep never mistakes a
 * live legacy file for garbage. Idempotent; runs once per database.
 */
export function ensureStorageBackfill(): { registered: number } {
  const done = db.prepare("SELECT value FROM settings WHERE key='storage_backfill_v1'").get() as any;
  if (done || backfillAttempted) return { registered: 0 };
  backfillAttempted = true;

  const dir = outputDirectory();
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { names = []; }
  let registered = 0;
  const findWorks = db.prepare("SELECT id, user_id FROM works WHERE archived_file=?");
  const findJobs = db.prepare("SELECT id, user_id FROM jobs WHERE output_json LIKE ?");
  for (const name of names) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes(".part-") || name.startsWith(".")) continue;
    if (getStorageObject(name)) continue;
    let stat: fs.Stats;
    try { stat = fs.statSync(path.join(dir, name)); } catch { continue; }
    if (!stat.isFile() || stat.size <= 0) continue;
    const works = findWorks.all(name) as any[];
    const jobs = findJobs.all(`%${name}%`) as any[];
    if (!works.length && !jobs.length) continue; // no known owner: leave it to the orphan sweep
    const ownerId = String(jobs.find(job => job.user_id)?.user_id || works.find(work => work.user_id)?.user_id || "") || null;
    try {
      registerStorageObject({
        bucket: "outputs",
        key: name,
        userId: ownerId,
        sizeBytes: stat.size,
        refType: jobs.length ? "job" : "work",
        refId: String(jobs[0]?.id || works[0]?.id),
      });
      for (const job of jobs) addStorageRef(name, "job", String(job.id));
      for (const work of works) addStorageRef(name, "work", String(work.id));
      db.prepare("UPDATE works SET size_bytes=?, storage_key=? WHERE archived_file=? AND (storage_key IS NULL OR storage_key='')")
        .run(stat.size, name, name);
      registered += 1;
    } catch (error) {
      console.error("[storage] backfill failed for", name, error);
    }
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('storage_backfill_v1', ?, ?)")
    .run(new Date().toISOString(), new Date().toISOString());
  return { registered };
}
