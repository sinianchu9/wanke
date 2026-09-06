import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { errorResponse, getUserById, hashPassword, revokeAllSessions } from "@/lib/auth";
import { consumeAccountToken, revokeAccountTokens } from "@/lib/account-tokens";
import { createNotification } from "@/lib/notifications";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().trim().min(32).max(128),
  password: z.string().min(8, "密码至少 8 位").max(200),
});

/**
 * Set a new password from a reset link.
 *
 * The link is consumed first and only then is the password written, so a second submit
 * with the same link can never change the password again. Every existing session is
 * revoked: if the reset was needed because credentials leaked, the old logins must die.
 */
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const userId = consumeAccountToken(input.token, "reset_password");
    revokeAccountTokens(userId, "reset_password");
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(input.password);
    // Receiving the mail proves mailbox control, so the address is verified as a side effect.
    db.prepare(`UPDATE users SET password_hash=?, email_verified=1,
      email_verified_at=COALESCE(email_verified_at, ?), updated_at=? WHERE id=?`)
      .run(passwordHash, now, now, userId);
    const revoked = revokeAllSessions(userId);
    const user = getUserById(userId);
    createNotification({
      userId,
      type: "system",
      title: "密码已经重置",
      body: revoked > 0
        ? `密码重置成功，原来的 ${revoked} 个登录已经全部退出，请重新登录。`
        : "密码重置成功，请重新登录。",
      link: "/login",
      ignorePreference: true,
    });
    return NextResponse.json({ ok: true, revokedSessions: revoked, email: user?.email || "" });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
