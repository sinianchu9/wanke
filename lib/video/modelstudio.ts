import "server-only";
import type { JobStatus, StoredJob } from "@/lib/types";
import type { VideoExtensionInput } from "@/lib/video/extension";
import type { VideoEditingInput } from "@/lib/video/editing";
import { getModelStudioChannelConfig, getModelStudioRuntimeConfig, type ModelStudioChannel } from "@/lib/settings";

type VideoInput = {
  prompt: string;
  jobType: "text_to_video" | "image_to_video" | "first_last_frame" | "reference_to_video";
  medias: { type: "image" | "video" | "audio"; url?: string; mediaId?: string }[];
  aspectRatio: string;
  duration: number;
  resolution: "480P" | "720P" | "1080P";
  model?: string;
};

type RouteDecision = {
  model: string;
  route: "happyhorse-t2v" | "happyhorse-i2v" | "happyhorse-r2v" | "wan-t2v" | "wan-i2v" | "wan-r2v";
  reason: string;
};

export function chooseRoute(input: VideoInput): RouteDecision {
  const hhConfig = getModelStudioChannelConfig("happyhorse");
  const wanConfig = getModelStudioChannelConfig("wan");
  const hhEndpoint = rootUrlForChannel("happyhorse");
  const isHhBeijing = hhEndpoint.includes("cn-beijing");
  // HappyHorse does not exist in Beijing exclusive workspace
  const hhReady = Boolean(hhConfig.apiKey) && !hhConfig.blockedReason && !isHhBeijing;
  const wanReady = Boolean(wanConfig.apiKey) && !wanConfig.blockedReason;

  const requestedModel = String(input.model || "").toLowerCase();
  const prefersWan = requestedModel.startsWith("wan");
  const prefersHh = requestedModel.startsWith("happyhorse");

  // Wan 3.0 独占或优先条件判断
  const exceedsHappyHorseDuration = input.duration > 15 || input.duration < 3;
  const requires480P = input.resolution === "480P";
  const isFirstLast = input.jobType === "first_last_frame";
  const hasVideoReference = input.medias.some(media => media.type === "video");

  // 如果用户明确指定了 Wan 3.0，或当前参数超出 HappyHorse 规格（且用户未显式要求 HappyHorse），只要 Wan 通道就绪则走 Wan 3.0
  const shouldRouteWan = (prefersWan || (!hhReady && wanReady) || (!prefersHh && (exceedsHappyHorseDuration || requires480P || isFirstLast || hasVideoReference))) && wanReady;

  if (shouldRouteWan && (!prefersHh || !hhReady || requires480P || isFirstLast)) {
    if (input.jobType === "text_to_video") {
      const reason = prefersWan
        ? "已指定使用 Wan 3.0 视频大模型（支持 2–30 秒原生生成）"
        : exceedsHappyHorseDuration
          ? `时长为 ${input.duration} 秒，自动使用 Wan 3.0 超长文生视频能力（最长支持 30 秒）`
          : requires480P
            ? "清晰度为 480P，自动使用 Wan 3.0 原生文生视频能力"
            : "Wan 通道已就绪，文生视频使用 Wan 3.0 原生能力";
      return { model: "wan3.0-video", route: "wan-t2v", reason };
    }
    if (input.jobType === "image_to_video") {
      const reason = prefersWan
        ? "已指定使用 Wan 3.0 视频大模型（支持 2–30 秒原生生成）"
        : exceedsHappyHorseDuration
          ? `时长为 ${input.duration} 秒，自动使用 Wan 3.0 超长图生视频能力（最长支持 30 秒）`
          : requires480P
            ? "清晰度为 480P，自动使用 Wan 3.0 原生图生视频能力"
            : "Wan 通道已就绪，单图生视频使用 Wan 3.0 原生能力";
      return { model: "wan3.0-video", route: "wan-i2v", reason };
    }
    if (isFirstLast) {
      return { model: "wan3.0-video", route: "wan-i2v", reason: "首尾帧由 Wan 3.0 原生支持过渡生成" };
    }
    return {
      model: "wan3.0-video",
      route: "wan-r2v",
      reason: prefersWan
        ? "已指定使用 Wan 3.0 视频大模型"
        : hasVideoReference
          ? "存在视频参考，自动使用 Wan 3.0 多模态参考能力（输入+输出总时长 ≤30 秒）"
          : exceedsHappyHorseDuration
            ? `时长为 ${input.duration} 秒，自动使用 Wan 3.0 超长多参考能力（最长支持 30 秒）`
            : "Wan 通道已就绪，参考生视频使用 Wan 3.0 多模态能力",
    };
  }

  // 默认或指定使用 HappyHorse 1.1（单镜头支持 3–15 秒，720P/1080P，高动态与一致性）
  if (input.jobType === "text_to_video") {
    return { model: "happyhorse-1.1-t2v", route: "happyhorse-t2v", reason: prefersHh ? "已指定使用 HappyHorse 1.1 质感模型（单镜头支持 3–15 秒）" : "文生视频默认使用 HappyHorse 1.1，优先画面质量与自然运动（支持 3–15 秒）" };
  }
  if (input.jobType === "image_to_video") {
    return { model: "happyhorse-1.1-i2v", route: "happyhorse-i2v", reason: prefersHh ? "已指定使用 HappyHorse 1.1 质感模型（单镜头支持 3–15 秒）" : "单图生视频默认使用 HappyHorse 1.1，优先画面质量与自然运动（支持 3–15 秒）" };
  }
  if (isFirstLast) {
    return { model: "wan3.0-video", route: "wan-i2v", reason: "首尾帧由 Wan 3.0 原生支持" };
  }
  if (input.medias.every(media => media.type === "image")) {
    return { model: "happyhorse-1.1-r2v", route: "happyhorse-r2v", reason: prefersHh ? "已指定使用 HappyHorse 1.1 质感模型，强化人物与产品一致性" : "纯图片多参考优先 HappyHorse 1.1，强化人物与产品一致性（支持 3–15 秒）" };
  }
  return { model: "wan3.0-video", route: "wan-r2v", reason: "存在视频参考，自动使用 Wan 3.0 多模态参考能力" };
}

