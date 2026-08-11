import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { archivedFilePath } from "@/lib/archive";
import type { ResultMedia } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type MediaProbe = {
  source: "archive" | "remote";
  duration: number | null;
  formatName: string;
  videoCodec: string;
  width: number;
  height: number;
  pixelFormat: string;
  frameRate: number | null;
  frameRateRaw: string;
  hasAudio: boolean;
  audioCodec: string;
  audioSampleRate: number | null;
  audioChannels: number | null;
};

function ffprobePath() {
  return String(process.env.FFPROBE_PATH || "ffprobe").trim() || "ffprobe";
}

export async function ffprobeAvailable() {
  try {
    await execFileAsync(ffprobePath(), ["-version"], { timeout: 5000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

export async function probeResultMedia(output: ResultMedia): Promise<MediaProbe> {
  const target = resolveProbeTarget(output);
  const { stdout } = await execFileAsync(ffprobePath(), [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    target.value,
  ], {
    timeout: Math.max(5000, Number(process.env.WANKE_FFPROBE_TIMEOUT_MS || 45_000)),
    maxBuffer: 2 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout || "{}") as any;
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream: any) => stream.codec_type === "video");
  if (!video) throw new Error("没有检测到视频流");
  const audio = streams.find((stream: any) => stream.codec_type === "audio");
  const frameRateRaw = String(video.avg_frame_rate || video.r_frame_rate || "");
  const duration = finiteNumber(video.duration) ?? finiteNumber(parsed?.format?.duration);

  return {
    source: target.source,
    duration,
    formatName: String(parsed?.format?.format_name || ""),
    videoCodec: String(video.codec_name || ""),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    pixelFormat: String(video.pix_fmt || ""),
    frameRate: parseRate(frameRateRaw),
    frameRateRaw,
    hasAudio: Boolean(audio),
    audioCodec: String(audio?.codec_name || ""),
    audioSampleRate: finiteNumber(audio?.sample_rate),
    audioChannels: finiteNumber(audio?.channels),
  };
}

export function mediaProfileKey(probe: MediaProbe) {
  return [
    probe.videoCodec,
    `${probe.width}x${probe.height}`,
    probe.pixelFormat,
    normalizeRate(probe.frameRate),
    probe.hasAudio ? `audio:${probe.audioCodec}:${probe.audioSampleRate || 0}:${probe.audioChannels || 0}` : "audio:none",
  ].join("|");
}

function resolveProbeTarget(output: ResultMedia) {
  if (output.archivedFile) return { source: "archive" as const, value: archivedFilePath(output.archivedFile) };
  const url = String(output.outputUrl || "").trim();
  if (!url) throw new Error("定稿结果没有可探测的视频地址");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("定稿视频地址无效"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("远端视频探测只接受 HTTP/HTTPS 地址");
  return { source: "remote" as const, value: url };
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRate(value: string) {
  if (!value) return null;
  const [a, b] = value.split("/").map(Number);
  if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRate(value: number | null) {
  return value === null ? "unknown" : value.toFixed(3);
}
