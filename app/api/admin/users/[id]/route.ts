import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/admin";
import { errorResponse, getUserById, HttpError, requireAdmin } from "@/lib/auth";
import { adminSetMembership, getMembership, PLAN_IDS } from "@/lib/membership";
import { db } from "@/lib/db";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  plan: z.enum(PLAN_IDS).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  quotaUsed: z.number().int().min(0).max(1_000_000).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const admin = requireAdmin(request);
    const { id } = await ctx.params;
    const target = getUserById(id);
    if (!target) throw new HttpError(404, "NOT_FOUND", "用户不存在");
    const input = schema.parse(await request.json());
    if (target.id === admin.id && input.status === "disabled") {
      throw new HttpError(400, "SELF_DISABLE", "不能停用自己的管理员账号");
    }
    const meta: Record<string, unknown> = {};

    if (input.status && input.status !== target.status) {
      db.prepare("UPDATE users SET status=?, updated_at=? WHERE id=?")
        .run(input.status, new Date().toISOString(), id);
      // Disabled users lose their sessions immediately.
      if (input.status === "disabled") db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      writeAudit(admin.id, input.status === "disabled" ? "user.disable" : "user.enable", "user", id, { email: target.email });
      meta.status = input.status;
    }
    if (input.plan || input.quotaUsed !== undefined) {
      const before = getMembership(id);
      const after = adminSetMembership(id, { plan: input.plan, quotaUsed: input.quotaUsed });
      writeAudit(admin.id, "membership.update", "membership", id, {
        email: target.email,
        before: { plan: before.plan, used: before.quotaUsedVideos, limit: before.quotaLimitVideos },
        after: { plan: after.plan, used: after.quotaUsedVideos, limit: after.quotaLimitVideos },
      });
      meta.membership = after;
    }
    return NextResponse.json({ ok: true, user: getUserById(id), membership: getMembership(id), ...meta });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
