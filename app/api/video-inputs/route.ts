import { NextResponse } from "next/server";
import { deleteLocalInputIfUnused, isLocalInputRef, saveLocalImage } from "@/lib/video/local-input";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 11 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "图片过大，请使用 10MB 以内的 JPG、PNG 或 WEBP" }, { status: 413 });
    }
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) return NextResponse.json({ error: "请选择一张图片" }, { status: 400 });
    const input = await saveLocalImage(value);
    return NextResponse.json({ input }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const ref = new URL(request.url).searchParams.get("ref") || "";
    if (!isLocalInputRef(ref)) return NextResponse.json({ error: "本地图片引用无效" }, { status: 400 });
    const deleted = await deleteLocalInputIfUnused(ref);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
