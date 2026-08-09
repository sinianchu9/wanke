import "server-only";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import type { ResultMedia, StoredJob } from "@/lib/types";

export function outputDirectory() {
  return path.resolve(process.env.WANKE_OUTPUT_DIR || "./data/outputs");
}

export function archivedFilePath(name: string) {
  const safe = path.basename(name);
  if (safe !== name || !/^[a-zA-Z0-9._-]+$/.test(safe)) throw new Error("非法归档文件名");
  return path.join(outputDirectory(), safe);
}

export async function archiveJobOutput(job: StoredJob, index: number) {
  const output = job.outputs[index];
  if (!output?.outputUrl) throw new Error("该结果没有远端 URL");
  if (output.archivedFile) return output;

  const response = await fetch(output.outputUrl, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(Math.max(60_000, Number(process.env.WANKE_ARCHIVE_TIMEOUT_MS || 1_800_000))) });
  if (!response.ok || !response.body) throw new Error(`下载结果失败：HTTP ${response.status}`);

  const maxBytes = Math.max(10, Number(process.env.WANKE_MAX_ARCHIVE_MB || 2048)) * 1024 * 1024;
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`文件超过归档上限 ${Math.round(maxBytes / 1024 / 1024)} MB`);

  const ext = extensionFor(output, response.headers.get("content-type"));
  const fileName = `${job.id}-${index + 1}${ext}`;
  const dir = outputDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const dest = archivedFilePath(fileName);
  const temp = `${dest}.part-${process.pid}`;
  let received = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error(`文件超过归档上限 ${Math.round(maxBytes / 1024 / 1024)} MB`));
      else callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body as any), limit, fs.createWriteStream(temp, { flags: "wx" }));
    fs.renameSync(temp, dest);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }

  return { ...output, archivedFile: fileName, archivedAt: new Date().toISOString() } satisfies ResultMedia;
}

export function deleteArchivedOutputs(outputs: ResultMedia[]) {
  for (const output of outputs) {
    if (!output.archivedFile) continue;
    try { fs.unlinkSync(archivedFilePath(output.archivedFile)); } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  }
}

export function contentTypeFor(name: string) {
  const ext = path.extname(name).toLowerCase();
  return ({
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".srt": "application/x-subrip", ".vtt": "text/vtt", ".json": "application/json; charset=utf-8",
  } as Record<string, string>)[ext] || "application/octet-stream";
}

function extensionFor(output: ResultMedia, contentType: string | null) {
  const pathname = safePath(output.outputUrl || "");
  const ext = path.extname(pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,6}$/.test(ext)) return ext;
  if (output.kind === "subtitle") return ".srt";
  if (output.kind === "json") return ".json";
  if (contentType?.includes("webm")) return ".webm";
  if (contentType?.includes("quicktime")) return ".mov";
  if (contentType?.includes("audio/mpeg")) return ".mp3";
  if (contentType?.startsWith("audio/")) return ".m4a";
  return ".mp4";
}

function safePath(value: string) {
  try { return new URL(value).pathname; } catch { return ""; }
}
