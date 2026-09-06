import "server-only";
import Database from "better-sqlite3";
import { ensureCommercialSchema } from "@/lib/db-commercial";
import { encryptSecret } from "@/lib/crypto-secrets";
import fs from "node:fs";
import path from "node:path";

type GlobalWithDb = typeof globalThis & { __wankeDb?: any };

function openDb() {
  const dbPath = path.resolve(process.env.WANKE_DB_PATH || "./data/wanke.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { timeout: 10000 });
  db.pragma("busy_timeout = 10000");
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

    -- ===== SaaS layer: accounts, sessions, billing, works, audit =====
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS memberships (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro','studio')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','suspended')),
      quota_limit_videos INTEGER NOT NULL,
      quota_used_videos INTEGER NOT NULL DEFAULT 0,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS works (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover_url TEXT,
      video_url TEXT,
      archived_file TEXT,
      job_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_works_user_created ON works(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_email_created ON login_attempts(email, created_at DESC);
  `);
  addColumnIfMissing(db, "jobs", "user_id", "TEXT");
  addColumnIfMissing(db, "assets", "user_id", "TEXT");
  addColumnIfMissing(db, "projects", "user_id", "TEXT");
  addColumnIfMissing(db, "subject_cards", "user_id", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_user_created ON assets(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subject_cards_user ON subject_cards(user_id, updated_at DESC);
  `);
  // Registered before the commercial schema migration so legacy plain-text
  // provider credentials can be sealed while the connection is still opening.
  (globalThis as any).__wankeSecretEncrypt = encryptSecret;
  ensureCommercialSchema(db);
  seedAdminFromEnv(db);
  return db;
}

// Idempotent column migration so pre-SaaS databases upgrade safely.
// Legacy rows keep user_id NULL: they stay invisible to members and are
// only visible to admins (see docs/SAAS.md "Legacy data").
// Multiple Next workers can boot at once, so treat "duplicate column" as success.
function addColumnIfMissing(db: any, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some(c => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (error: any) {
    if (!String(error?.message || "").includes("duplicate column")) throw error;
  }
}

function seedAdminFromEnv(db: any) {
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!adminEmail) return;
  const row = db.prepare("SELECT id, role FROM users WHERE email = ?").get(adminEmail) as { id: string; role: string } | undefined;
  if (row && row.role !== "admin") {
    db.prepare("UPDATE users SET role='admin', updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
  }
}

const globalForDb = globalThis as GlobalWithDb;
export const db = globalForDb.__wankeDb || openDb();
if (process.env.NODE_ENV !== "production") globalForDb.__wankeDb = db;
