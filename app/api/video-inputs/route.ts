import { NextResponse } from "next/server";
import { deleteLocalInputIfUnused, isLocalInputRef, localInputOwner, saveLocalImage } from "@/lib/video/local-input";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 11 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "图片过大，请使用 10MB 以内的 JPG、PNG 或 WEBP" }, { status: 413 });
    }
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) return NextResponse.json({ error: "请选择一张图片" }, { status: 400 });
    const input = await saveLocalImage(value, user.id);
    return NextResponse.json({ input }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = requireUser(request);
    const ref = new URL(request.url).searchParams.get("ref") || "";
    if (!isLocalInputRef(ref)) return NextResponse.json({ error: "本地图片引用无效" }, { status: 400 });
    // A local input belongs to the member who uploaded it; everyone else gets the
    // same 404 as if it never existed (the site-wide isolation rule).
    const owner = localInputOwner(ref);
    if (owner && owner !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "本地图片不存在" }, { status: 404 });
    }
    const deleted = await deleteLocalInputIfUnused(ref);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
