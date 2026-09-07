// Automated database backup and restore (§8.3.5 / §9.3.8).
//
//   node scripts/backup.mjs                      # one verified backup
//   node scripts/backup.mjs --restore <file>     # restore a backup into the live database
//
// Environment:
//   WANKE_DB_PATH     database to protect        (default ./data/wanke.db)
//   WANKE_BACKUP_DIR  where backups live         (default ./data/backups)
//   WANKE_BACKUP_KEEP how many backups to keep   (default 7)
//
// Rules that make this a real backup and not a file copy:
// - SQLite is copied with `VACUUM INTO`, never `cp`, so a hot WAL database always
//   produces a consistent snapshot;
// - every backup is verified before it counts: the copy must open, pass
//   `quick_check`, and contain the same newest ledger row as the source;
// - the result (success or failure) is written into the database itself, so the
//   backoffice 异常与风险 panel shows a stale or failing backup instead of silence;
// - `--restore` uses the SQLite online backup API into the live file, so recovery
//   works while the service is running (the service picks up restored data on its
//   next read; for a cold restore simply stop the service and replace the file).
//
// cron example (see docs/OPERATIONS.md §4):
//   17 3 * * * cd /opt/wanke && node scripts/backup.mjs >> /var/log/wanke-backup.log 2>&1
//
// Exit codes: 0 = backup verified / restore completed, 1 = anything failed.

import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.resolve(process.env.WANKE_DB_PATH || "./data/wanke.db");
const BACKUP_DIR = path.resolve(process.env.WANKE_BACKUP_DIR || "./data/backups");
const KEEP = Math.min(90, Math.max(1, Number(process.env.WANKE_BACKUP_KEEP || 7) || 7));

const Database = (await import("better-sqlite3")).default;

function nowStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function newestLedgerRow(db) {
  try {
    const row = db.prepare("SELECT id, created_at FROM quota_ledger ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
    return row ? `${row.id}|${row.created_at}` : "";
  } catch {
    return "";
  }
}

function userCount(db) {
  try { return Number(db.prepare("SELECT COUNT(*) AS c FROM users").get()?.c || 0); } catch { return -1; }
}

function verifyBackup(file, expectedLedger, expectedUsers) {
  const copy = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const check = copy.pragma("quick_check", { simple: true });
    if (String(check) !== "ok") throw new Error(`quick_check=${check}`);
    if (userCount(copy) !== expectedUsers) throw new Error("备份里的用户数与源库不一致");
    if (newestLedgerRow(copy) !== expectedLedger) throw new Error("备份里的最新账本行与源库不一致");
  } finally {
    copy.close();
  }
}

function recordStatus(status) {
  try {
    const db = new Database(DB_PATH, { timeout: 10000 });
    try {
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('backup_last_run', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .run(JSON.stringify(status), new Date().toISOString());
    } finally {
      db.close();
    }
  } catch (error) {
    console.error(`backup: 状态写入失败（备份本身已完成）: ${error?.message || error}`);
  }
}

function pruneBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(name => /^wanke-\d{8}-\d{6}\.db$/.test(name))
    .sort();
  const extra = files.length - KEEP;
  const removed = [];
  for (const name of files.slice(0, Math.max(0, extra))) {
    fs.unlinkSync(path.join(BACKUP_DIR, name));
    removed.push(name);
  }
  return removed;
}

function runBackup() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`数据库不存在: ${DB_PATH}`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `wanke-${nowStamp()}.db`;
  const finalPath = path.join(BACKUP_DIR, name);
  const tempPath = `${finalPath}.tmp-${process.pid}`;

  const source = new Database(DB_PATH, { timeout: 10000 });
  let expectedLedger;
  let expectedUsers;
  try {
    expectedLedger = newestLedgerRow(source);
    expectedUsers = userCount(source);
    // VACUUM INTO is SQLite's online, consistent copy: safe on a hot WAL database.
    source.exec(`VACUUM INTO '${tempPath.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }
  try {
    verifyBackup(tempPath, expectedLedger, expectedUsers);
    fs.renameSync(tempPath, finalPath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
  const bytes = fs.statSync(finalPath).size;
  const removed = pruneBackups();
  const status = { at: new Date().toISOString(), ok: true, file: finalPath, bytes, kept: Math.min(KEEP, fs.readdirSync(BACKUP_DIR).filter(n => n.endsWith(".db")).length), pruned: removed.length, error: null };
  recordStatus(status);
  console.log(`backup: 完成 ${finalPath} (${bytes} 字节)，校验通过，保留 ${status.kept} 份${removed.length ? `，清理旧备份 ${removed.length} 份` : ""}`);
}

function runRestore(file) {
  const backupPath = path.resolve(file);
  if (!fs.existsSync(backupPath)) throw new Error(`备份文件不存在: ${backupPath}`);
  // Verify the backup before it is allowed anywhere near the live database.
  verifyBackup(backupPath, (db => { try { return newestLedgerRow(db); } finally { db.close(); } })(new Database(backupPath, { readonly: true, fileMustExist: true })), (db => { try { return userCount(db); } finally { db.close(); } })(new Database(backupPath, { readonly: true, fileMustExist: true })));
  const restore = async () => {
    const source = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      await source.backup(DB_PATH);
    } finally {
      source.close();
    }
  };
  return restore().then(() => {
    const live = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    let ledger;
    try { ledger = newestLedgerRow(live); } finally { live.close(); }
    recordStatus({ at: new Date().toISOString(), ok: true, file: backupPath, bytes: fs.statSync(backupPath).size, restored: true, error: null });
    console.log(`backup: 已从 ${backupPath} 恢复，当前最新账本行 ${ledger || "（空）"}`);
  });
}

try {
  const restoreIndex = process.argv.indexOf("--restore");
  if (restoreIndex >= 0) {
    const file = process.argv[restoreIndex + 1];
    if (!file) throw new Error("--restore 需要备份文件路径");
    await runRestore(file);
  } else {
    runBackup();
  }
} catch (error) {
  const message = error?.message || String(error);
  recordStatus({ at: new Date().toISOString(), ok: false, file: null, bytes: 0, error: message });
  console.error(`backup: 失败 ${message}`);
  process.exit(1);
}
