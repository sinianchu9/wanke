import { NextResponse } from "next/server";
import { z } from "zod";
import { createSubjectCard, deleteSubjectCard, getSubjectCardForUser, publicSubjectCards, updateSubjectCard } from "@/lib/subjects";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser, type SessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subjectSchema = z.object({
  name: z.string().trim().min(1, "请输入主体名称").max(120),
  subjectType: z.enum(["person", "product"]),
  description: z.string().max(1000).optional().default(""),
  usageNotes: z.string().max(1000).optional().default(""),
  primaryAssetId: z.string().min(1, "请选择主参考图"),
  assetIds: z.array(z.string().min(1)).min(1, "至少选择 1 张图片").max(5, "主体卡最多 5 张参考图片"),
});

function auth(request: Request): { user?: SessionUser; response?: NextResponse } {
  try {
    return { user: requireUser(request) };
  } catch (error) {
    const handled = errorResponse(error);
    return { response: handled || NextResponse.json({ error: "服务器错误" }, { status: 500 }) };
  }
}

export async function GET(request: Request) {
  const { user, response } = auth(request);
  if (response) return response;
  return NextResponse.json({ subjects: publicSubjectCards(user!.id) });
}

export async function POST(request: Request) {
  const { user, response } = auth(request);
  if (response) return response;
  try {
    const input = subjectSchema.parse(await request.json());
    const card = createSubjectCard({ ...input, userId: user!.id });
    return NextResponse.json({ subject: card }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: formatError(error) }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const { user, response } = auth(request);
  if (response) return response;
  try {
    const body = await request.json();
    const id = z.string().min(1).parse(body?.id);
    const input = subjectSchema.parse(body);
    if (!getSubjectCardForUser(id, user!.id)) return NextResponse.json({ error: "主体卡不存在" }, { status: 404 });
    return NextResponse.json({ subject: updateSubjectCard(id, { ...input, userId: user!.id }) });
  } catch (error) {
    return NextResponse.json({ error: formatError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { user, response } = auth(request);
  if (response) return response;
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "缺少主体卡 id" }, { status: 400 });
    if (!getSubjectCardForUser(id, user!.id)) return NextResponse.json({ error: "主体卡不存在" }, { status: 404 });
    return deleteSubjectCard(id)
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "主体卡不存在" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

function formatError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map(issue => issue.message).join("；");
  return describeError(error);
}
