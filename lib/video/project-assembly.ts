import "server-only";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { archivedFilePath, outputDirectory } from "@/lib/archive";
import { db } from "@/lib/db";
import { listProjects } from "@/lib/projects";
import { getJob } from "@/lib/repository";
import { renderProjectAudio } from "@/lib/video/project-audio";
import { renderProjectSubtitles } from "@/lib/video/project-subtitles";
import { renderProjectTimeline } from "@/lib/video/project-transitions";
import { ffprobeAvailable, probeResultMedia, type MediaProbe } from "@/lib/video/media-probe";
import type { ResultMedia } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type ProjectAssemblyRecord = {
  id: string;
  projectId: string;
  fileName: string;
  settings: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  createdAt: string;
};

function ffmpegPath() {
  return String(process.env.FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
}

function ffmpegTimeout() {
  const configured = Number(process.env.WANKE_FFMPEG_TIMEOUT_MS || 600_000);
  return Number.isFinite(configured) ? Math.max(30_000, configured) : 600_000;
}

export async function ffmpegAvailable() {
  try {
    await execFileAsync(ffmpegPath(), ["-version"], { timeout: 5000, maxBuffer: 256 * 1024, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

export async function projectAssemblyAvailable() {
  const [ffmpeg, ffprobe] = await Promise.all([ffmpegAvailable(), ffprobeAvailable()]);
  return { available: ffmpeg && ffprobe, ffmpeg, ffprobe };
}

export function listProjectAssemblies(projectId: string): ProjectAssemblyRecord[] {
  const rows = db.prepare("SELECT * FROM project_assemblies WHERE project_id=? ORDER BY created_at DESC LIMIT 20").all(projectId) as any[];
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    settings: parseJson(row.settings_json, {}),
    sources: parseJson(row.sources_json, []),
    createdAt: row.created_at,
  }));
}

export async function assembleProject(projectId: string) {
  const project = listProjects().find(item => item.id === projectId);
  if (!project) throw new Error("项目不存在");
  if (!project.shots.length) throw new Error("项目还没有镜头");
  if (project.shots.length > 60) throw new Error("单次成片最多支持 60 个镜头，请拆分项目后再装配");
  const tools = await projectAssemblyAvailable();
  if (!tools.ffmpeg) throw new Error("服务器未检测到 ffmpeg。请安装 FFmpeg 或通过 FFMPEG_PATH 指定可执行文件后再生成成片。");
  if (!tools.ffprobe) throw new Error("服务器未检测到 ffprobe。请安装 FFmpeg/ffprobe 或通过 FFPROBE_PATH 指定可执行文件后再生成成片。");

  const sources = [] as Array<{
    shotId: string;
    shotName: string;
    jobId: string;
    jobTitle: string;
    archivedFile: string;
    filePath: string;
    probe: MediaProbe;
  }>;

  for (const shot of project.shots) {
    if (!shot.selectedJobId) throw new Error(`镜头“${shot.name}”还没有采用版本`);
    const job = getJob(shot.selectedJobId);
    const output = job ? firstVideoOutput(job.outputs) : null;
    if (!job || !output) throw new Error(`镜头“${shot.name}”的采用任务没有可用视频`);
    if (!output.archivedFile) throw new Error(`镜头“${shot.name}”的采用视频还没有保存到本机。请先在任务中心点击保存，再生成成片。`);
    const filePath = archivedFilePath(output.archivedFile);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw new Error(`镜头“${shot.name}”的本机归档文件不存在，请重新保存该结果`);
    const probe = await probeResultMedia(output);
    if (!probe.duration || probe.duration <= 0) throw new Error(`镜头“${shot.name}”无法确定视频时长`);
    sources.push({ shotId: shot.id, shotName: shot.name, jobId: job.id, jobTitle: job.title, archivedFile: output.archivedFile, filePath, probe });
  }

  const sourceDuration = sources.reduce((sum, source) => sum + (source.probe.duration || 0), 0);
  if (sourceDuration > 900) throw new Error("单次成片定稿总时长不能超过 15 分钟");

  const target = targetProfile(sources[0].probe);
  const assemblyId = randomUUID();
  const outputFile = `project-${project.id}-${assemblyId}.mp4`;
  const finalPath = archivedFilePath(outputFile);
  const tempRoot = path.join(outputDirectory(), `.assembly-${assemblyId}`);
  await fsp.mkdir(tempRoot, { recursive: true });

  const normalizedFiles: string[] = [];
  try {
    for (let index = 0; index < sources.length; index += 1) {
      const normalized = path.join(tempRoot, `shot-${String(index + 1).padStart(3, "0")}.mp4`);
      await normalizeClip(sources[index], normalized, target);
      normalizedFiles.push(normalized);
    }

    const timelinePath = path.join(tempRoot, "timeline.mp4");
    const audioMasterPath = path.join(tempRoot, "audio-master.mp4");
    const transitionSnapshot = await renderProjectTimeline({
      projectId: project.id,
      files: normalizedFiles,
      durations: sources.map(source => Number(source.probe.duration || 0)),
      outputPath: timelinePath,
      tempRoot,
    });
    const expectedDuration = transitionSnapshot.timelineDuration;

    const timelineStat = await fsp.stat(timelinePath);
    if (!timelineStat.isFile() || timelineStat.size <= 0) throw new Error("FFmpeg 没有生成有效的时间线文件");

    const audioSnapshot = await renderProjectAudio({
      projectId: project.id,
      timelinePath,
      finalPath: audioMasterPath,
      tempRoot,
      duration: expectedDuration,
    });
    const audioStat = await fsp.stat(audioMasterPath);
    if (!audioStat.isFile() || audioStat.size <= 0) throw new Error("FFmpeg 没有生成有效的音频母版文件");

    const subtitleSnapshot = await renderProjectSubtitles({
      projectId: project.id,
      inputPath: audioMasterPath,
      outputPath: finalPath,
      tempRoot,
      duration: expectedDuration,
    });

    const stat = await fsp.stat(finalPath);
    if (!stat.isFile() || stat.size <= 0) throw new Error("FFmpeg 没有生成有效的成片文件");
    const finalProbe = await probeResultMedia({ archivedFile: outputFile, kind: "video" });

    const now = new Date().toISOString();
    const settings = {
      width: target.width,
      height: target.height,
      fps: target.fps,
      videoCodec: "h264/libx264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioSampleRate: 48000,
      audioChannels: 2,
      sourceDuration,
      expectedDuration,
      finalDuration: finalProbe.duration,
      shotCount: sources.length,
      scaleMode: "fit-with-black-padding",
      transition: transitionSnapshot,
      audioMix: {
        targetLufs: audioSnapshot.targetLufs,
        originalGainDb: audioSnapshot.originalGainDb,
        bgmGainDb: audioSnapshot.bgmGainDb,
        bgm: audioSnapshot.bgm ? { id: audioSnapshot.bgm.id, name: audioSnapshot.bgm.name } : null,
      },
      subtitleTrack: subtitleSnapshot,
      finalProbe,
    };
    const sourceSnapshot = sources.map((source, index) => ({
      index: index + 1,
      shotId: source.shotId,
      shotName: source.shotName,
      jobId: source.jobId,
      jobTitle: source.jobTitle,
      archivedFile: source.archivedFile,
      original: source.probe,
    }));
    db.prepare("INSERT INTO project_assemblies (id,project_id,file_name,settings_json,sources_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(assemblyId, project.id, outputFile, JSON.stringify(settings), JSON.stringify(sourceSnapshot), now);

    return {
      assembly: { id: assemblyId, projectId: project.id, fileName: outputFile, settings, sources: sourceSnapshot, createdAt: now },
      url: `/api/archive/${encodeURIComponent(outputFile)}`,
    };
  } catch (error) {
    try { await fsp.unlink(finalPath); } catch {}
    throw error;
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function deleteProjectAssembly(projectId: string, assemblyId: string) {
  const row = db.prepare("SELECT file_name FROM project_assemblies WHERE id=? AND project_id=?").get(assemblyId, projectId) as any;
  if (!row) return false;
  try { await fsp.unlink(archivedFilePath(String(row.file_name))); } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  return db.prepare("DELETE FROM project_assemblies WHERE id=? AND project_id=?").run(assemblyId, projectId).changes > 0;
}

async function normalizeClip(source: { filePath: string; probe: MediaProbe }, outputPath: string, target: { width: number; height: number; fps: number }) {
  const videoFilter = `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${formatFps(target.fps)},format=yuv420p`;
  const duration = Math.max(0.1, Number(source.probe.duration || 0));
  const common = [
    "-map", "0:v:0",
    "-vf", videoFilter,
    "-c:v", "libx264",
    "-preset", String(process.env.WANKE_FFMPEG_PRESET || "medium"),
    "-crf", String(normalizedCrf()),
    "-pix_fmt", "yuv420p",
  ];

  if (source.probe.hasAudio) {
    await runFfmpeg([
      "-y", "-i", source.filePath,
      ...common,
      "-map", "0:a:0",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",
      "-af", "aresample=async=1:first_pts=0,apad",
      "-t", formatDuration(duration),
      "-avoid_negative_ts", "make_zero",
      "-movflags", "+faststart",
      outputPath,
    ]);
    return;
  }

  await runFfmpeg([
    "-y", "-i", source.filePath,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    ...common,
    "-map", "1:a:0",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-ac", "2",
    "-t", formatDuration(duration),
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

async function runFfmpeg(args: string[]) {
  try {
    await execFileAsync(ffmpegPath(), args, { timeout: ffmpegTimeout(), maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const tail = stderr ? stderr.split("\n").slice(-8).join("\n") : "";
    throw new Error(tail ? `FFmpeg 成片处理失败：${tail}` : "FFmpeg 成片处理失败，请检查本机视频和 FFmpeg 配置");
  }
}

function targetProfile(first: MediaProbe) {
  const width = evenDimension(first.width);
  const height = evenDimension(first.height);
  if (!width || !height) throw new Error("第一个定稿镜头没有有效画面尺寸");
  const rawFps = first.frameRate && first.frameRate >= 1 && first.frameRate <= 120 ? first.frameRate : 30;
  const fps = Math.max(1, Math.min(60, rawFps));
  return { width, height, fps };
}

function evenDimension(value: number) {
  if (!Number.isFinite(value) || value < 2) return 0;
  return Math.max(2, Math.floor(value / 2) * 2);
}

function normalizedCrf() {
  const value = Number(process.env.WANKE_FFMPEG_CRF || 20);
  return Number.isFinite(value) ? Math.min(35, Math.max(14, Math.round(value))) : 20;
}

function formatFps(value: number) {
  return Number(value.toFixed(3)).toString();
}

function formatDuration(value: number) {
  return Math.max(0.1, value).toFixed(3);
}

function firstVideoOutput(outputs: ResultMedia[]) {
  return outputs.find(output => output.kind === "video") || outputs.find(output => /\.(mp4|mov|webm)(\?|$)/i.test(String(output.outputUrl || ""))) || null;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