function requireUrl(media: VideoInput["medias"][number], index: number) {
  const url = media.url?.trim();
  if (!url) throw new Error(`第 ${index + 1} 个参考素材没有可访问 URL，请从素材库重新选择或使用公网 URL`);
  return url;
}

function effectiveDuration(input: VideoInput, decision: RouteDecision) {
  const hasVideoReference = input.medias.some(media => media.type === "video");
  // Wan 3.0 原生支持单次 2-30 秒；有视频参考时总时长 ≤ 30 秒
  if (decision.route === "wan-r2v" && hasVideoReference) return Math.min(input.duration, 30);
  // HappyHorse 官方单次最大支持 15 秒（3-15s），安全防护 clamp，防止向百炼发起超出规格报错
  if (decision.model.toLowerCase().includes("happyhorse")) {
    return Math.max(3, Math.min(input.duration, 15));
  }
  return Math.max(2, Math.min(input.duration, 30));
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
  const parameters: Record<string, unknown> = { resolution: input.resolution, duration, ratio: input.aspectRatio, watermark: false };

  if (decision.route === "happyhorse-t2v") {
    parameters.ratio = input.aspectRatio;
    return { model: decision.model, input: { prompt }, parameters };
  }
  if (decision.route === "happyhorse-i2v") {
    return { model: decision.model, input: { prompt, media: [{ type: "first_frame", url: requireUrl(input.medias[0], 0) }] }, parameters };
  }
  if (decision.route === "wan-t2v") {
    parameters.ratio = input.aspectRatio;
    return { model: decision.model, input: { prompt }, parameters: { ...parameters, prompt_extend: true, audio_setting: "auto" } };
  }
  if (decision.route === "wan-i2v") {
    const isFirstLast = input.jobType === "first_last_frame" && input.medias.length >= 2;
    return {
      model: decision.model,
      input: {
        prompt,
        media: isFirstLast
          ? [{ type: "first_frame", url: requireUrl(input.medias[0], 0) }, { type: "last_frame", url: requireUrl(input.medias[1], 1) }]
          : [{ type: "first_frame", url: requireUrl(input.medias[0], 0) }],
      },
      parameters: { ...parameters, prompt_extend: true, audio_setting: "auto" },
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
    parameters: { ...parameters, prompt_extend: false, audio_setting: "auto" },
  };
}

export function resolveChannel(modelName: string): "happyhorse" | "wan" {
  if (modelName.toLowerCase().startsWith("wan")) return "wan";
  return "happyhorse";
}

export function apiKeyForChannel(channel: ModelStudioChannel = "default") {
  return getModelStudioChannelConfig(channel).apiKey;
}

export function rootUrlForChannel(channel: ModelStudioChannel = "default") {
  const config = getModelStudioChannelConfig(channel);
  const explicit = config.baseUrl.trim().replace(/\/+$/, "");
  if (explicit) return explicit.endsWith("/api/v1") ? explicit.slice(0, -7) : explicit;
  if (config.workspaceId) return `https://${config.workspaceId}.ap-southeast-1.maas.aliyuncs.com`;
  return "https://dashscope-intl.aliyuncs.com";
}

export function apiBaseForChannel(channel: ModelStudioChannel = "default") {
  return `${rootUrlForChannel(channel)}/api/v1`;
}

function apiKey() {
  return apiKeyForChannel("default");
}

function rootUrl() {
  return rootUrlForChannel("default");
}

function apiBase() {
  return apiBaseForChannel("default");
}

export function modelStudioConfigSummary() {
  const defaultCfg = getModelStudioChannelConfig("default");
  const happyhorseCfg = getModelStudioChannelConfig("happyhorse");
  const wanCfg = getModelStudioChannelConfig("wan");

  const endpoint = rootUrlForChannel("default");
  const isBeijing = endpoint.includes("cn-beijing");
  return {
    configured: Boolean(defaultCfg.apiKey || happyhorseCfg.apiKey || wanCfg.apiKey),
    provider: "modelstudio",
    regionId: isBeijing ? "cn-beijing" : "ap-southeast-1",
    regionName: isBeijing ? "北京" : "新加坡",
    endpoint: endpoint,
    workspaceDedicatedDomain: Boolean(defaultCfg.workspaceId || defaultCfg.baseUrl),
    configSource: defaultCfg.sources,
    channels: {
      happyhorse: {
        configured: Boolean(happyhorseCfg.apiKey),
        endpoint: rootUrlForChannel("happyhorse"),
        regionId: rootUrlForChannel("happyhorse").includes("cn-beijing") ? "cn-beijing" : "ap-southeast-1",
        regionName: rootUrlForChannel("happyhorse").includes("cn-beijing") ? "北京" : "新加坡",
        isOverridden: happyhorseCfg.isOverridden,
        sources: happyhorseCfg.sources,
        blockedReason: happyhorseCfg.blockedReason,
      },
      wan: {
        configured: Boolean(wanCfg.apiKey),
        endpoint: rootUrlForChannel("wan"),
        regionId: rootUrlForChannel("wan").includes("cn-beijing") ? "cn-beijing" : "ap-southeast-1",
        regionName: rootUrlForChannel("wan").includes("cn-beijing") ? "北京" : "新加坡",
        isOverridden: wanCfg.isOverridden,
        sources: wanCfg.sources,
        blockedReason: wanCfg.blockedReason,
      },
    },
  };
}

export function canUseModelStudio(input: VideoInput) {
  const decision = chooseRoute(input);
  const channel = resolveChannel(decision.model);
  const key = apiKeyForChannel(channel);
  if (!key) return false;
  const config = getModelStudioChannelConfig(channel);
  if (config.blockedReason) return false;
  if (!input.medias.every(media => Boolean(media.url))) return false;
  if (input.jobType === "reference_to_video" && input.medias.some(media => media.type === "audio")) return false;
  return true;
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
  if (haystack.includes("portrait") || haystack.includes("肖像") || haystack.includes("celebrity") || (haystack.includes("datainspection") && (haystack.includes("face") || haystack.includes("person") || haystack.includes("human")))) {
    return withDiagnostics("画面或描述中可能包含受保护的人物肖像权或敏感人像信息，生成服务已拦截。本次创作额度已全额退回，请更换无肖像争议的素材或修改描述后重试。");
  }
  if (normalizedCode === "datainspectionfailed" || haystack.includes("datainspection") || haystack.includes("sensitive") || haystack.includes("审核") || haystack.includes("违规")) {
    return withDiagnostics("内容安全审核未通过，画面或描述中可能包含敏感信息。本次创作额度已全额退回，请修改描述或更换素材后重试。");
  }
  if (haystack.includes("invalidparameter") || haystack.includes("invalid parameter")) {
    return withDiagnostics(`素材或画面参数不符合当前模型要求。${message ? ` 原因：${message}` : ""}`);
  }
  return withDiagnostics(message ? `百炼视频生成失败：${message}` : `百炼视频接口失败${status ? `（HTTP ${status}）` : ""}`);
}

async function requestJsonForChannel(channel: ModelStudioChannel, url: string, init: RequestInit) {
  const key = apiKeyForChannel(channel);
  if (!key) {
    const channelName = channel === "happyhorse" ? "HappyHorse" : channel === "wan" ? "Wan" : "百炼 Model Studio";
    throw new Error(`未配置 ${channelName} API Key：请到设置中填写对应 API Key（或补充通用百炼 Key）`);
  }
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

async function requestJson(url: string, init: RequestInit) {
  return requestJsonForChannel("default", url, init);
}

export async function submitModelStudioVideo(input: VideoInput) {
  const decision = chooseRoute(input);
  const channel = resolveChannel(decision.model);
  const duration = effectiveDuration(input, decision);
  const payload = buildPayload(input, decision);
  const endpoint = rootUrlForChannel(channel);
  const body = await requestJsonForChannel(
    channel,
    `${apiBaseForChannel(channel)}/services/aigc/video-generation/video-synthesis`,
    { method: "POST", body: JSON.stringify(payload) }
  );
  const taskId = body?.output?.task_id;
  if (!taskId) throw new Error(`百炼没有返回任务编号，请勿重复点击生成。RequestId：${body?.request_id || "未知"}`);
  return {
    providerJobId: String(taskId),
    requestId: body?.request_id || null,
    provider: body,
    initialStatus: "queued" as JobStatus,
    details: {
      pollable: true,
      engine: "modelstudio",
      channel,
      model: decision.model,
      route: decision.route,
      routeReason: decision.reason,
      requestedDuration: input.duration,
      effectiveDuration: duration,
      endpoint,
    },
  };
}

export async function submitModelStudioVideoExtension(input: VideoExtensionInput) {
  const model = "wan3.0-video";
  const channel = "wan" as const;
  const endpoint = rootUrlForChannel(channel);
  const body = await requestJsonForChannel(
    channel,
    `${apiBaseForChannel(channel)}/services/aigc/video-generation/video-synthesis`,
    {
      method: "POST",
      body: JSON.stringify({
        model,
        input: { prompt: input.prompt, media: [{ type: "first_clip", url: input.sourceUrl }] },
        parameters: { resolution: input.resolution, duration: input.targetDuration, prompt_extend: true, watermark: false, audio_setting: "auto" },
      }),
    }
  );
  const taskId = body?.output?.task_id;
  if (!taskId) throw new Error(`百炼视频延长没有返回任务编号，请勿重复提交。RequestId：${body?.request_id || "未知"}`);
  return {
    providerJobId: String(taskId),
    requestId: body?.request_id || null,
    provider: body,
    initialStatus: "queued" as JobStatus,
    details: {
      pollable: true,
      engine: "modelstudio",
      channel,
      model,
      route: "wan-video-extension",
      routeReason: "视频延长使用 Wan 3.0 原生 first_clip continuation，最高支持延续至 30 秒",
      creationAction: "video_extension",
      sourceJobId: input.sourceJobId,
      sourceOutputIndex: input.sourceOutputIndex,
      sourceDuration: input.sourceDuration,
      targetDuration: input.targetDuration,
      endpoint,
    },
  };
}

export async function submitModelStudioVideoEditing(input: VideoEditingInput) {
  const model = "wan3.0-video";
  const channel = "wan" as const;
  const endpoint = rootUrlForChannel(channel);
  const media = [
    { type: "video", url: input.sourceUrl },
    ...input.referenceImages.map(url => ({ type: "reference_image", url })),
  ];
  const body = await requestJsonForChannel(
    channel,
    `${apiBaseForChannel(channel)}/services/aigc/video-generation/video-synthesis`,
    {
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
    }
  );
  const taskId = body?.output?.task_id;
  if (!taskId) throw new Error(`百炼视频编辑没有返回任务编号，请勿重复提交。RequestId：${body?.request_id || "未知"}`);
  return {
    providerJobId: String(taskId),
    requestId: body?.request_id || null,
    provider: body,
    initialStatus: "queued" as JobStatus,
    details: {
      pollable: true,
      engine: "modelstudio",
      channel,
      model,
      route: "wan-video-editing",
      routeReason: "整条视频指令编辑使用 Wan 3.0 Video Editing，支持原生音频与高清编辑",
      creationAction: "video_editing",
      sourceJobId: input.sourceJobId,
      sourceOutputIndex: input.sourceOutputIndex,
      sourceDuration: input.sourceDuration,
      referenceImageCount: input.referenceImages.length,
      endpoint,
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
  const channel: "happyhorse" | "wan" = (job.details?.channel as any) || (typeof job.details?.model === "string" ? resolveChannel(job.details.model) : "happyhorse");
  const endpoint = job.details?.endpoint ? String(job.details.endpoint).replace(/\/+$/, "") : rootUrlForChannel(channel);
  const taskUrl = `${endpoint}/api/v1/tasks/${encodeURIComponent(job.providerJobId)}`;
  const body = await requestJsonForChannel(channel, taskUrl, { method: "GET" });
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
