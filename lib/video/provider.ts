import "server-only";
import type { JobKind, StoredJob } from "@/lib/types";
import { validateJobInput } from "@/lib/yike/schemas";
import { refreshJob as refreshYikeJob, resumeStoryboard, submitJob as submitYikeJob } from "@/lib/yike/jobs";
import { canUseModelStudio, refreshModelStudioVideo, submitModelStudioVideo, submitModelStudioVideoEditing, submitModelStudioVideoExtension } from "@/lib/video/modelstudio";
import { validateVideoExtensionInput } from "@/lib/video/extension";
import { validateVideoEditingInput } from "@/lib/video/editing";
import { getModelStudioRuntimeConfig, getVideoProviderMode } from "@/lib/settings";
import { applyVideoRecipe, getVideoRecipe, recipeSupportsMode } from "@/lib/video/recipes";

export { resumeStoryboard };

export type VideoProviderMode = "auto" | "modelstudio" | "yike";

type SubmitJobOptions = {
  videoProviderMode?: VideoProviderMode;
};

function hasInlineLocalImage(input: any) {
  return Array.isArray(input.medias) && input.medias.some((media: any) => typeof media?.url === "string" && media.url.startsWith("data:image/"));
}

function blockedModelStudioMessage(config: ReturnType<typeof getModelStudioRuntimeConfig>) {
  return config.blockedReason
    ? `当前百炼配置不能用于 Wanke 服务端直连：${config.blockedReason} 请到设置清除或更换后再生成。`
    : "";
}

function withRecipeDetails(submitted: any, recipe: ReturnType<typeof getVideoRecipe>) {
  return {
    ...submitted,
    details: {
      ...(submitted.details || {}),
      recipeId: recipe.id,
      recipeLabel: recipe.label,
    },
  };
}

async function submitThroughYike(kind: JobKind, input: any, routeReason: string, recipe: ReturnType<typeof getVideoRecipe>) {
  if (hasInlineLocalImage(input)) {
    throw new Error("当前选择的是万镜一刻，本地图片直传只支持百炼。请改用素材库/公网 URL，或切换为百炼/自动路由。");
  }
  const submitted = await submitYikeJob(kind, input);
  return {
    ...submitted,
    details: {
      ...(submitted.details || {}),
      engine: "yike-fallback",
      routeReason,
      recipeId: recipe.id,
      recipeLabel: recipe.label,
    },
  };
}

export async function submitJob(kind: JobKind, rawInput: unknown, options: SubmitJobOptions = {}) {
  if (kind === "video_extension") {
    const input = validateVideoExtensionInput(rawInput);
    const config = getModelStudioRuntimeConfig();
    const blocked = blockedModelStudioMessage(config);
    if (blocked) throw new Error(blocked);
    if (!config.apiKey) {
      throw new Error("视频延长当前使用百炼 Wan 2.7 原生 continuation。请先在设置中配置百炼 Pay-As-You-Go API Key。");
    }
    return submitModelStudioVideoExtension(input);
  }

  if (kind === "video_editing") {
    const input = validateVideoEditingInput(rawInput);
    const config = getModelStudioRuntimeConfig();
    const blocked = blockedModelStudioMessage(config);
    if (blocked) throw new Error(blocked);
    if (!config.apiKey) {
      throw new Error("视频编辑当前使用百炼 Wan 2.7 Video Editing。请先在设置中配置百炼 Pay-As-You-Go API Key。");
    }
    return submitModelStudioVideoEditing(input);
  }

  if (kind !== "video_generation") return submitYikeJob(kind, rawInput);

  const input = validateJobInput(kind, rawInput) as any;
  const recipe = getVideoRecipe((rawInput as any)?.recipeId);
  if (!recipeSupportsMode(recipe.id, input.jobType)) {
    throw new Error(`生成预设“${recipe.label}”不适用于当前生成方式，请重新选择预设。`);
  }
  const executionInput = {
    ...input,
    prompt: applyVideoRecipe(input.prompt, recipe.id),
  };
  const mode = options.videoProviderMode ?? getVideoProviderMode();
  const routeScope = options.videoProviderMode ? "本次任务" : "设置中";

  if (mode === "yike") {
    return submitThroughYike(kind, executionInput, `${routeScope}已指定基础视频生成使用万镜一刻`, recipe);
  }

  const modelStudioConfig = getModelStudioRuntimeConfig();
  const blocked = blockedModelStudioMessage(modelStudioConfig);

  if (mode === "modelstudio") {
    if (blocked) throw new Error(blocked);
    if (!modelStudioConfig.apiKey) throw new Error("当前已强制使用百炼，但还没有配置 Pay-As-You-Go API Key。请到设置填写后再生成。");
    if (!canUseModelStudio(executionInput)) {
      throw new Error("当前任务参数不能通过百炼直连提交。请检查参考素材是否有可访问 URL，或把本次生成线路切回“自动路由”。");
    }
    return withRecipeDetails(await submitModelStudioVideo(executionInput), recipe);
  }

  if (!blocked && canUseModelStudio(executionInput)) {
    return withRecipeDetails(await submitModelStudioVideo(executionInput), recipe);
  }

  if (hasInlineLocalImage(executionInput)) {
    if (blocked) throw new Error(`${blocked} 这条任务使用本机图片直传，无法改走万镜一刻；请修正百炼配置或改用素材库/公网图片。`);
    throw new Error("这条任务使用了本地图片直传，需要配置百炼 Model Studio Pay-As-You-Go API Key 后才能生成。请到设置中填写百炼 API Key。");
  }

  const fallbackReason = blocked
    ? "自动路由：百炼当前配置不适合服务端直连，已自动使用万镜一刻兼容链路"
    : "自动路由：百炼未配置或当前素材不适合直连，已自动使用万镜一刻兼容链路";
  return submitThroughYike(kind, executionInput, fallbackReason, recipe);
}

export async function refreshJob(job: StoredJob) {
  if (job.details?.engine === "modelstudio") {
    return refreshModelStudioVideo(job);
  }
  return refreshYikeJob(job);
}
