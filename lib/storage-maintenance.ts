import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getBooleanSetting, getNumberSetting, setSetting } from "@/lib/system-settings";
import {
  deleteStorageObjectNow, ensureStorageBackfill, getStorageObject, inputDirectory, outputDirectory,
} from "@/lib/storage";
import { requestReferenceExists } from "@/lib/repository";

/**
 * Storage housekeeping (§9.3.7): one sweep callable from the worker, cron or the
 * backoffice, plus the disk-space reading the operator sees under 异常与风险.
 *
 * Rules that keep the sweep safe:
 * - a file is only ever deleted after `ensureStorageBackfill()` had its chance to
 *   recover ownership, and only after a grace period so an in-flight archive
 *   (file written, registry row not yet committed) is never mistaken for an orphan;
 * - a local input is deleted only when no stored request references it any more;
 * - every failure is collected into the summary instead of thrown away, so a file
 *   that cannot be removed shows up in the backoffice instead of silently piling up.
 */

export interface StorageSweepSummary {
  at: string;
  orphanFilesRemoved: number;
  staleInputsRemoved: number;
  danglingRowsRemoved: number;
  errors: string[];
  disk: DiskStatus;
}

export interface DiskStatus {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  freePercent: number;
  warnThresholdPercent: number;
  warn: boolean;
}

const LAST_SWEEP_KEY = "storage_last_sweep";
const OUTPUT_FILE_RE = /^[a-zA-Z0-9._-]+$/;
const INPUT_FILE_RE = /^[0-9a-f-]+\.(jpg|jpeg|png|webp)$/i;
const STALE_INPUT_MS = 24 * 60 * 60 * 1000;

function orphanGraceMs() {
  const minutes = getNumberSetting("storage_orphan_grace_minutes", 120);
  return Math.min(7 * 24 * 60, Math.max(5, minutes)) * 60 * 1000;
}

export function diskStatus(): DiskStatus {
  const dir = outputDirectory();
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  let total = 0;
  let free = 0;
  try {
    const stats = fs.statfsSync(dir);
    total = Number(stats.blocks) * Number(stats.bsize);
    free = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // statfs unsupported: report zeros and never raise a false alarm.
  }
  const warnThresholdPercent = Math.min(99, Math.max(1, getNumberSetting("storage_disk_warn_free_percent", 10)));
  const freePercent = total > 0 ? (free / total) * 100 : 100;
  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: Math.max(0, total - free),
    freePercent,
    warnThresholdPercent,
    warn: total > 0 && freePercent < warnThresholdPercent,
  };
}

export function readLastSweep(): StorageSweepSummary | null {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(LAST_SWEEP_KEY) as any;
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as StorageSweepSummary; } catch { return null; }
}

export function sweepEnabled() {
  return getBooleanSetting("storage_sweep_enabled");
}

export function sweepIntervalMinutes() {
  return Math.min(24 * 60, Math.max(5, getNumberSetting("storage_sweep_interval_minutes", 60)));
}

/** Run the sweep when it is due; called at the end of every worker pass. */
export function maybeRunStorageSweep(force = false): StorageSweepSummary | null {
  if (!force && !sweepEnabled()) return null;
  const last = readLastSweep();
  if (!force && last && Date.now() - new Date(last.at).getTime() < sweepIntervalMinutes() * 60 * 1000) return null;
  return runStorageSweep();
}

