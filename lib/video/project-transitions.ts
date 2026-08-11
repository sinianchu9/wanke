import "server-only";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/lib/db";

const execFileAsync = promisify(execFile);
const MAX_FADE_SHOTS = 30;

export type ProjectTransitionSettings = {
  projectId: string;
  transitionType: "cut" | "fade";
  duration: number;
  updatedAt: string | null;
};

export type ProjectTransitionSnapshot = {
  transitionType: "cut" | "fade";
  duration: number;
  boundaryCount: number;
  rendered: boolean;
  timelineDuration: number;
};

export function getProjectTransitionSettings(projectId: string): ProjectTransitionSettings {
  const row = db.prepare("SELECT * FROM project_transition_settings WHERE project_id=?").get(projectId) as any;
  return {
    projectId,
    transitionType: row?.transition_type === "fade" ? "fade" : "cut",
    duration: finiteOr(row?.duration, 0.5),
    updatedAt: row?.updated_at || null,
  };
}

export function setProjectTransitionSettings(input: { projectId: string; transitionType: "cut" | "fade"; duration: number }) {
  if (!db.prepare("SELECT 1 FROM projects WHERE id=?").get(input.projectId)) throw new Error("项目不存在");
  const transitionType = input.transitionType === "fade" ? "fade" : "cut";
  const duration = clamp(input.duration, 0.2, 1.5);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO project_transition_settings (project_id,transition_type,duration,updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET
      transition_type=excluded.transition_type,
      duration=excluded.duration,
      updated_at=excluded.updated_at`)
    .run(input.projectId, transitionType, duration, now);
  db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(now, input.projectId);
  return getProjectTransitionSettings(input.projectId);
}

export async function renderProjectTimeline(input: {
  projectId: string;
  files: string[];
  durations: number[];
  outputPath: string;
  tempRoot: string;
}) {
  if (!input.files.length || input.files.length !== input.durations.length) throw new Error("项目镜头时间线数据不完整");
  if (input.durations.some(value => !Number.isFinite(value) || value <= 0)) throw new Error("项目镜头包含无效时长，无法生成时间线");
  const settings = getProjectTransitionSettings(input.projectId);
  const boundaryCount = Math.max(0, input.files.length - 1);
  const sourceDuration = input.durations.reduce((sum, value) => sum + value, 0);

  if (settings.transitionType === "cut" || input.files.length === 1) {
    const concatFile = path.join(input.tempRoot, "concat.txt");
    await fsp.writeFile(concatFile, input.files.map(file => `file '${path.basename(file)}'`).join("\n"), "utf8");
    await runFfmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c", "copy", "-movflags", "+faststart", input.outputPath,
    ]);
    return {
      transitionType: settings.transitionType,
      duration: settings.duration,
      boundaryCount,
      rendered: false,
      timelineDuration: sourceDuration,
    } satisfies ProjectTransitionSnapshot;
  }

  if (input.files.length > MAX_FADE_SHOTS) {
    throw new Error(`淡化转场首版最多支持 ${MAX_FADE_SHOTS} 个镜头；长项目请改用直接切换或拆分章节`);
  }

  const transitionDuration = settings.duration;
  for (let index = 0; index < input.durations.length; index += 1) {
    if (input.durations[index] <= transitionDuration + 0.1) {
      throw new Error(`第 ${index + 1} 个镜头时长过短，无法应用 ${transitionDuration}s 淡化转场；请缩短转场或改为直接切换`);
    }
  }

  const args = ["-y"];
  for (const file of input.files) args.push("-i", file);
  const filters: string[] = [];
  input.files.forEach((_file, index) => {
    filters.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${index}:a]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a${index}]`);
  });

  let videoLabel = "v0";
  let audioLabel = "a0";
  let outputDuration = input.durations[0];
  for (let index = 1; index < input.files.length; index += 1) {
    const offset = outputDuration - transitionDuration;
    if (offset < 0) throw new Error("转场偏移无效，请缩短淡化时长");
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    filters.push(`[${videoLabel}][v${index}]xfade=transition=fade:duration=${format(transitionDuration)}:offset=${format(offset)}[${nextVideo}]`);
    filters.push(`[${audioLabel}][a${index}]acrossfade=d=${format(transitionDuration)}:c1=tri:c2=tri[${nextAudio}]`);
    videoLabel = nextVideo;
    audioLabel = nextAudio;
    outputDuration += input.durations[index] - transitionDuration;
  }
  if (!Number.isFinite(outputDuration) || outputDuration <= 0) throw new Error("转场后的项目时长无效");

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`,
    "-map", `[${audioLabel}]`,
    "-c:v", "libx264",
    "-preset", String(process.env.WANKE_FFMPEG_PRESET || "medium"),
    "-crf", String(normalizedCrf()),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-t", format(outputDuration),
    "-movflags", "+faststart",
    input.outputPath,
  );
  await runFfmpeg(args);

  return {
    transitionType: "fade",
    duration: transitionDuration,
    boundaryCount,
    rendered: true,
    timelineDuration: outputDuration,
  } satisfies ProjectTransitionSnapshot;
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
    await execFileAsync(ffmpegPath(), args, { timeout: ffmpegTimeout(), maxBuffer: 8 * 1024 * 1024, encoding: "utf8" });
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const tail = stderr ? stderr.split("\n").slice(-10).join("\n") : "";
    throw new Error(tail ? `FFmpeg 转场处理失败：${tail}` : "FFmpeg 转场处理失败");
  }
}

function normalizedCrf() {
  const value = Number(process.env.WANKE_FFMPEG_CRF || 20);
  return Number.isFinite(value) ? Math.min(35, Math.max(14, Math.round(value))) : 20;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) throw new Error("转场时长必须是有效数字");
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function format(value: number) {
  return Number(value.toFixed(3)).toString();
}
