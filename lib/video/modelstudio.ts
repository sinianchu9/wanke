import "server-only";
import type { JobStatus, StoredJob } from "@/lib/types";
import type { VideoExtensionInput } from "@/lib/video/extension";
import type { VideoEditingInput } from "@/lib/video/editing";
import { getModelStudioRuntimeConfig } from "@/lib/settings";

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
  return getModelStudioRuntimeConfig().apiKey;
}

function rootUrl() {
  const config = getModelStudioRuntimeConfig();
  const explicit = config.baseUrl.trim().replace(/\/+$/, "");
  if (explicit) return explicit.endsWith("/api/v1") ? explicit.slice(0, -7) : explicit;
  if (config.workspaceId) return `https://${config.workspaceId}.ap-southeast-1.maas.aliyuncs.com`;
  return "https://dashscope-intl.aliyuncs.com";
}

function apiBase() {
  return `${rootUrl()}/api/v1`;
}

export function modelStudioConfigSummary() {
  const config = getModelStudioRuntimeConfig();
  return {
    configured: Boolean(config.apiKey),
    provider: "modelstudio",
    regionId: "ap-southeast-1",
    regionName: "新加坡",
    endpoint: rootUrl(),
    workspaceDedicatedDomain: Boolean(config.workspaceId || config.baseUrl),
    configSource: config.sources,
  };
}

export function canUseModelStudio(input: VideoInput) {
  if (!apiKey()) return false;
  if (!input.medias.every(media => Boolean(media.url))) return false;
  if (input.jobType === "reference_to_video" && input.medias.some(media => media.type === "audio")) return false;
  return true;
}

function chooseRoute(input: VideoInput): RouteDecision {
  if (input.jobType === "text_to_video") return { model: "happyhorse-1.1-t2v", route: "happyhorse-t2v", reason: "文生视频默认使用 HappyHorse 1.1，优先画面质量与自然运动" };
  if (input.jobType === "image_to_video") return { model: "happyhorse-1.1-i2v", route: "happyhorse-i2v", reason: "单图生视频默认使用 HappyHorse 1.1，优先画面质量与自然运动" };
  if (input.jobType === "first_last_frame") return { model: "wan2.7-i2v-2026-04-25", route: "wan-i2v", reason: "首尾帧由 Wan 2.7 原生支持" };
  if (input.medias.every(media => media.type === "image")) return { model: "happyhorse-1.1-r2v", route: "happyhorse-r2v", reason: "纯图片多参考优先 HappyHorse 1.1，强化人物与产品一致性" };
  return { model: "wan2.7-r2v-2026-06-12", route: "wan-r2v", reason: "存在视频参考，自动使用 Wan 2.7 多模态参考能力" };
}

function requireUrl(media: VideoInput["medias"][number], index: number) {
  const url = media.url?.trim();
  if (!url) throw new Error(`第 ${index + 1} 个参考素材没有可访问 URL，请从素材库重新选择或使用公网 URL`);
  return url;
}

function effectiveDuration(input: VideoInput, decision: RouteDecision) {
  const hasVideoReference = input.medias.some(media => media.type === "video");
  if (decision.route === "wan-r2v" && hasVideoReference) return Math.min(input.duration, 10);
  return input.duration;
}

function routedPrompt(input: VideoInput, decision: RouteDecision) {
  const prompt = input.prompt.trim();
  if (decision.route === "happyhorse-r2v") {
    const refs = input.medias.map((_, index) => `[Image ${index + 1}]`).join("、");
    return `参考素材为 ${refs}。请分别识别并保留各参考图中最显著的人物、产品、服装、道具或场景特征；人物身份与脸部特征不要互相混合，产品结构、颜色和标志不要无故改变。用户要求：${prompt}`;
  }
  if (decision.route === "wan-r2v") {
    let imageIndex = 0;
    let videoIndex = 0;
    const refs = input.medias.map(media => media.type === "video" ? `Video ${++videoIndex}` : `Image ${++imageIndex}`).join("、");
    return `参考素材为 ${refs}。请保持各参考主体的身份、外观、服装、产品结构和关键视觉特征一致，不要把不同参考主体的特征互相混合。用户要求：${prompt}`;
  }
  return prompt;
}

