import { NextResponse } from "next/server";
import { z } from "zod";
import { createSubjectCard, deleteSubjectCard, publicSubjectCards, updateSubjectCard } from "@/lib/subjects";
import { describeError } from "@/lib/errors";

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

export async function GET() {
  return NextResponse.json({ subjects: publicSubjectCards() });
}

export async function POST(request: Request) {
  try {
    const input = subjectSchema.parse(await request.json());
    const card = createSubjectCard(input);
    return NextResponse.json({ subject: card }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: formatError(error) }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const id = z.string().min(1).parse(body?.id);
    const input = subjectSchema.parse(body);
    return NextResponse.json({ subject: updateSubjectCard(id, input) });
  } catch (error) {
    return NextResponse.json({ error: formatError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "缺少主体卡 id" }, { status: 400 });
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
