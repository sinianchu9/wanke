import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/account-emails";
import { tokenTtlMinutes } from "@/lib/account-tokens";
import { secondsSinceLastEmail } from "@/lib/mailer";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESEND_COOLDOWN_SECONDS = 60;

/** Ask for a new verification mail. Only the member's own address is ever used. */
export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    if (user.emailVerified) {
      return NextResponse.json({ error: "这个邮箱已经验证过了", code: "EMAIL_ALREADY_VERIFIED" }, { status: 409 });
    }
    const since = secondsSinceLastEmail(user.id, "verify_email");
    if (since !== null && since < RESEND_COOLDOWN_SECONDS) {
      const wait = RESEND_COOLDOWN_SECONDS - since;
      return NextResponse.json({
        error: `发送太频繁了，请 ${wait} 秒后再试`, code: "RATE_LIMITED", retryAfterSeconds: wait,
      }, { status: 429 });
    }
    const result = await sendVerificationEmail(user.id, request);
    const minutes = tokenTtlMinutes("verify_email");
    if (result.status === "failed") {
      // The technical reason stays in the mail journal for the backoffice.
      return NextResponse.json({
        error: "验证邮件发送失败，请稍后重试；如果一直失败请联系客服", code: "EMAIL_SEND_FAILED", delivered: false,
      }, { status: 502 });
    }
    if (!result.delivered) {
      return NextResponse.json({
        error: "平台邮件服务尚未开启，暂时无法发送验证邮件，请联系客服", code: "EMAIL_UNAVAILABLE", delivered: false,
      }, { status: 503 });
    }
    db.prepare("UPDATE users SET updated_at=? WHERE id=?").run(new Date().toISOString(), user.id);
    return NextResponse.json({
      ok: true,
      delivered: true,
      email: user.email,
      expiresMinutes: minutes,
      notice: `验证邮件已发送到 ${user.email}，请在 ${minutes / 60} 小时内点击邮件中的链接完成验证。`,
    });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
