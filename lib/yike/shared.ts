import "server-only";
import type { JobStatus } from "@/lib/types";

export type AnyObject = Record<string, any>;
export const plain = (v: unknown): AnyObject => JSON.parse(JSON.stringify(v ?? {}));
export const bodyOf = (response: any): AnyObject => plain(response?.body ?? response ?? {});

export function safeMerge(base: AnyObject, patch: unknown) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch as AnyObject)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = safeMerge(result[key], value);
    } else result[key] = value;
  }
  return result;
}

export function normalizeStatus(value: unknown): JobStatus {
  const s = String(value || "").toLowerCase();
  if (["finished", "succeeded", "success"].includes(s)) return "succeeded";
  if (["failed", "failure", "deleted"].includes(s)) return "failed";
  if (["created", "queuing", "queued", "pending"].includes(s)) return "queued";
  if (["executing", "running", "processing"].includes(s)) return "running";
  return "unknown";
}

export function parseJson(value: unknown, fallback: any) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function compact<T extends AnyObject>(obj: T): AnyObject {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length > 0)));
}

export function omit(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = { ...(value as AnyObject) };
  delete result[key];
  return result;
}

export async function fetchRemoteScript(url: string) {
  if (!url) throw new Error("缺少创意脚本 URL");
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol) || isPrivateHost(u.hostname)) throw new Error("只允许读取公网 HTTP/HTTPS 脚本 URL");
  const response = await fetch(u, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error(`读取复刻脚本失败：HTTP ${response.status}`);
  const len = Number(response.headers.get("content-length") || 0);
  if (len > 5 * 1024 * 1024) throw new Error("复刻脚本文件超过 5MB，拒绝读取");
  const text = await response.text();
  if (text.length > 5 * 1024 * 1024) throw new Error("复刻脚本文件超过 5MB，拒绝读取");
  try { JSON.parse(text); } catch { throw new Error("复刻脚本结果不是有效 JSON"); }
  return text;
}

function isPrivateHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h === "::1") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./); return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

export function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
