import { NextResponse } from "next/server";
import { saveLocalImage } from "@/lib/video/local-input";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) return NextResponse.json({ error: "请选择一张图片" }, { status: 400 });
    const input = await saveLocalImage(value);
    return NextResponse.json({ input }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
