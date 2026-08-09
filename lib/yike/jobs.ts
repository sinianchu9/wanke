import "server-only";
import {
  GetYikeAgentJobRequest, GetYikeStoryboardJobRequest, GetYikeVoiceNarratorJobRequest,
  ResumeYikeStoryboardJobRequest, SubmitYikeAvatarNarratorJobRequest, SubmitYikeStoryboardJobRequest,
  SubmitYikeVideoCloneJobRequest, SubmitYikeVoiceNarratorJobRequest,
} from "@alicloud/yike20260319";
import {
  GetMediaComprehensionJobRequest, GetRemakeScriptJobRequest, GetVideoGenerationJobRequest, GetVideoRenderJobRequest,
  SubmitMediaComprehensionJobRequest, SubmitRemakeScriptJobRequest, SubmitVideoGenerationJobRequest,
  SubmitVideoRenderJobRequest, SubmitVideoTranslationJobRequest,
} from "@alicloud/yike20260707";
import type { JobKind, JobStatus, StoredJob } from "@/lib/types";
import { getCoreYikeClient, getStudioYikeClient } from "@/lib/yike/client";
import { validateJobInput } from "@/lib/yike/schemas";
import { bodyOf, compact, fetchRemoteScript, omit, safeMerge, type AnyObject } from "@/lib/yike/shared";
import { normalizeAgentLike, normalizeCoreFileJob, normalizeGeneration, normalizeRender, normalizeStoryboard } from "@/lib/yike/normalizers";

