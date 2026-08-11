export const JOB_KINDS = [
  "video_generation",
  "video_extension",
  "video_editing",
  "video_analysis",
  "remake_script",
  "video_render",
  "video_translation",
  "video_clone",
  "avatar_narrator",
  "voice_narrator",
  "storyboard",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

export interface ResultMedia {
  mediaId?: string;
  outputUrl?: string;
  outputLanguage?: string;
  editingProjectId?: string;
  label?: string;
  archivedFile?: string;
  archivedAt?: string;
  kind?: "video" | "audio" | "subtitle" | "json" | "other";
}

export interface StoredJob {
  id: string;
  kind: JobKind;
  title: string;
  providerJobId: string | null;
  status: JobStatus;
  request: Record<string, unknown>;
  provider: Record<string, unknown> | null;
  outputs: ResultMedia[];
  details: Record<string, unknown> | null;
  error: string | null;
  requestId: string | null;
  parentJobId: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StoredAsset {
  id: string;
  providerMediaId: string | null;
  name: string;
  mediaType: string;
  sourceUrl: string;
  provider: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  video_generation: "AI 视频生成",
  video_extension: "视频延长",
  video_editing: "视频编辑",
  video_analysis: "视频拆解",
  remake_script: "复刻脚本",
  video_render: "创意渲染",
  video_translation: "视频翻译",
  video_clone: "快速复刻",
  avatar_narrator: "数字人口播",
  voice_narrator: "旁白成片",
  storyboard: "故事板成片",
};

export function isPollableJob(kind: JobKind) {
  return kind !== "video_translation";
}
