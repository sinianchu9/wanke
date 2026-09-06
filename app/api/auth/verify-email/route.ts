import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { errorResponse, getUserById } from "@/lib/auth";
import { consumeAccountToken, revokeAccountTokens } from "@/lib/account-tokens";
import { createNotification } from "@/lib/notifications";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().trim().min(32).max(128) });

/**
 * Consume a verification link. Public on purpose: the member may not be signed in when
 * they open the mail, and the token itself is the proof of mailbox ownership.
 */
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const userId = consumeAccountToken(input.token, "verify_email");
    const already = db.prepare("SELECT email_verified FROM users WHERE id=?").get(userId) as { email_verified?: number } | undefined;
    const now = new Date().toISOString();
    if (!already?.email_verified) {
      db.prepare("UPDATE users SET email_verified=1, email_verified_at=?, updated_at=? WHERE id=?").run(now, now, userId);
    }
    // Any other outstanding verification link is dead from this moment.
    revokeAccountTokens(userId, "verify_email");
    const user = getUserById(userId);
    if (!already?.email_verified) {
      createNotification({
        userId,
        type: "system",
        title: "邮箱验证成功",
        body: "你的登录邮箱已经验证通过，现在可以使用找回密码，创作也不再受限。",
        link: "/account",
        dedupeKey: "email_verified",
        ignorePreference: true,
      });
    }
    return NextResponse.json({ ok: true, email: user?.email || "", name: user?.name || "" });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "链接无效或已经失效，请重新获取一次", code: "TOKEN_INVALID" }, { status: 400 });
    }
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
