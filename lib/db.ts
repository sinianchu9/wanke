import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type GlobalWithDb = typeof globalThis & { __wankeDb?: any };

function openDb() {
  const dbPath = path.resolve(process.env.WANKE_DB_PATH || "./data/wanke.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      provider_job_id TEXT,
      status TEXT NOT NULL,
      request_json TEXT NOT NULL,
      provider_json TEXT,
      output_json TEXT NOT NULL DEFAULT '[]',
      details_json TEXT,
      error TEXT,
      request_id TEXT,
      parent_job_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY(parent_job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_kind_created ON jobs(kind, created_at DESC);

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      provider_media_id TEXT,
      name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      provider_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assets_type_created ON assets(media_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

const globalForDb = globalThis as GlobalWithDb;
export const db = globalForDb.__wankeDb || openDb();
if (process.env.NODE_ENV !== "production") globalForDb.__wankeDb = db;
