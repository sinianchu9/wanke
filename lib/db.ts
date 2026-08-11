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

    CREATE TABLE IF NOT EXISTS subject_cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject_type TEXT NOT NULL CHECK(subject_type IN ('person','product')),
      description TEXT NOT NULL DEFAULT '',
      usage_notes TEXT NOT NULL DEFAULT '',
      primary_asset_id TEXT NOT NULL,
      asset_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subject_cards_type_updated ON subject_cards(subject_type, updated_at DESC);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      brief TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 1,
      selected_job_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(selected_job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shots_project_position ON shots(project_id, position ASC, created_at ASC);

    CREATE TABLE IF NOT EXISTS shot_jobs (
      shot_id TEXT NOT NULL,
      job_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(shot_id, job_id),
      FOREIGN KEY(shot_id) REFERENCES shots(id) ON DELETE CASCADE,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_shot_jobs_shot_created ON shot_jobs(shot_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS project_subjects (
      project_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(project_id, subject_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(subject_id) REFERENCES subject_cards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_assemblies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_assemblies_project_created ON project_assemblies(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS project_audio_settings (
      project_id TEXT PRIMARY KEY,
      bgm_asset_id TEXT,
      target_lufs REAL NOT NULL DEFAULT -16,
      original_gain_db REAL NOT NULL DEFAULT 0,
      bgm_gain_db REAL NOT NULL DEFAULT -12,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(bgm_asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS project_subtitle_settings (
      project_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'zho',
      title TEXT NOT NULL DEFAULT '字幕',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_transition_settings (
      project_id TEXT PRIMARY KEY,
      transition_type TEXT NOT NULL DEFAULT 'cut' CHECK(transition_type IN ('cut','fade')),
      duration REAL NOT NULL DEFAULT 0.5,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  return db;
}

const globalForDb = globalThis as GlobalWithDb;
export const db = globalForDb.__wankeDb || openDb();
if (process.env.NODE_ENV !== "production") globalForDb.__wankeDb = db;
