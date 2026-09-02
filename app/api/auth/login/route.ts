import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, errorResponse, getUserByEmail, HttpError, requestIp, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确").max(254),
  password: z.string().min(1).max(200),
});

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function recentFailures(email: string, ip: string): number {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM login_attempts
    WHERE email=? AND success=0 AND created_at >= ? AND ip = ?
  `).get(email, since, ip) as any;
  return Number(row?.c || 0);
}

function recordAttempt(email: string, ip: string, success: boolean) {
  db.prepare("INSERT INTO login_attempts (email, ip, success, created_at) VALUES (?,?,?,?)")
    .run(email, ip, success ? 1 : 0, new Date().toISOString());
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const ip = requestIp(request);
    if (recentFailures(input.email, ip) >= MAX_FAILURES) {
      throw new HttpError(429, "RATE_LIMITED", "登录失败次数过多，请 15 分钟后再试");
    }
    const user = getUserByEmail(input.email);
    const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !ok) {
      recordAttempt(input.email, ip, false);
      throw new HttpError(401, "BAD_CREDENTIALS", "邮箱或密码不正确");
    }
    if (user.status !== "active") throw new HttpError(403, "USER_DISABLED", "账号已被停用，请联系管理员");
    recordAttempt(input.email, ip, true);
    db.prepare("UPDATE users SET last_login_at=?, updated_at=? WHERE id=?")
      .run(new Date().toISOString(), new Date().toISOString(), user.id);
    const token = createSession(user.id);
    const response = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    response.cookies.set("wanke_session", token, sessionCookieOptions(request));
    return response;
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
