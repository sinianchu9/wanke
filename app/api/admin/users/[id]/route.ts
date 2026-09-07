import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/admin";
import { errorResponse, getUserById, HttpError, requireAdmin } from "@/lib/auth";
import { adminExtendMembership, adminSetMembership, getMembership } from "@/lib/membership";
import { adminAdjustCredits } from "@/lib/billing/quota";
import { listPlans } from "@/lib/billing/catalog";
import { db } from "@/lib/db";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  plan: z.string().min(1).max(64).optional(),
  status: z.enum(["active", "disabled", "closed"]).optional(),
  extendDays: z.number().int().min(1).max(3650).optional(),
  creditDelta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  // Every administrative membership/credit change must carry a reason.
  note: z.string().min(2).max(500).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const admin = requireAdmin(request);
    const { id } = await ctx.params;
    const target = getUserById(id);
    if (!target) throw new HttpError(404, "NOT_FOUND", "用户不存在");
    const input = schema.parse(await request.json());
    const meta: Record<string, unknown> = {};

    if (input.plan && !listPlans({ includeArchived: true }).some(plan => plan.id === input.plan)) {
      throw new HttpError(400, "INVALID_PLAN", "未知套餐");
    }
    if ((input.plan || input.extendDays || input.creditDelta) && !(input.note || "").trim()) {
      throw new HttpError(400, "REASON_REQUIRED", "请填写调整原因，便于运营追溯");
    }
    if (input.status && input.status !== target.status) {
      // A single administrator role means the backoffice must never end up with nobody who
      // can sign in: an administrator may suspend another one, but never their own account.
      if (input.status !== "active" && target.id === admin.id) {
        throw new HttpError(400, "SELF_DISABLE", "不能停用或注销自己的管理员账号");
      }
      db.prepare("UPDATE users SET status=?, updated_at=? WHERE id=?")
        .run(input.status, new Date().toISOString(), id);
      // Suspended and cancelled accounts lose their sessions immediately.
      if (input.status !== "active") db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      const action = input.status === "active" ? "user.enable" : input.status === "closed" ? "user.close" : "user.disable";
      writeAudit(admin.id, action, "user", id, { email: target.email, note: input.note || "" });
      meta.status = input.status;
    }
    if (input.plan) {
      const before = getMembership(id);
      const after = adminSetMembership(id, { plan: input.plan, note: input.note, adminUserId: admin.id });
      writeAudit(admin.id, "membership.update", "membership", id, {
        email: target.email,
        note: input.note,
        before: { plan: before.planName, available: before.credits.available },
        after: { plan: after.planName, available: after.credits.available },
      });
      meta.membership = after;
    }
    if (input.extendDays) {
      const after = adminExtendMembership(id, input.extendDays, input.note || "", admin.id);
      writeAudit(admin.id, "membership.extend", "membership", id, { email: target.email, days: input.extendDays, note: input.note });
      meta.membership = after;
    }
    if (input.creditDelta) {
      const before = getMembership(id);
      const adjustment = adminAdjustCredits({ userId: id, delta: input.creditDelta, note: input.note || "", adminUserId: admin.id });
      writeAudit(admin.id, input.creditDelta > 0 ? "credits.grant" : "credits.deduct", "membership", id, {
        email: target.email,
        delta: adjustment.applied,
        note: input.note,
        before: before.credits.available,
        after: adjustment.balance.available,
      });
      meta.creditAdjustment = adjustment;
    }
    return NextResponse.json({ ok: true, user: getUserById(id), membership: getMembership(id), ...meta });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
