import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { errorResponse, requireUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { createAsset } from "@/lib/repository";
import { assertSafeStorageKey, contentTypeFor, inputDirectory, registerStorageObject } from "@/lib/storage";
import { publicBaseUrl } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB

const ALLOWED_EXTENSIONS: Record<string, "video" | "image" | "audio" | "document"> = {
  mp4: "video",
  mov: "video",
  webm: "video",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  txt: "document",
  doc: "document",
  docx: "document",
};

export async function POST(request: Request) {
  let user;
  try {
    user = requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "请先登录后再上传素材" }, { status: 401 });
  }

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "上传失败：文件大小超过 100MB 限制，请压缩后再试。" },
        { status: 413 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择需要上传的文件" }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "选择的文件内容为空，无法上传" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `文件大小（${(file.size / (1024 * 1024)).toFixed(1)}MB）超过 100MB 上限，请减小文件后再试。` },
        { status: 413 }
      );
    }

    const originalName = file.name || "未命名素材";
    const ext = (originalName.split(".").pop() || "").toLowerCase();
    const mediaType = ALLOWED_EXTENSIONS[ext];
    if (!mediaType) {
      return NextResponse.json(
        { error: `不支持的文件格式（.${ext}）。目前支持格式：视频 (mp4, mov, webm)、图片 (jpg, png, webp)、音频 (mp3, wav, m4a)、文档 (txt, doc, docx)。` },
        { status: 400 }
      );
    }

    const storageKey = assertSafeStorageKey(`${randomUUID()}.${ext}`);
    const dir = inputDirectory();
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, storageKey);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer, { flag: "wx" });

    const mime = contentTypeFor(storageKey);
    const origin = publicBaseUrl(request);
    const publicUrl = `${origin}/api/assets/file/${storageKey}`;

    const asset = createAsset({
      name: originalName,
      mediaType,
      sourceUrl: publicUrl,
      userId: user.id,
      provider: {
        storage: "local-server",
        storageKey,
        originalName,
        sizeBytes: buffer.length,
        contentType: mime,
      },
    });

    try {
      registerStorageObject({
        bucket: "inputs",
        key: storageKey,
        userId: user.id,
        contentType: mime,
        sizeBytes: buffer.length,
        refType: "asset",
        refId: asset.id,
      });
    } catch (regError) {
      // Non-fatal: registration fails should not break the asset record if already written
      console.error("[storage] failed to register storage object:", regError);
    }

    return NextResponse.json({
      ok: true,
      asset,
      message: `素材「${originalName}」已成功上传到服务器。`,
    }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
