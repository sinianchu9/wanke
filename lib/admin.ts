import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import type { MembershipView } from "@/lib/membership";
import { getMembership } from "@/lib/membership";

export interface AdminUserRow {
  user: SessionUser & { lastLoginAt: string | null };
  membership: MembershipView;
}

export function writeAudit(adminUserId: string, action: string, targetType: string, targetId: string, meta: Record<string, unknown> = {}) {
  db.prepare("INSERT INTO admin_audit_logs (id, admin_user_id, action, target_type, target_id, meta_json, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(), adminUserId, action, targetType, targetId, JSON.stringify(meta), new Date().toISOString());
}

export function listAuditLogs(limit = 200) {
  const rows = db.prepare(`
    SELECT a.*, u.email AS admin_email FROM admin_audit_logs a
    LEFT JOIN users u ON u.id = a.admin_user_id
    ORDER BY a.created_at DESC LIMIT ?
  `).all(limit) as any[];
  return rows.map(row => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.meta_json || "{}"); } catch { meta = {}; }
    return {
      id: row.id,
      adminUserId: row.admin_user_id,
      adminEmail: row.admin_email || null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      meta,
      createdAt: row.created_at,
    };
  });
}

export function listAdminUsers(filter: { query?: string; plan?: string; status?: string; limit?: number; offset?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.query) {
    where.push("(u.email LIKE ? OR u.name LIKE ?)");
    params.push(`%${filter.query}%`, `%${filter.query}%`);
  }
  if (filter.plan) { where.push("m.plan = ?"); params.push(filter.plan); }
  if (filter.status) { where.push("u.status = ?"); params.push(filter.status); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
  const offset = Math.max(filter.offset || 0, 0);
  const rows = db.prepare(`
    SELECT u.*, m.plan, m.quota_limit_videos FROM users u
    LEFT JOIN memberships m ON m.user_id = u.id
    ${whereSql}
    ORDER BY u.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM users u LEFT JOIN memberships m ON m.user_id = u.id ${whereSql}`).get(...params) as any;
  return {
    total: Number(totalRow?.c || 0),
    users: rows.map(row => {
      const membership = getMembership(row.id);
      return {
        user: {
          id: row.id, email: row.email, name: row.name, role: row.role, status: row.status,
          avatarUrl: row.avatar_url || null, createdAt: row.created_at, lastLoginAt: row.last_login_at || null,
        },
        membership,
      };
    }),
  };
}

export function adminStats() {
  const q = (sql: string) => Number((db.prepare(sql).get() as any)?.c || 0);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  return {
    users: {
      total: q("SELECT COUNT(*) AS c FROM users"),
      active: q("SELECT COUNT(*) AS c FROM users WHERE status='active'"),
      admins: q("SELECT COUNT(*) AS c FROM users WHERE role='admin'"),
      newToday: q(`SELECT COUNT(*) AS c FROM users WHERE created_at >= '${dayStart}'`),
    },
    plans: {
      free: q("SELECT COUNT(*) AS c FROM memberships WHERE plan='free'"),
      pro: q("SELECT COUNT(*) AS c FROM memberships WHERE plan='pro'"),
      studio: q("SELECT COUNT(*) AS c FROM memberships WHERE plan='studio'"),
    },
    jobs: {
      total: q("SELECT COUNT(*) AS c FROM jobs"),
      running: q("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('queued','running','unknown')"),
      succeeded: q("SELECT COUNT(*) AS c FROM jobs WHERE status='succeeded'"),
      failed: q("SELECT COUNT(*) AS c FROM jobs WHERE status='failed'"),
      today: q(`SELECT COUNT(*) AS c FROM jobs WHERE created_at >= '${dayStart}'`),
      legacy: q("SELECT COUNT(*) AS c FROM jobs WHERE user_id IS NULL"),
    },
    works: { total: q("SELECT COUNT(*) AS c FROM works") },
    assets: { total: q("SELECT COUNT(*) AS c FROM assets") },
    generatedAt: now.toISOString(),
  };
}

export function listAdminJobs(filter: { userId?: string; status?: string; kind?: string; limit?: number; offset?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) { where.push("j.user_id = ?"); params.push(filter.userId); }
  if (filter.status) { where.push("j.status = ?"); params.push(filter.status); }
  if (filter.kind) { where.push("j.kind = ?"); params.push(filter.kind); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
  const offset = Math.max(filter.offset || 0, 0);
  const rows = db.prepare(`
    SELECT j.id, j.kind, j.title, j.status, j.error, j.user_id, j.created_at, j.updated_at, u.email AS owner_email
    FROM jobs j LEFT JOIN users u ON u.id = j.user_id
    ${whereSql}
    ORDER BY j.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM jobs j ${whereSql}`).get(...params) as any;
  return {
    total: Number(totalRow?.c || 0),
    jobs: rows.map(row => ({
      id: row.id, kind: row.kind, title: row.title, status: row.status,
      errorSummary: row.error ? String(row.error).slice(0, 300) : null,
      userId: row.user_id, ownerEmail: row.owner_email || null,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  };
}
