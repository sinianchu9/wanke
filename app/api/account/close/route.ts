import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { clearSessionCookie, errorResponse, getUserByEmail, HttpError, requireUser, revokeAllSessions, verifyPassword } from "@/lib/auth";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  password: z.string().min(1).max(200),
  confirm: z.literal(true),
});

/** Account cancellation: reversible only by an operator in the backoffice. */
export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = schema.parse(await request.json());
    const record = getUserByEmail(user.email);
    if (!record) throw new HttpError(404, "USER_NOT_FOUND", "账号不存在");
    if (!(await verifyPassword(input.password, record.passwordHash))) throw new HttpError(403, "BAD_PASSWORD", "密码不正确");
    // An administrator cannot cancel from the member centre: with a single administrator role
    // that would lock the backoffice permanently. Another operator does it in 后台 → 用户.
    if (user.role === "admin") {
      throw new HttpError(409, "ADMIN_ACCOUNT", "管理员账号不能在会员中心注销；如确需停用，请由另一位管理员在后台「用户」里处理");
    }
    const pendingOrders = Number((db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE user_id=? AND status IN ('pending','paying')`).get(user.id) as any).c || 0);
    if (pendingOrders > 0) throw new HttpError(409, "PENDING_ORDERS", "还有未完成的订单，请先取消或完成支付后再注销账号");
    const openTickets = Number((db.prepare(`SELECT COUNT(*) AS c FROM support_tickets WHERE user_id=? AND status IN ('open','processing','waiting_user')`).get(user.id) as any).c || 0);
    if (openTickets > 0) throw new HttpError(409, "OPEN_TICKETS", "还有处理中的反馈，请先关闭后再注销账号");
    const now = new Date().toISOString();
    db.prepare("UPDATE users SET status='closed', closed_at=?, updated_at=? WHERE id=?").run(now, now, user.id);
    revokeAllSessions(user.id);
    return clearSessionCookie(NextResponse.json({ ok: true }));
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
