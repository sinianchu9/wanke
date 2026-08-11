import "server-only";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/lib/db";

const execFileAsync = promisify(execFile);

export type ProjectSubtitleSettings = {
  projectId: string;
  enabled: boolean;
  content: string;
  language: string;
  title: string;
  updatedAt: string | null;
};

export type ProjectSubtitleSnapshot = {
  enabled: boolean;
  language: string;
  title: string;
  cueCount: number;
  contentHash: string | null;
};

type Cue = { startMs: number; endMs: number; text: string[] };

export function getProjectSubtitleSettings(projectId: string): ProjectSubtitleSettings {
  const row = db.prepare("SELECT * FROM project_subtitle_settings WHERE project_id=?").get(projectId) as any;
  return {
    projectId,
    enabled: Boolean(row?.enabled),
    content: String(row?.content || ""),
    language: String(row?.language || "zho"),
    title: String(row?.title || "字幕"),
    updatedAt: row?.updated_at || null,
  };
}

export function setProjectSubtitleSettings(input: {
  projectId: string;
  enabled: boolean;
  content: string;
  language: string;
  title: string;
}) {
  if (!db.prepare("SELECT 1 FROM projects WHERE id=?").get(input.projectId)) throw new Error("项目不存在");
  const normalized = input.content.trim() ? normalizeSrt(input.content).content : "";
  if (input.enabled && !normalized) throw new Error("启用字幕前请先填写 SRT 字幕内容");
  const language = normalizeLanguage(input.language);
  const title = input.title.trim() || "字幕";
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO project_subtitle_settings
    (project_id,enabled,content,language,title,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET
      enabled=excluded.enabled,
      content=excluded.content,
      language=excluded.language,
      title=excluded.title,
      updated_at=excluded.updated_at`)
    .run(input.projectId, input.enabled ? 1 : 0, normalized, language, title, now);
  db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(now, input.projectId);
  return getProjectSubtitleSettings(input.projectId);
}

export async function renderProjectSubtitles(input: {
  projectId: string;
  inputPath: string;
  outputPath: string;
  tempRoot: string;
  duration: number;
}) {
  const settings = getProjectSubtitleSettings(input.projectId);
  if (!settings.enabled || !settings.content.trim()) {
    await fsp.copyFile(input.inputPath, input.outputPath);
    return subtitleSnapshot(settings, 0, null);
  }

  const parsed = normalizeSrt(settings.content);
  const maxEndMs = parsed.cues.reduce((max, cue) => Math.max(max, cue.endMs), 0);
  if (maxEndMs > (input.duration + 2) * 1000) {
    throw new Error(`字幕最后时间 ${formatSeconds(maxEndMs / 1000)}s 超出了项目成片时长 ${formatSeconds(input.duration)}s，请检查 SRT 时间轴`);
  }
  const subtitlePath = path.join(input.tempRoot, "project-subtitles.srt");
  await fsp.writeFile(subtitlePath, parsed.content, "utf8");

  await runFfmpeg([
    "-y",
    "-i", input.inputPath,
    "-f", "srt", "-i", subtitlePath,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-map", "1:0",
    "-c:v", "copy",
    "-c:a", "copy",
    "-c:s", "mov_text",
    "-metadata:s:s:0", `language=${settings.language}`,
    "-metadata:s:s:0", `title=${settings.title}`,
    "-t", input.duration.toFixed(3),
    "-movflags", "+faststart",
    input.outputPath,
  ]);

  const hash = createHash("sha256").update(parsed.content, "utf8").digest("hex");
  return subtitleSnapshot(settings, parsed.cues.length, hash);
}

export function normalizeSrt(raw: string) {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { content: "", cues: [] as Cue[] };
  if (text.length > 100_000) throw new Error("SRT 字幕内容不能超过 100000 个字符");

  const blocks = text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  if (blocks.length > 1000) throw new Error("SRT 字幕最多支持 1000 条");
  const cues: Cue[] = [];

  blocks.forEach((block, index) => {
    const lines = block.split("\n").map(line => line.trimEnd());
    let timeIndex = 0;
    if (/^\d+$/.test(lines[0]?.trim() || "")) timeIndex = 1;
    const timeLine = lines[timeIndex]?.trim() || "";
    const match = /^(\d{2,3}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,3}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(timeLine);
    if (!match) throw new Error(`第 ${index + 1} 条字幕时间格式无效，应为 00:00:01,000 --> 00:00:03,000`);
    const startMs = toMs(match.slice(1, 5).map(Number));
    const endMs = toMs(match.slice(5, 9).map(Number));
    if (endMs <= startMs) throw new Error(`第 ${index + 1} 条字幕结束时间必须晚于开始时间`);
    const textLines = lines.slice(timeIndex + 1).filter(line => line.length > 0);
    if (!textLines.length) throw new Error(`第 ${index + 1} 条字幕没有文字内容`);
    cues.push({ startMs, endMs, text: textLines });
  });

  const content = cues.map((cue, index) => [
    String(index + 1),
    `${fromMs(cue.startMs)} --> ${fromMs(cue.endMs)}`,
    ...cue.text,
  ].join("\n")).join("\n\n") + "\n";
  return { content, cues };
}

function subtitleSnapshot(settings: ProjectSubtitleSettings, cueCount: number, contentHash: string | null): ProjectSubtitleSnapshot {
  return {
    enabled: settings.enabled && cueCount > 0,
    language: settings.language,
    title: settings.title,
    cueCount,
    contentHash,
  };
}

function normalizeLanguage(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z]{2,8}$/.test(normalized)) throw new Error("字幕语言代码无效");
  return normalized;
}

function toMs(parts: number[]) {
  const [hours, minutes, seconds, millis] = parts;
  if (minutes > 59 || seconds > 59) throw new Error("字幕时间格式无效");
  return (((hours * 60 + minutes) * 60) + seconds) * 1000 + millis;
}

function fromMs(value: number) {
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function ffmpegPath() {
  return String(process.env.FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
}

function ffmpegTimeout() {
  const configured = Number(process.env.WANKE_FFMPEG_TIMEOUT_MS || 600_000);
  return Number.isFinite(configured) ? Math.min(3_600_000, Math.max(30_000, configured)) : 600_000;
}

async function runFfmpeg(args: string[]) {
  try {
    await execFileAsync(ffmpegPath(), args, { timeout: ffmpegTimeout(), maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const tail = stderr ? stderr.split("\n").slice(-8).join("\n") : "";
    throw new Error(tail ? `FFmpeg 字幕封装失败：${tail}` : "FFmpeg 字幕封装失败");
  }
}

function formatSeconds(value: number) {
  return Number(value.toFixed(2));
}