export async function submitJob(kind: JobKind, rawInput: unknown) {
  const input = validateJobInput(kind, rawInput);
  const core = getCoreYikeClient();
  const studio = getStudioYikeClient();
  let response: any;

  if (kind === "video_generation") {
    const payload = safeMerge({
      jobType: input.jobType,
      model: input.model,
      scene: "general",
      aspectRatio: input.aspectRatio,
      duration: String(input.duration),
      resolution: input.resolution,
      n: input.n,
      clientToken: crypto.randomUUID().replaceAll("-", ""),
      input: JSON.stringify({
        Prompt: input.prompt,
        Medias: input.medias.map((m: any) => ({ Type: m.type, ...(m.mediaId ? { MediaId: m.mediaId } : {}), ...(m.url ? { Url: m.url } : {}) })),
      }),
      jobParameters: "{}",
    }, input.expert);
    response = await core.submitVideoGenerationJob(new SubmitVideoGenerationJobRequest(payload));
  }

  if (kind === "video_analysis") {
    const jobParams = compact({ ProductName: input.productName, BrandName: input.brandName, SellingPoints: input.sellingPoints?.filter(Boolean) });
    const payload = safeMerge({
      jobType: "VideoBreakdown",
      input: JSON.stringify({ Medias: [{ Type: "video", Url: input.sourceUrl }] }),
      jobParams: JSON.stringify(jobParams),
    }, input.expert);
    response = await core.submitMediaComprehensionJob(new SubmitMediaComprehensionJobRequest(payload));
  }

  if (kind === "remake_script") {
    let remakeParams: AnyObject = compact({
      ComprehensionResult: input.comprehensionResult,
      Product: (input.originalProductName || input.productName || input.productDescription || input.productImages.length || input.productKnowledge) ? compact({
        OriginalProductName: input.originalProductName,
        NewProduct: compact({ ProductName: input.productName, Description: input.productDescription, ProductImages: input.productImages, ProductKnowledge: input.productKnowledge }),
      }) : undefined,
      Avatar: (input.originalAvatarName || input.newAvatarImages.length) ? compact({ OriginalAvatarName: input.originalAvatarName, NewAvatarImages: input.newAvatarImages }) : undefined,
      VoiceoverLanguage: input.voiceoverLanguage,
    });
    remakeParams = safeMerge(remakeParams, input.expert?.remakeParams);
    const payload = safeMerge({ remakeType: input.remakeType, remakeParams: JSON.stringify(remakeParams) }, omit(input.expert, "remakeParams"));
    response = await core.submitRemakeScriptJob(new SubmitRemakeScriptJobRequest(payload));
  }

  if (kind === "video_render") {
    const script = input.scriptJson.trim() || await fetchRemoteScript(input.scriptUrl);
    let settings: AnyObject = compact({
      VoiceoverLanguage: input.voiceoverLanguage,
      Resolution: input.resolution,
      AspectRatio: input.aspectRatio,
      WithSubtitles: input.withSubtitles,
      TTS: input.ttsVoiceUrl ? { VoiceUrl: input.ttsVoiceUrl } : undefined,
      Bgm: input.bgmUrl || undefined,
    });
    settings = safeMerge(settings, input.expert?.settings);
    const payload = safeMerge({ script, settings: JSON.stringify(settings) }, omit(input.expert, "settings"));
    response = await core.submitVideoRenderJob(new SubmitVideoRenderJobRequest(payload));
  }

  if (kind === "video_translation") {
    const payload = safeMerge({
      clientToken: crypto.randomUUID().replaceAll("-", ""),
      title: input.title || undefined,
      description: input.description || undefined,
      jobType: input.jobType,
      input: JSON.stringify({ Video: input.inputVideoOssUri }),
      output: JSON.stringify({ OssUri: input.outputOssUri }),
      jobParameters: JSON.stringify({ SourceLanguage: input.sourceLanguage, TargetLanguage: input.targetLanguage, NeedDetext: input.needDetext, NeedVisualTranslate: input.needVisualTranslate }),
    }, input.expert);
    response = await core.submitVideoTranslationJob(new SubmitVideoTranslationJobRequest(payload));
  }

  if (kind === "video_clone") {
    let jobParams: AnyObject = {
      SceneType: "variant-clone",
      OriginalVideo: { MediaId: input.originalMediaId },
      SceneConfig: JSON.stringify({ OldProductName: input.oldProductName || "", ProductName: input.productName || "" }),
      UserMaterials: input.userMaterialIds.map((MediaId: string) => ({ MediaId })),
      Resolution: input.resolution,
      WithSubtitles: input.withSubtitles,
    };
    if (input.avatarPortrait) jobParams.AvatarData = { AvatarPortrait: input.avatarPortrait, ...(input.avatarVoice ? { AvatarVoice: input.avatarVoice } : {}) };
    jobParams = safeMerge(jobParams, input.expert?.jobParams);
    response = await studio.submitYikeVideoCloneJob(new SubmitYikeVideoCloneJobRequest({ jobParams: JSON.stringify(jobParams), ...omit(input.expert, "jobParams") }));
  }

  if (kind === "avatar_narrator") {
    let jobParams: AnyObject = {
      SceneType: input.sceneType,
      TextType: input.textType,
      TextContent: input.textContent,
      AspectRatio: input.aspectRatio,
      Resolution: input.resolution,
      OutputLanguages: input.outputLanguages,
      WithSubtitles: input.withSubtitles,
      AvatarData: { AvatarPortrait: input.avatarPortrait, ...(input.avatarVoice ? { AvatarVoice: input.avatarVoice } : {}) },
    };
    if (input.textType === 1) jobParams.VoiceDuration = input.voiceDuration;
    if (input.sceneType !== "avatar-broadcast") jobParams.UserMaterials = input.userMaterialIds.map((MediaId: string) => ({ MediaId }));
    jobParams = safeMerge(jobParams, input.expert?.jobParams);
    response = await studio.submitYikeAvatarNarratorJob(new SubmitYikeAvatarNarratorJobRequest({ jobParams: JSON.stringify(jobParams), ...omit(input.expert, "jobParams") }));
  }

  if (kind === "voice_narrator") {
    let jobParams: AnyObject = {
      SceneType: "briefing-voiceover",
      TextType: input.textType,
      TextContent: input.textContent,
      UserMaterials: input.userMaterialIds.map((MediaId: string) => ({ MediaId })),
      NarrationVoiceId: input.narrationVoiceId,
      AspectRatio: input.aspectRatio,
      Resolution: input.resolution,
      OutputLanguages: input.outputLanguages,
      WithSubtitles: input.withSubtitles,
    };
    if (input.textType === 1) jobParams.VoiceDuration = input.voiceDuration;
    if (input.targetAspectRatio) jobParams.TargetAspectRatio = input.targetAspectRatio;
    if (input.heading) jobParams.Title = input.heading;
    if (input.subHeading) jobParams.SubHeading = input.subHeading;
    if (input.date) jobParams.Date = input.date;
    if (input.watermarkText) jobParams.Watermark = { Text: input.watermarkText };
    if (input.enabledAICover) jobParams.EnabledAICover = true;
    if (input.ipCharacterMediaId || input.ipCharacterMediaUrl) jobParams.IPCharacter = compact({ MediaId: input.ipCharacterMediaId, MediaUrl: input.ipCharacterMediaUrl });
    jobParams = safeMerge(jobParams, input.expert?.jobParams);
    response = await studio.submitYikeVoiceNarratorJob(new SubmitYikeVoiceNarratorJobRequest({ jobParams: JSON.stringify(jobParams), ...omit(input.expert, "jobParams") }));
  }

  if (kind === "storyboard") {
    const payload = safeMerge({
      fileURL: input.fileURL,
      title: input.title || undefined,
      execMode: input.execMode,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      styleId: input.styleId,
      shotPromptMode: input.shotPromptMode,
      shotPromptLang: input.shotPromptLang,
      shotSplitMode: input.shotSplitMode,
      sourceType: input.sourceType,
      narrationVoiceId: input.narrationVoiceId,
      keepOriginDialogue: input.keepOriginDialogue,
      needCaption: input.needCaption,
      skipFailureShot: input.skipFailureShot,
      modelParams: JSON.stringify({ AudioEnable: input.audioEnable }),
      videoModel: input.videoModel,
    }, input.expert);
    response = await studio.submitYikeStoryboardJob(new SubmitYikeStoryboardJobRequest(payload));
  }

  if (!response) throw new Error(`不支持的任务类型：${kind}`);
  const body = bodyOf(response);
  const providerJobId = body.jobId ?? body.JobId ?? body.data?.jobId ?? body.Data?.JobId;
  if (!providerJobId) throw new Error(`Yike 未返回 JobId：${JSON.stringify(body).slice(0, 600)}`);
  return {
    providerJobId: String(providerJobId),
    requestId: body.requestId ?? body.RequestId ?? null,
    provider: body,
    initialStatus: kind === "video_translation" ? "unknown" as JobStatus : "queued" as JobStatus,
    details: kind === "video_translation" ? { pollable: false, note: "2026-07-07 SDK 当前仅公开提交接口；输出请检查指定 OSS 目录。" } : { pollable: true },
  };
}

