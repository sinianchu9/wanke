import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "wanke_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type UserRole = "user" | "admin";

export type AccountStatus = "active" | "disabled" | "closed";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: AccountStatus;
  avatarUrl: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}

// ---------- passwords (scrypt, no native deps) ----------

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 }, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return Promise.resolve(false);
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  return new Promise(resolve => {
    scrypt(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), Buffer.from(hashHex, "hex").length, {
      N: Number(nStr), r: Number(rStr), p: Number(pStr),
    }, (err, derived) => {
      if (err) return resolve(false);
      try { resolve(timingSafeEqual(derived, Buffer.from(hashHex, "hex"))); }
      catch { resolve(false); }
    });
  });
}

// ---------- sessions ----------

// Session tokens are stored hashed. AUTH_SECRET salts the hash so a leaked database
// alone cannot replay sessions; rotating AUTH_SECRET logs everyone out (documented).
function tokenDigest(token: string) {
  const secret = process.env.AUTH_SECRET?.trim() || "wanke-default-secret-set-AUTH_SECRET";
  return createHash("sha256").update(secret).update(token).digest("hex");
}

function rowToUser(row: any): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    avatarUrl: row.avatar_url || null,
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
  };
}

export function getUserById(id: string): SessionUser | null {
  const row = db.prepare("SELECT * FROM users WHERE id=?").get(id) as any;
  return row ? rowToUser(row) : null;
}

export function getUserByEmail(email: string): (SessionUser & { passwordHash: string }) | null {
  const row = db.prepare("SELECT * FROM users WHERE email=?").get(email.trim().toLowerCase()) as any;
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
}

export function createSession(userId: string, meta: { userAgent?: string | null; ip?: string | null } = {}): string {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?,?,?,?,?,?,?)")
    .run(tokenDigest(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString(), now.toISOString(),
      String(meta.userAgent || "").slice(0, 300) || null, String(meta.ip || "").slice(0, 64) || null);
  return token;
}

export function destroySession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenDigest(token));
}

export function listSessions(userId: string, currentToken: string): SessionInfo[] {
  const currentHash = currentToken ? tokenDigest(currentToken) : "";
  const now = Date.now();
  const rows = db.prepare(`SELECT token_hash, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions
    WHERE user_id=? AND expires_at > ? ORDER BY last_seen_at DESC`).all(userId, new Date(now).toISOString()) as any[];
  return rows.map((row, index) => ({
    id: `session-${index}-${row.token_hash.slice(0, 8)}`,
    userAgent: row.user_agent || "",
    ip: normalizeIp(row.ip || ""),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    current: row.token_hash === currentHash,
  }));
}

export function revokeOtherSessions(userId: string, currentToken: string): number {
  const currentHash = currentToken ? tokenDigest(currentToken) : "";
  return db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash <> ?").run(userId, currentHash).changes;
}

export function revokeAllSessions(userId: string): number {
  return db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId).changes;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return normalizeIp(forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "");
}

/** `::ffff:203.0.113.7` is how a dual-stack socket spells an IPv4 peer; members see plain IPv4. */
export function normalizeIp(ip: string): string {
  const value = (ip || "").trim();
  return value.replace(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i, "$1");
}

function requestIsSecure(request: Request): boolean {
  const proto = (request.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  try { return new URL(request.url).protocol === "https:"; } catch { return false; }
}

export function sessionCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: requestIsSecure(request),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}

export function getSessionToken(request: Request): string {
  return parseCookies(request.headers.get("cookie"))[SESSION_COOKIE] || "";
}

/** Resolve the authenticated user for a request, or null when unauthenticated. */
export function getCurrentUser(request: Request): SessionUser | null {
  const token = getSessionToken(request);
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=?
  `).get(tokenDigest(token)) as any;
  if (!row) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenDigest(token));
    return null;
  }
  if (row.status !== "active") return null;
  // Sliding expiry: refresh last_seen (and extend while active) at most once per hour.
  if (new Date(row.last_seen_at).getTime() < now - 60 * 60 * 1000) {
    db.prepare("UPDATE sessions SET last_seen_at=?, expires_at=? WHERE token_hash=?")
      .run(new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString(), tokenDigest(token));
  }
  return rowToUser(row);
}

/** CSRF defense-in-depth: reject cross-site mutating requests (SameSite=Lax already blocks most). */
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  if (!host) return;
  try {
    if (new URL(origin).host !== host) {
      throw new HttpError(403, "CSRF_REJECTED", "跨站请求被拒绝，请刷新页面后重试");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "BAD_ORIGIN", "请求来源无效");
  }
}

/** Require a logged-in, active user. Throws HttpError(401/403) otherwise. */
export function requireUser(request: Request): SessionUser {
  checkOrigin(request);
  const user = getCurrentUser(request);
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "请先登录后再操作");
  return user;
}

export function requireAdmin(request: Request): SessionUser {
  const user = requireUser(request);
  if (user.role !== "admin") throw new HttpError(403, "FORBIDDEN", "该操作仅限管理员");
  return user;
}

// ---------- page-level helpers (server components) ----------

import { headers as nextHeaders } from "next/headers";

/** Resolve the session user inside a server component/page. */
export async function getPageUser(): Promise<SessionUser | null> {
  const headerList = await nextHeaders();
  return getCurrentUser(new Request("http://localhost", { headers: headerList }));
}
