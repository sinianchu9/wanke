import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, errorResponse, getUserByEmail, hashPassword, HttpError, requestIp, sessionCookieOptions } from "@/lib/auth";
import { ensureMembership } from "@/lib/membership";
import { getFreePlan } from "@/lib/billing/catalog";
import { describeError } from "@/lib/errors";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确").max(254),
  name: z.string().trim().min(1, "请填写昵称").max(60),
  password: z.string().min(8, "密码至少 8 位").max(200),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (getUserByEmail(input.email)) throw new HttpError(409, "EMAIL_TAKEN", "该邮箱已注册，请直接登录");
    const now = new Date().toISOString();
    const id = randomUUID();
    const passwordHash = await hashPassword(input.password);
    db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)`).run(id, input.email, input.name, passwordHash, now, now);
    // Promote the first account when ADMIN_EMAIL matches, so a fresh deployment has an operator.
    if ((process.env.ADMIN_EMAIL || "").trim().toLowerCase() === input.email) {
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);
    }
    ensureMembership(id);
    const token = createSession(id, { userAgent: request.headers.get("user-agent"), ip: requestIp(request) });
    const user = getUserByEmail(input.email)!;
    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      plan: getFreePlan().id,
    }, { status: 201 });
    response.cookies.set("wanke_session", token, sessionCookieOptions(request));
    return response;
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