export async function refreshJob(job: StoredJob) {
  if (!job.providerJobId) throw new Error("任务没有远端 JobId");
  const core = getCoreYikeClient();
  const studio = getStudioYikeClient();

  if (job.kind === "video_translation") {
    return {
      status: "unknown" as JobStatus,
      provider: job.provider,
      requestId: job.requestId,
      error: null,
      outputs: job.outputs,
      details: { ...(job.details || {}), pollable: false, note: "Yike 2026-07-07 SDK 未公开视频翻译查询接口；任务已提交，请到目标 OSS 目录检查输出。" },
    };
  }

  if (job.kind === "video_generation") {
    const body = bodyOf(await core.getVideoGenerationJob(new GetVideoGenerationJobRequest({ jobId: job.providerJobId })));
    return normalizeGeneration(body);
  }
  if (job.kind === "video_analysis") {
    const body = bodyOf(await core.getMediaComprehensionJob(new GetMediaComprehensionJobRequest({ jobId: job.providerJobId })));
    return normalizeCoreFileJob(body, "analysis");
  }
  if (job.kind === "remake_script") {
    const body = bodyOf(await core.getRemakeScriptJob(new GetRemakeScriptJobRequest({ jobId: job.providerJobId })));
    return normalizeCoreFileJob(body, "script");
  }
  if (job.kind === "video_render") {
    const body = bodyOf(await core.getVideoRenderJob(new GetVideoRenderJobRequest({ jobId: job.providerJobId })));
    return normalizeRender(body);
  }
  if (job.kind === "voice_narrator") {
    return normalizeAgentLike(bodyOf(await studio.getYikeVoiceNarratorJob(new GetYikeVoiceNarratorJobRequest({ jobId: job.providerJobId }))));
  }
  if (job.kind === "video_clone" || job.kind === "avatar_narrator") {
    return normalizeAgentLike(bodyOf(await studio.getYikeAgentJob(new GetYikeAgentJobRequest({ jobId: job.providerJobId }))));
  }
  if (job.kind === "storyboard") {
    return normalizeStoryboard(bodyOf(await studio.getYikeStoryboardJob(new GetYikeStoryboardJobRequest({ jobId: job.providerJobId }))));
  }
  throw new Error(`不支持查询：${job.kind}`);
}

export async function resumeStoryboard(providerJobId: string) {
  const response = await getStudioYikeClient().resumeYikeStoryboardJob(new ResumeYikeStoryboardJobRequest({ jobId: providerJobId }));
  return bodyOf(response);
}
