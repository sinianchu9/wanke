import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { errorResponse, getUserById, requireUser } from "@/lib/auth";
import { ACCOUNT_STATUS_COPY } from "@/lib/copy";
import { getMembership } from "@/lib/membership";
import { publicSiteSettings } from "@/lib/system-settings";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  avatarUrl: z.string().trim().max(2048).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const profile = getUserById(user.id)!;
    return NextResponse.json({
      profile: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        emailVerified: profile.emailVerified,
        statusText: ACCOUNT_STATUS_COPY[profile.status] || "正常",
        createdAt: profile.createdAt,
      },
      membership: getMembership(user.id),
      site: publicSiteSettings(),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = requireUser(request);
    const input = schema.parse(await request.json());
    const now = new Date().toISOString();
    if (input.name !== undefined) db.prepare("UPDATE users SET name=?, updated_at=? WHERE id=?").run(input.name, now, user.id);
    if (input.avatarUrl !== undefined) {
      db.prepare("UPDATE users SET avatar_url=?, updated_at=? WHERE id=?").run(input.avatarUrl || null, now, user.id);
    }
    return NextResponse.json({ ok: true, profile: getUserById(user.id) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
