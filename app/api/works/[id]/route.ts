import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { deleteWork, getWorkForUser, updateWork } from "@/lib/works";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    if (!getWorkForUser(id, user.id)) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
    const patch = patchSchema.parse(await request.json());
    return NextResponse.json({ work: updateWork(id, patch) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    if (!getWorkForUser(id, user.id)) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
    if (!deleteWork(id)) return NextResponse.json({ error: "作品删除失败" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
