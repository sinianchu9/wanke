import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserByEmail } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/account-emails";
import { secondsSinceLastEmail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().toLowerCase().email("邮箱格式不正确").max(254) });

const COOLDOWN_SECONDS = 60;

/**
 * Request a password-reset link.
 *
 * The reply is identical whether or not the address exists, whether or not a mail was
 * just sent, and whether or not the cooldown swallowed the request: an account list must
 * not be discoverable through this endpoint.
 */
export async function POST(request: Request) {
  const notice = "如果这个邮箱已经注册，我们刚刚发送了一封包含重置链接的邮件，请在 30 分钟内完成设置。";
  try {
    const input = schema.parse(await request.json());
    const user = getUserByEmail(input.email);
    // Suspended and closed accounts get no link; the public reply stays the same.
    if (!user || user.status !== "active") return NextResponse.json({ ok: true, notice });
    const since = secondsSinceLastEmail(user.id, "password_reset");
    if (since !== null && since < COOLDOWN_SECONDS) return NextResponse.json({ ok: true, notice });
    await sendPasswordResetEmail(user.id, request);
    return NextResponse.json({ ok: true, notice });
  } catch {
    // Malformed input gets the same shape so timing and status cannot enumerate accounts.
    return NextResponse.json({ ok: true, notice });
  }
}
