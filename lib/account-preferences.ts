import "server-only";
import { db } from "@/lib/db";
import { readPreferences, writePreferences, type NotificationChannel } from "@/lib/notifications";

/**
 * Member-facing creation preferences and notification preferences.
 * Platform configuration (creation service, keys, regions) is deliberately absent:
 * it lives in the backoffice only.
 */

export interface CreationPreferences {
  aspectRatio: string;
  resolution: string;
  subtitleEnabled: boolean;
  language: string;
  defaultDuration: number;
  favoriteTool: string;
}

const DEFAULT_CREATION: CreationPreferences = {
  aspectRatio: "16:9",
  resolution: "1080p",
  subtitleEnabled: false,
  language: "zh-CN",
  defaultDuration: 5,
  favoriteTool: "",
};

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
export const RESOLUTIONS = ["720p", "1080p"];
export const LANGUAGES = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
];

function nowIso() {
  return new Date().toISOString();
}

export function readCreationPreferences(userId: string): CreationPreferences {
  const row = db.prepare("SELECT creation_json FROM user_preferences WHERE user_id=?").get(userId) as { creation_json?: string } | undefined;
  let stored: Record<string, unknown> = {};
  try { stored = JSON.parse(row?.creation_json || "{}"); } catch { stored = {}; }
  const result = { ...DEFAULT_CREATION };
  if (typeof stored.aspectRatio === "string") result.aspectRatio = stored.aspectRatio;
  if (typeof stored.resolution === "string") result.resolution = stored.resolution;
  if (typeof stored.subtitleEnabled === "boolean") result.subtitleEnabled = stored.subtitleEnabled;
  if (typeof stored.language === "string") result.language = stored.language;
  if (typeof stored.defaultDuration === "number") result.defaultDuration = stored.defaultDuration;
  if (typeof stored.favoriteTool === "string") result.favoriteTool = stored.favoriteTool;
  return result;
}

export function writeCreationPreferences(userId: string, patch: Partial<CreationPreferences>): CreationPreferences {
  const next = { ...readCreationPreferences(userId) };
  if (patch.aspectRatio !== undefined) {
    if (!ASPECT_RATIOS.includes(patch.aspectRatio)) throw new Error("画幅选择无效");
    next.aspectRatio = patch.aspectRatio;
  }
  if (patch.resolution !== undefined) {
    if (!RESOLUTIONS.includes(patch.resolution)) throw new Error("清晰度选择无效");
    next.resolution = patch.resolution;
  }
  if (patch.subtitleEnabled !== undefined) next.subtitleEnabled = Boolean(patch.subtitleEnabled);
  if (patch.language !== undefined) {
    if (!LANGUAGES.some(item => item.value === patch.language)) throw new Error("语言选择无效");
    next.language = patch.language;
  }
  if (patch.defaultDuration !== undefined) {
    const duration = Number(patch.defaultDuration);
    if (![5, 10, 15, 30, 60].includes(duration)) throw new Error("视频长度选择无效");
    next.defaultDuration = duration;
  }
  if (patch.favoriteTool !== undefined) next.favoriteTool = String(patch.favoriteTool).slice(0, 40);
  db.prepare(`INSERT INTO user_preferences (user_id, creation_json, notify_json, updated_at)
    VALUES (?, ?, '{}', ?)
    ON CONFLICT(user_id) DO UPDATE SET creation_json=excluded.creation_json, updated_at=excluded.updated_at`)
    .run(userId, JSON.stringify(next), nowIso());
  return next;
}

export function readAllPreferences(userId: string) {
  return {
    creation: readCreationPreferences(userId),
    notifications: readPreferences(userId),
    options: { aspectRatios: ASPECT_RATIOS, resolutions: RESOLUTIONS, languages: LANGUAGES, durations: [5, 10, 15, 30, 60] },
  };
}

export function writeNotificationPreferences(userId: string, patch: Partial<Record<NotificationChannel, boolean>>) {
  return writePreferences(userId, patch);
}
