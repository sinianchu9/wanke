import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { errorResponse, getSessionToken, getUserByEmail, hashPassword, HttpError, requireUser, revokeOtherSessions, verifyPassword } from "@/lib/auth";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
  logoutOthers: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = schema.parse(await request.json());
    const record = getUserByEmail(user.email);
    if (!record) throw new HttpError(404, "USER_NOT_FOUND", "账号不存在");
    if (!(await verifyPassword(input.currentPassword, record.passwordHash))) {
      throw new HttpError(403, "BAD_PASSWORD", "当前密码不正确");
    }
    if (input.newPassword === input.currentPassword) {
      throw new HttpError(400, "SAME_PASSWORD", "新密码不能与当前密码相同");
    }
    db.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?")
      .run(await hashPassword(input.newPassword), new Date().toISOString(), user.id);
    let revoked = 0;
    if (input.logoutOthers !== false) revoked = revokeOtherSessions(user.id, getSessionToken(request));
    const response = NextResponse.json({ ok: true, revokedSessions: revoked });
    return response;
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
