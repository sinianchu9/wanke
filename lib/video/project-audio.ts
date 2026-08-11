import "server-only";
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { getAsset } from "@/lib/repository";

const execFileAsync = promisify(execFile);

export type ProjectAudioSettings = {
  projectId: string;
  bgmAssetId: string | null;
  targetLufs: number;
  originalGainDb: number;
  bgmGainDb: number;
  updatedAt: string | null;
};

export type ProjectAudioSnapshot = ProjectAudioSettings & {
  bgm?: { id: string; name: string; sourceUrl: string } | null;
};

export function getProjectAudioSettings(projectId: string): ProjectAudioSettings {
  const row = db.prepare("SELECT * FROM project_audio_settings WHERE project_id=?").get(projectId) as any;
  return {
    projectId,
    bgmAssetId: row?.bgm_asset_id || null,
    targetLufs: finiteOr(row?.target_lufs, -16),
    originalGainDb: finiteOr(row?.original_gain_db, 0),
    bgmGainDb: finiteOr(row?.bgm_gain_db, -12),
    updatedAt: row?.updated_at || null,
  };
}

export function setProjectAudioSettings(input: {
  projectId: string;
  bgmAssetId?: string | null;
  targetLufs: number;
  originalGainDb: number;
  bgmGainDb: number;
}) {
  if (!db.prepare("SELECT 1 FROM projects WHERE id=?").get(input.projectId)) throw new Error("项目不存在");
  if (input.bgmAssetId) {
    const asset = getAsset(input.bgmAssetId);
    if (!asset) throw new Error("BGM 素材不存在");
    if (asset.mediaType !== "audio") throw new Error("BGM 只能选择音频素材");
  }
  const targetLufs = clamp(input.targetLufs, -24, -9);
  const originalGainDb = clamp(input.originalGainDb, -12, 6);
  const bgmGainDb = clamp(input.bgmGainDb, -30, 0);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO project_audio_settings
    (project_id,bgm_asset_id,target_lufs,original_gain_db,bgm_gain_db,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET
      bgm_asset_id=excluded.bgm_asset_id,
      target_lufs=excluded.target_lufs,
      original_gain_db=excluded.original_gain_db,
      bgm_gain_db=excluded.bgm_gain_db,
      updated_at=excluded.updated_at`)
    .run(input.projectId, input.bgmAssetId || null, targetLufs, originalGainDb, bgmGainDb, now);
  db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(now, input.projectId);
  return getProjectAudioSettings(input.projectId);
}

export function projectAudioSnapshot(projectId: string): ProjectAudioSnapshot {
  const settings = getProjectAudioSettings(projectId);
  const asset = settings.bgmAssetId ? getAsset(settings.bgmAssetId) : null;
  return {
    ...settings,
    bgm: asset ? { id: asset.id, name: asset.name, sourceUrl: asset.sourceUrl } : null,
  };
}

export async function renderProjectAudio(input: {
  projectId: string;
  timelinePath: string;
  finalPath: string;
  tempRoot: string;
  duration: number;
}) {
  const snapshot = projectAudioSnapshot(input.projectId);
  const duration = Math.max(0.1, input.duration);
  const targetLufs = snapshot.targetLufs;
  const originalGain = `${formatDb(snapshot.originalGainDb)}dB`;

  if (!snapshot.bgm) {
    await runFfmpeg([
      "-y", "-i", input.timelinePath,
      "-map", "0:v:0", "-map", "0:a:0",
      "-c:v", "copy",
      "-af", `volume=${originalGain},loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`,
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-t", formatDuration(duration),
      "-movflags", "+faststart",
      input.finalPath,
    ]);
    return snapshot;
  }

  const bgmPath = path.join(input.tempRoot, "project-bgm");
  await downloadAudio(snapshot.bgm.sourceUrl, bgmPath);
  const fadeOutStart = Math.max(0, duration - 1);
  const bgmGain = `${formatDb(snapshot.bgmGainDb)}dB`;
  const filter = [
    `[0:a]volume=${originalGain},loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[program]`,
    `[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,volume=${bgmGain},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=1[bgm]`,
    `[program][bgm]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95,loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[mix]`,
  ].join(";");

  await runFfmpeg([
    "-y", "-i", input.timelinePath,
    "-stream_loop", "-1", "-i", bgmPath,
    "-filter_complex", filter,
    "-map", "0:v:0", "-map", "[mix]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-t", formatDuration(duration),
    "-movflags", "+faststart",
    input.finalPath,
  ]);
  return snapshot;
}

async function downloadAudio(sourceUrl: string, destination: string) {
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error("BGM 素材地址无效"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("BGM 素材只支持 HTTP/HTTPS 地址");

  const timeoutMs = boundedNumber(process.env.WANKE_BGM_DOWNLOAD_TIMEOUT_MS, 300_000, 30_000, 900_000);
  const maxBytes = boundedNumber(process.env.WANKE_MAX_BGM_MB, 250, 10, 1024) * 1024 * 1024;
  const response = await fetch(sourceUrl, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) throw new Error(`下载 BGM 失败：HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`BGM 超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`);

  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error(`BGM 超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`));
      else callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as any), limiter, fs.createWriteStream(destination, { flags: "wx" }));
  const stat = await fsp.stat(destination);
  if (!stat.isFile() || stat.size <= 0) throw new Error("BGM 下载结果为空");
}

function ffmpegPath() {
  return String(process.env.FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
}

function ffmpegTimeout() {
  return boundedNumber(process.env.WANKE_FFMPEG_TIMEOUT_MS, 600_000, 30_000, 3_600_000);
}

async function runFfmpeg(args: string[]) {
  try {
    await execFileAsync(ffmpegPath(), args, { timeout: ffmpegTimeout(), maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
  } catch (error: any) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const tail = stderr ? stderr.split("\n").slice(-8).join("\n") : "";
    throw new Error(tail ? `FFmpeg 音频处理失败：${tail}` : "FFmpeg 音频处理失败");
  }
}

function boundedNumber(raw: unknown, fallback: number, min: number, max: number) {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) throw new Error("音频参数必须是有效数字");
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatDb(value: number) {
  return Number(value.toFixed(2)).toString();
}

function formatDuration(value: number) {
  return Math.max(0.1, value).toFixed(3);
}