function buildPayload(input: VideoInput, decision: RouteDecision) {
  const duration = effectiveDuration(input, decision);
  const prompt = routedPrompt(input, decision);
  const parameters: Record<string, unknown> = { resolution: input.resolution, duration, watermark: false };

  if (decision.route === "happyhorse-t2v") {
    parameters.ratio = input.aspectRatio;
    return { model: decision.model, input: { prompt }, parameters };
  }
  if (decision.route === "happyhorse-i2v") {
    return { model: decision.model, input: { prompt, media: [{ type: "first_frame", url: requireUrl(input.medias[0], 0) }] }, parameters };
  }
  if (decision.route === "wan-i2v") {
    return {
      model: decision.model,
      input: { prompt, media: [{ type: "first_frame", url: requireUrl(input.medias[0], 0) }, { type: "last_frame", url: requireUrl(input.medias[1], 1) }] },
      parameters: { ...parameters, prompt_extend: true },
    };
  }
  if (decision.route === "happyhorse-r2v") {
    parameters.ratio = input.aspectRatio;
    return { model: decision.model, input: { prompt, media: input.medias.map((media, index) => ({ type: "reference_image", url: requireUrl(media, index) })) }, parameters };
  }

  parameters.ratio = input.aspectRatio;
  return {
    model: decision.model,
    input: { prompt, media: input.medias.map((media, index) => ({ type: media.type === "video" ? "reference_video" : "reference_image", url: requireUrl(media, index) })) },
    parameters: { ...parameters, prompt_extend: false },
  };
}

function diagnosticSuffix(code: string, status?: number, requestIdValue?: unknown) {
  const requestId = String(requestIdValue || "").trim();
  const parts: string[] = [];
  if (code) parts.push(`Code: ${code}`);
  if (status) parts.push(`HTTP: ${status}`);
  if (requestId) parts.push(`RequestId: ${requestId}`);
  return parts.length ? `（${parts.join("；")}）` : "";
}

function friendlyProviderMessage(codeValue: unknown, messageValue: unknown, status?: number, requestIdValue?: unknown) {
  const code = String(codeValue || "").trim();
  const normalizedCode = code.toLowerCase();
  const message = String(messageValue || "").trim();
  const haystack = `${code} ${message}`.toLowerCase();
  const suffix = diagnosticSuffix(code, status, requestIdValue);
  const withDiagnostics = (text: string) => `${text}${suffix}`;

  if (status === 401 || haystack.includes("invalidapikey") || haystack.includes("invalid api key")) {
    return withDiagnostics("百炼 API Key 无效，或 Key 与当前 Endpoint 不属于同一地域。请到设置检查 API Key、Workspace 和 Base URL。");
  }
  if (normalizedCode === "model.accessdenied") {
    return withDiagnostics("百炼明确拒绝了当前模型调用。默认业务空间通常不受子空间模型授权限制；请重点检查该模型在当前地域/账号是否可用，以及 Key 与 Endpoint 是否属于同一地域。");
  }
  if (normalizedCode === "workspace.accessdenied") {
    return withDiagnostics("当前 API Key 无权访问这个 Workspace。请确认 Key 与 Workspace ID 属于同一业务空间，并检查 Base URL 是否指向该 Workspace。");
  }
  if (normalizedCode === "endpoint.accessdenied") {
    return withDiagnostics("当前 Workspace Endpoint 拒绝了这个模型。请检查模型是否已下线/迁移，以及 Base URL 与模型地域是否匹配。");
  }
  if (normalizedCode === "accessdenied.unpurchased") {
    return withDiagnostics("当前账号尚未具备该百炼模型服务的付费调用资格。请检查百炼服务是否已正式开通、账号类型以及 Pay-As-You-Go 状态。");
  }
  if (normalizedCode === "allocationquota.freetieronly") {
    return withDiagnostics("当前模型的免费额度已用尽，并且账号启用了“仅使用免费额度/额度耗尽即停”。请在百炼控制台关闭该限制或确认 Pay-As-You-Go 已可用。");
  }
  if (normalizedCode === "arrearage" || haystack.includes("arrear") || haystack.includes("balance")) {
    return withDiagnostics("百炼账号余额或账务状态异常，当前请求被拒绝。请检查账户余额、欠费和付费状态。");
  }
  if (status === 403 || haystack.includes("accessdenied") || haystack.includes("permission")) {
    return withDiagnostics(`百炼拒绝了本次调用。请根据上面的 Code 判断是模型、Workspace、Endpoint 还是账号资格问题。${message ? ` 原始信息：${message}` : ""}`);
  }
  if (status === 429 || haystack.includes("thrott") || haystack.includes("rate limit")) {
    return withDiagnostics("百炼当前请求过多，任务没有重复提交。请稍后直接重试这条任务。");
  }
  if (haystack.includes("quota")) {
    return withDiagnostics("百炼额度不足或当前额度策略阻止了调用，请检查模型额度和付费设置。");
  }
  if (haystack.includes("url") && (haystack.includes("invalid") || haystack.includes("download") || haystack.includes("access"))) {
    return withDiagnostics(`参考素材无法被百炼访问。请确认是公网直链，或重新从素材库选择。${message ? ` 原因：${message}` : ""}`);
  }
  if (haystack.includes("invalidparameter") || haystack.includes("invalid parameter")) {
    return withDiagnostics(`素材或画面参数不符合当前模型要求。${message ? ` 原因：${message}` : ""}`);
  }
  return withDiagnostics(message ? `百炼视频生成失败：${message}` : `百炼视频接口失败${status ? `（HTTP ${status}）` : ""}`);
}

