import "server-only";
import type { JobStatus, StoredJob } from "@/lib/types";

type VideoInput = {
  prompt: string;
  jobType: "text_to_video" | "image_to_video" | "first_last_frame" | "reference_to_video";
  medias: { type: "image" | "video" | "audio"; url?: string; mediaId?: string }[];
  aspectRatio: string;
  duration: number;
  resolution: "720P" | "1080P";
};

type RouteDecision = {
  model: string;
  route: "happyhorse-t2v" | "happyhorse-i2v" | "happyhorse-r2v" | "wan-i2v" | "wan-r2v";
  reason: string;
};

function apiKey() {
  return process.env.DASHSCOPE_API_KEY?.trim() || process.env.ALIYUN_MODELSTUDIO_API_KEY?.trim() || "";
}

function rootUrl() {
  const explicit = process.env.ALIYUN_MODELSTUDIO_BASE_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit.endsWith("/api/v1") ? explicit.slice(0, -7) : explicit;
  const workspaceId = process.env.ALIYUN_MODELSTUDIO_WORKSPACE_ID?.trim();
  if (workspaceId) return `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com`;
  return "https://dashscope-intl.aliyuncs.com";
}

function apiBase() {
  return `${rootUrl()}/api/v1`;
}

export function modelStudioConfigSummary() {
  const configured = Boolean(apiKey());
  const workspaceId = process.env.ALIYUN_MODELSTUDIO_WORKSPACE_ID?.trim() || "";
  return {
    configured,
    provider: "modelstudio",
    regionId: "ap-southeast-1",
    regionName: "新加坡",
    endpoint: rootUrl(),
    workspaceDedicatedDomain: Boolean(workspaceId || process.env.ALIYUN_MODELSTUDIO_BASE_URL),
  };
}

export function canUseModelStudio(input: VideoInput) {
  if (!apiKey()) return false;
  if (!input.medias.every(media => Boolean(media.url))) return false;
  if (input.jobType === "reference_to_video" && input.medias.some(media => media.type === "audio")) return false;
  return true;
}

function chooseRoute(input: VideoInput): RouteDecision {
  if (input.jobType === "text_to_video") {
    return { model: "happyhorse-1.1-t2v", route: "happyhorse-t2v", reason: "文生视频默认使用 HappyHorse 1.1，优先画面质量与自然运动" };
  }
  if (input.jobType === "image_to_video") {
    return { model: "happyhorse-1.1-i2v", route: "happyhorse-i2v", reason: "单图生视频默认使用 HappyHorse 1.1，优先画面质量与自然运动" };
  }
  if (input.jobType === "first_last_frame") {
    return { model: "wan2.7-i2v-2026-04-25", route: "wan-i2v", reason: "首尾帧由 Wan 2.7 原生支持" };
  }
  if (input.medias.every(media => media.type === "image")) {
    return { model: "happyhorse-1.1-r2v", route: "happyhorse-r2v", reason: "纯图片多参考优先 HappyHorse 1.1，强化人物与产品一致性" };
  }
  return { model: "wan2.7-r2v-2026-06-12", route: "wan-r2v", reason: "存在视频参考，自动使用 Wan 2.7 多模态参考能力" };
}

function requireUrl(media: VideoInput["medias"][number], index: number) {
  const url = media.url?.trim();
  if (!url) throw new Error(`第 ${index + 1} 个参考素材没有可访问 URL，请从素材库重新选择或使用公网 URL`);
  return url;
}

function buildPayload(input: VideoInput, decision: RouteDecision) {
  const parameters: Record<string, unknown> = {
    resolution: input.resolution,
    duration: input.duration,
    watermark: false,
  };

  if (decision.route === "happyhorse-t2v") {
    parameters.ratio = input.aspectRatio;
    return { model: decision.model, input: { prompt: input.prompt }, parameters };
  }

  if (decision.route === "happyhorse-i2v") {
    return {
      model: decision.model,
      input: { prompt: input.prompt, media: [{ type: "first_frame", url: requireUrl(input.medias[0], 0) }] },
      parameters,
    };
  }

  if (decision.route === "wan-i2v") {
    return {
      model: decision.model,
      input: {
        prompt: input.prompt,
        media: [
          { type: "first_frame", url: requireUrl(input.medias[0], 0) },
          { type: "last_frame", url: requireUrl(input.medias[1], 1) },
        ],
      },
      parameters: { ...parameters, prompt_extend: true },
    };
  }

  if (decision.route === "happyhorse-r2v") {
    parameters.ratio = input.aspectRatio;
    return {
      model: decision.model,
      input: {
        prompt: input.prompt,
        media: input.medias.map((media, index) => ({ type: "reference_image", url: requireUrl(media, index) })),
      },
      parameters,
    };
  }

  parameters.ratio = input.aspectRatio;
  return {
    model: decision.model,
    input: {
      prompt: input.prompt,
      media: input.medias.map((media, index) => ({
        type: media.type === "video" ? "reference_video" : "reference_image",
        url: requireUrl(media, index),
      })),
    },
    parameters: { ...parameters, prompt_extend: true },
  };
}

async function requestJson(url: string, init: RequestInit) {
  const key = apiKey();
  if (!key) throw new Error("未配置百炼 Model Studio API Key：请设置 DASHSCOPE_API_KEY");
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.method === "POST" ? { "X-DashScope-Async": "enable" } : {}),
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.code) {
    throw new Error(`百炼视频接口失败：${body?.message || body?.code || `HTTP ${response.status}`}`);
  }
  return body;
}

export async function submitModelStudioVideo(input: VideoInput) {
  const decision = chooseRoute(input);
  const payload = buildPayload(input, decision);
  const body = await requestJson(`${apiBase()}/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const taskId = body?.output?.task_id;
  if (!taskId) throw new Error(`百炼未返回 task_id：${JSON.stringify(body).slice(0, 500)}`);
  return {
    providerJobId: String(taskId),
    requestId: body?.request_id || null,
    provider: body,
    initialStatus: "queued" as JobStatus,
    details: {
      pollable: true,
      engine: "modelstudio",
      model: decision.model,
      route: decision.route,
      routeReason: decision.reason,
      endpoint: rootUrl(),
    },
  };
}

function normalizeStatus(value: string | undefined): JobStatus {
  if (value === "PENDING") return "queued";
  if (value === "RUNNING") return "running";
  if (value === "SUCCEEDED") return "succeeded";
  if (value === "FAILED" || value === "CANCELED") return "failed";
  return "unknown";
}

export async function refreshModelStudioVideo(job: StoredJob) {
  if (!job.providerJobId) throw new Error("任务没有百炼 task_id");
  const body = await requestJson(`${apiBase()}/tasks/${encodeURIComponent(job.providerJobId)}`, { method: "GET" });
  const output = body?.output || {};
  const status = normalizeStatus(output.task_status);
  const videoUrl = output.video_url;
  return {
    status,
    provider: body,
    requestId: body?.request_id || job.requestId,
    error: status === "failed" ? (output.message || output.code || "视频生成失败") : null,
    outputs: videoUrl ? [{ outputUrl: videoUrl, kind: "video" as const, label: String(job.details?.model || "AI 视频") }] : job.outputs,
    details: { ...(job.details || {}), usage: body?.usage || null, taskStatus: output.task_status || null },
  };
}
