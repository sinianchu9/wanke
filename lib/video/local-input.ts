import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requestReferenceExists } from "@/lib/repository";
import { deleteStorageObjectNow, getStorageObject, inputDirectory, registerStorageObject } from "@/lib/storage";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const INPUT_SCHEME = "wanke-input:";
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type LocalImageInput = { ref: string; name: string; size: number };

export async function saveLocalImage(file: File, userId: string | null): Promise<LocalImageInput> {
  const mime = file.type.toLowerCase();
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new Error("本地图片仅支持 JPG、PNG 或 WEBP");
  if (file.size <= 0) throw new Error("图片文件为空");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片过大，请使用 10MB 以内的 JPG、PNG 或 WEBP");

  const id = `${randomUUID()}.${ext}`;
  const dir = inputDirectory();
  await fs.mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, id), buffer, { flag: "wx" });
  // Ownership is registered with the file, so another signed-in member can never
  // delete (or have served) an input that is not theirs.
  try {
    registerStorageObject({
      bucket: "inputs",
      key: id,
      userId,
      contentType: mime,
      sizeBytes: buffer.length,
      refType: "user",
      refId: userId || "",
    });
  } catch (error) {
    await fs.unlink(path.join(dir, id)).catch(() => undefined);
    throw error;
  }
  return { ref: `${INPUT_SCHEME}//${id}`, name: file.name || "本地图片", size: file.size };
}

export function isLocalInputRef(value: string) {
  return value.startsWith(`${INPUT_SCHEME}//`);
}

function safeFileName(ref: string) {
  if (!isLocalInputRef(ref)) throw new Error("不是有效的 Wanke 本地输入引用");
  const name = ref.slice(`${INPUT_SCHEME}//`.length);
  if (!/^[0-9a-f-]+\.(jpg|jpeg|png|webp)$/i.test(name)) throw new Error("本地输入引用无效");
  return name;
}

/** Owner recorded at upload time; null when the input predates ownership tracking. */
export function localInputOwner(ref: string): string | null {
  let name: string;
  try { name = safeFileName(ref); } catch { return null; }
  return getStorageObject(name)?.userId || null;
}

export async function localInputToDataUrl(ref: string) {
  const name = safeFileName(ref);
  const ext = name.split(".").pop()!.toLowerCase();
  const mime = EXT_TO_MIME[ext];
  if (!mime) throw new Error("本地图片格式不受支持");
  try {
    const data = await fs.readFile(path.join(inputDirectory(), name));
    if (data.length > MAX_IMAGE_BYTES) throw new Error("本地图片超过 10MB 限制");
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch (error: any) {
    if (error?.code === "ENOENT") throw new Error("本地参考图片已经不存在，请重新选择图片");
    throw error;
  }
}

export async function deleteLocalInput(ref: string) {
  const name = safeFileName(ref);
  await deleteStorageObjectNow("inputs", name);
}

export async function deleteLocalInputIfUnused(ref: string) {
  if (requestReferenceExists(ref)) return false;
  await deleteLocalInput(ref);
  return true;
}

export function collectLocalInputRefs(value: unknown, out = new Set<string>()) {
  if (typeof value === "string") {
    if (isLocalInputRef(value)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLocalInputRefs(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectLocalInputRefs(item, out);
  }
  return out;
}
