import "server-only";
import { db } from "@/lib/db";

/**
 * Backup freshness as an operator-visible fact (§8.3.5). `scripts/backup.mjs`
 * writes its result into `settings.backup_last_run` after every run — success or
 * failure — so a backup that stopped happening shows up here instead of nowhere.
 */
export interface BackupStatus {
  at: string;
  ok: boolean;
  file: string | null;
  bytes: number;
  restored?: boolean;
  error: string | null;
}

export interface BackupHealth {
  last: BackupStatus | null;
  neverRun: boolean;
  lastOk: boolean;
  stale: boolean;
  hoursSinceSuccess: number | null;
}

const STALE_HOURS = 36;

export function backupHealth(): BackupHealth {
  const row = db.prepare("SELECT value FROM settings WHERE key='backup_last_run'").get() as any;
  let last: BackupStatus | null = null;
  if (row?.value) {
    try { last = JSON.parse(row.value) as BackupStatus; } catch { last = null; }
  }
  const successAt = last?.ok && last.at ? new Date(last.at).getTime() : null;
  const hoursSinceSuccess = successAt ? (Date.now() - successAt) / 3_600_000 : null;
  return {
    last,
    neverRun: !last,
    lastOk: Boolean(last?.ok),
    stale: !successAt || (hoursSinceSuccess !== null && hoursSinceSuccess > STALE_HOURS),
    hoursSinceSuccess,
  };
}
