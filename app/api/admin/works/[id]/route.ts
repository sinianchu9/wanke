import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/admin";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { deleteWork, getWork } from "@/lib/works";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const admin = requireAdmin(request);
    const { id } = await ctx.params;
    const work = getWork(id);
    if (!work) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
    if (!deleteWork(id)) return NextResponse.json({ error: "作品删除失败" }, { status: 500 });
    writeAudit(admin.id, "work.delete", "work", id, { title: work.title, ownerId: work.userId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