export function runStorageSweep(): StorageSweepSummary {
  ensureStorageBackfill();
  const summary: StorageSweepSummary = {
    at: new Date().toISOString(),
    orphanFilesRemoved: 0,
    staleInputsRemoved: 0,
    danglingRowsRemoved: 0,
    errors: [],
    disk: diskStatus(),
  };

  // 1. Registry rows whose file is gone: the file already left, so the row must follow.
  const rows = db.prepare("SELECT storage_key, bucket FROM storage_objects WHERE driver='local'").all() as any[];
  for (const row of rows) {
    const dir = row.bucket === "inputs" ? inputDirectory() : outputDirectory();
    try {
      if (fs.existsSync(path.join(dir, row.storage_key))) continue;
      db.prepare("DELETE FROM storage_object_refs WHERE storage_key=?").run(row.storage_key);
      db.prepare("DELETE FROM storage_objects WHERE storage_key=?").run(row.storage_key);
      summary.danglingRowsRemoved += 1;
    } catch (error: any) {
      summary.errors.push(`登记行清理失败 ${row.storage_key}: ${error?.message || error}`);
    }
  }

  // 2. Orphan output files: no registry row after backfill, older than the grace window.
  const cutoff = Date.now() - orphanGraceMs();
  let outputNames: string[] = [];
  try { outputNames = fs.readdirSync(outputDirectory()); } catch {}
  for (const name of outputNames) {
    if (!OUTPUT_FILE_RE.test(name) || name.includes(".part-") || name.startsWith(".")) continue;
    if (getStorageObject(name)) continue;
    try {
      const stat = fs.statSync(path.join(outputDirectory(), name));
      if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;
      fs.unlinkSync(path.join(outputDirectory(), name));
      summary.orphanFilesRemoved += 1;
    } catch (error: any) {
      if (error?.code !== "ENOENT") summary.errors.push(`孤儿文件清理失败 ${name}: ${error?.message || error}`);
    }
  }

  // 3. Local inputs past their 24h lifetime that no stored request references any more.
  let inputNames: string[] = [];
  try { inputNames = fs.readdirSync(inputDirectory()); } catch {}
  const staleBefore = Date.now() - STALE_INPUT_MS;
  for (const name of inputNames) {
    if (!INPUT_FILE_RE.test(name)) continue;
    try {
      const stat = fs.statSync(path.join(inputDirectory(), name));
      if (!stat.isFile() || stat.mtimeMs >= staleBefore) continue;
      if (requestReferenceExists(`wanke-input://${name}`)) continue;
      deleteStorageObjectNow("inputs", name);
      summary.staleInputsRemoved += 1;
    } catch (error: any) {
      if (error?.code !== "ENOENT") summary.errors.push(`本地输入清理失败 ${name}: ${error?.message || error}`);
    }
  }

  summary.disk = diskStatus();
  try {
    setSetting(LAST_SWEEP_KEY, JSON.stringify(summary));
  } catch (error: any) {
    summary.errors.push(`清扫结果写入失败: ${error?.message || error}`);
  }
  return summary;
}

function directoryBytes(dir: string): number {
  let total = 0;
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (stat.isFile()) total += stat.size;
    } catch {}
  }
  return total;
}

/** Operator-facing storage accounting (§9.3.10): totals, per-user, per-bucket, disk truth. */
export function storageStats() {
  ensureStorageBackfill();
  const totals = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS bytes FROM storage_objects").get() as any;
  const buckets = db.prepare("SELECT bucket, COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS bytes FROM storage_objects GROUP BY bucket ORDER BY bytes DESC").all() as any[];
  const byUser = db.prepare(`
    SELECT so.user_id, u.email, COUNT(*) AS c, COALESCE(SUM(so.size_bytes),0) AS bytes
    FROM storage_objects so LEFT JOIN users u ON u.id = so.user_id
    GROUP BY so.user_id ORDER BY bytes DESC LIMIT 20
  `).all() as any[];
  const registryBytes = Number(totals?.bytes || 0);
  const diskBytes = directoryBytes(outputDirectory()) + directoryBytes(inputDirectory());
  return {
    totals: { objects: Number(totals?.c || 0), bytes: registryBytes },
    buckets: buckets.map(row => ({ bucket: String(row.bucket), objects: Number(row.c || 0), bytes: Number(row.bytes || 0) })),
    topUsers: byUser.map(row => ({
      userId: row.user_id || null,
      email: row.email || null,
      objects: Number(row.c || 0),
      bytes: Number(row.bytes || 0),
    })),
    reconciliation: { registryBytes, diskBytes, differenceBytes: diskBytes - registryBytes },
    disk: diskStatus(),
    sweep: { enabled: sweepEnabled(), intervalMinutes: sweepIntervalMinutes(), last: readLastSweep() },
  };
}
