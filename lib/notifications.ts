import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * In-app notification center. Business events (creation finished, credits running
 * low, membership expiring, payment, refund, ticket reply, announcement) land here
 * first; email is an additional channel and never the only one.
 */

export type NotificationType =
  | "job_done"
  | "job_failed"
  | "quota_low"
  | "plan_expiring"
  | "payment_success"
  | "refund_done"
  | "ticket_reply"
  | "announcement"
  | "system";

export type NotificationChannel = "job" | "quota" | "order" | "system" | "email";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

const TYPE_TO_CHANNEL: Record<NotificationType, NotificationChannel> = {
  job_done: "job",
  job_failed: "job",
  quota_low: "quota",
  plan_expiring: "order",
  payment_success: "order",
  refund_done: "order",
  ticket_reply: "system",
  announcement: "system",
  system: "system",
};

const DEFAULT_PREFERENCES: Record<NotificationChannel, boolean> = {
  job: true,
  quota: true,
  order: true,
  system: true,
  email: false,
};

function nowIso() {
  return new Date().toISOString();
}

export function readPreferences(userId: string): Record<NotificationChannel, boolean> {
  const row = db.prepare("SELECT notify_json FROM user_preferences WHERE user_id=?").get(userId) as { notify_json?: string } | undefined;
  let stored: Record<string, unknown> = {};
  try { stored = JSON.parse(row?.notify_json || "{}"); } catch { stored = {}; }
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(DEFAULT_PREFERENCES) as NotificationChannel[]) {
    if (typeof stored[key] === "boolean") result[key] = stored[key] as boolean;
  }
  return result;
}

export function writePreferences(userId: string, patch: Partial<Record<NotificationChannel, boolean>>): Record<NotificationChannel, boolean> {
  const next = { ...readPreferences(userId), ...patch };
  db.prepare(`INSERT INTO user_preferences (user_id, creation_json, notify_json, updated_at)
    VALUES (?, '{}', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET notify_json=excluded.notify_json, updated_at=excluded.updated_at`)
    .run(userId, JSON.stringify(next), nowIso());
  return next;
}

export function isChannelEnabled(userId: string, type: NotificationType): boolean {
  return readPreferences(userId)[TYPE_TO_CHANNEL[type]] !== false;
}

export function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
  ignorePreference?: boolean;
}): Notification | null {
  if (!input.ignorePreference && !isChannelEnabled(input.userId, input.type)) return null;
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO notifications (id, user_id, type, title, body, link, dedupe_key, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
    .run(id, input.userId, input.type, input.title.trim(), (input.body || "").trim(), (input.link || "").trim(), input.dedupeKey || null, now);
  return { id, type: input.type, title: input.title.trim(), body: (input.body || "").trim(), link: (input.link || "").trim(), read: false, createdAt: now };
}

export function listNotifications(userId: string, options: { limit?: number; unreadOnly?: boolean } = {}): { unread: number; items: Notification[] } {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const where = options.unreadOnly ? "WHERE user_id=? AND read_at IS NULL" : "WHERE user_id=?";
  const rows = db.prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(userId, limit) as any[];
  const unread = Number((db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND read_at IS NULL").get(userId) as any).c || 0);
  return {
    unread,
    items: rows.map(row => ({
      id: row.id, type: row.type, title: row.title, body: row.body || "", link: row.link || "",
      read: Boolean(row.read_at), createdAt: row.created_at,
    })),
  };
}

export function markNotificationRead(id: string, userId: string): boolean {
  return db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL")
    .run(nowIso(), id, userId).changes > 0;
}

export function markAllNotificationsRead(userId: string): number {
  return db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").run(nowIso(), userId).changes;
}

/**
 * Low-credit warning, at most once per threshold crossing so a user is not spammed
 * while every submit keeps re-triggering it.
 */
export function notifyLowCredits(userId: string, available: number, planName: string): void {
  if (available > 2) return;
  const dedupeKey = `quota_low:${available}`;
  if (alreadyNotified(userId, "quota_low", dedupeKey)) return;
  createNotification({
    userId,
    type: "quota_low",
    title: available <= 0 ? "创作额度已用完" : "创作额度即将用完",
    body: available <= 0
      ? "当前创作额度已经用完，购买额度或升级会员后可以继续创作。"
      : `当前仅剩 ${available} 个创作额度，可以随时购买额度补充。`,
    link: "/account/credits",
    dedupeKey,
  });
}

function alreadyNotified(userId: string, type: NotificationType, dedupeKey: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND type=? AND dedupe_key=?").get(userId, type, dedupeKey));
}

export function notifyPlanExpiring(userId: string, planName: string, daysLeft: number): void {
  const dedupeKey = `plan_expiring:${daysLeft}`;
  if (alreadyNotified(userId, "plan_expiring", dedupeKey)) return;
  createNotification({
    userId,
    type: "plan_expiring",
    title: "会员即将到期",
    body: `「${planName}」还有 ${daysLeft} 天到期，续费后可以继续使用当前创作额度。`,
    link: "/account/membership",
    dedupeKey,
  });
}