async function requestJson(url: string, init: RequestInit) {
  const key = apiKey();
  if (!key) throw new Error("未配置百炼 Model Studio API Key：请到设置中填写百炼 API Key");
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
    throw new Error(friendlyProviderMessage(body?.code, body?.message, response.status, body?.request_id));
  }
  return body;
}

export async function submitModelStudioVideo(input: VideoInput) {
  const decision = chooseRoute(input);
  const duration = effectiveDuration(input, decision);
  const payload = buildPayload(input, decision);
  const body = await requestJson(`${apiBase()}/services/aigc/video-generation/video-synthesis`, { method: "POST", body: JSON.stringify(payload) });
  const taskId = body?.output?.task_id;
  if (!taskId) throw new Error(`百炼没有返回任务编号，请勿重复点击生成。RequestId：${body?.request_id || "未知"}`);
  return {
    providerJobId: String(taskId), requestId: body?.request_id || null, provider: body, initialStatus: "queued" as JobStatus,
    details: { pollable: true, engine: "modelstudio", model: decision.model, route: decision.route, routeReason: decision.reason, requestedDuration: input.duration, effectiveDuration: duration, endpoint: rootUrl() },
  };
}

export async function submitModelStudioVideoExtension(input: VideoExtensionInput) {
  const model = "wan2.7-i2v-2026-04-25";
  const body = await requestJson(`${apiBase()}/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    body: JSON.stringify({
      model,
      input: { prompt: input.prompt, media: [{ type: "first_clip", url: input.sourceUrl }] },
      parameters: { resolution: input.resolution, duration: input.targetDuration, prompt_extend: true, watermark: false },
    }),
  });
  const taskId = body?.output?.task_id;
  if (!taskId) throw new Error(`百炼视频延长没有返回任务编号，请勿重复提交。RequestId：${body?.request_id || "未知"}`);
  return {
    providerJobId: String(taskId), requestId: body?.request_id || null, provider: body, initialStatus: "queued" as JobStatus,
    details: {
      pollable: true, engine: "modelstudio", model, route: "wan-video-extension",
      routeReason: "视频延长使用 Wan 2.7 原生 first_clip continuation，不使用 reference-to-video 代替",
      creationAction: "video_extension", sourceJobId: input.sourceJobId, sourceOutputIndex: input.sourceOutputIndex,
      sourceDuration: input.sourceDuration, targetDuration: input.targetDuration, endpoint: rootUrl(),
    },
  };
}

export async function submitModelStudioVideoEditing(input: VideoEditingInput) {
  const model = "wan2.7-videoedit";
  const media = [
    { type: "video", url: input.sourceUrl },
    ...input.referenceImages.map(url => ({ type: "reference_image", url })),
  ];
  const body = await requestJson(`${apiBase()}/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    body: JSON.stringify({
      model,
      input: { prompt: input.prompt, media },
      parameters: {
        resolution: input.resolution,
        prompt_extend: true,
        watermark: false,
        audio_setting: input.audioSetting,
      },
    }),
  });
  const taskId = body?.output?.task_id;
  if (!taskId) throw new Error(`百炼视频编辑没有返回任务编号，请勿重复提交。RequestId：${body?.request_id || "未知"}`);
  return {
    providerJobId: String(taskId), requestId: body?.request_id || null, provider: body, initialStatus: "queued" as JobStatus,
    details: {
      pollable: true,
      engine: "modelstudio",
      model,
      route: "wan-video-editing",
      routeReason: "整条视频指令编辑使用 Wan 2.7 Video Editing；当前没有时间段或 mask 参数，不标记为 Retake",
      creationAction: "video_editing",
      sourceJobId: input.sourceJobId,
      sourceOutputIndex: input.sourceOutputIndex,
      sourceDuration: input.sourceDuration,
      referenceImageCount: input.referenceImages.length,
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
  const label = job.kind === "video_extension" ? "延长后视频" : job.kind === "video_editing" ? "编辑后视频" : "视频结果";
  return {
    status,
    provider: body,
    requestId: body?.request_id || job.requestId,
    error: status === "failed" ? friendlyProviderMessage(output.code, output.message, undefined, body?.request_id || job.requestId) : null,
    outputs: videoUrl ? [{ outputUrl: videoUrl, kind: "video" as const, label }] : job.outputs,
    details: { ...(job.details || {}), usage: body?.usage || null, taskStatus: output.task_status || null },
  };
}
