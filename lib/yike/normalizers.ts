import type { ResultMedia } from "@/lib/types";
import { normalizeStatus, parseJson, type AnyObject } from "@/lib/yike/shared";

function normalizeGeneration(body: AnyObject) {
  const j = body.videoGenerationJob ?? body.VideoGenerationJob ?? body;
  const parsed = parseJson(j.output ?? j.Output, {});
  const media = parsed.Medias ?? parsed.medias ?? [];
  return {
    status: normalizeStatus(j.status ?? j.Status),
    provider: body,
    requestId: body.requestId ?? body.RequestId ?? null,
    error: j.errorMessage ?? j.ErrorMessage ?? null,
    outputs: (Array.isArray(media) ? media : []).map((m: any): ResultMedia => ({ mediaId: m.MediaId ?? m.mediaId, outputUrl: m.OutputUrl ?? m.outputUrl, kind: "video" })),
    details: { remoteStatus: j.status ?? j.Status, model: j.model ?? j.Model, jobType: j.jobType ?? j.JobType, apiVersion: "2026-07-07" },
  };
}

function normalizeCoreFileJob(body: AnyObject, type: "analysis" | "script") {
  const j = body.job ?? body.Job ?? body.mediaComprehensionJob ?? body.MediaComprehensionJob ?? {};
  const url = j.result ?? j.Result;
  const status = normalizeStatus(j.status ?? j.Status ?? j.state ?? j.State);
  const label = type === "analysis" ? "视频拆解 JSON" : "复刻创意脚本 JSON";
  return {
    status,
    provider: body,
    requestId: body.requestId ?? body.RequestId ?? null,
    error: j.errorMessage ?? j.ErrorMessage ?? j.errorCode ?? j.ErrorCode ?? null,
    outputs: url ? [{ outputUrl: url, kind: "json" as const, label }] : [],
    details: {
      remoteStatus: j.status ?? j.Status ?? j.state ?? j.State,
      mediaIds: j.mediaIds ?? j.MediaIds ?? (j.mediaId ? [j.mediaId] : []),
      apiVersion: "2026-07-07",
      stage: type,
    },
  };
}

function normalizeRender(body: AnyObject) {
  const j = body.job ?? body.Job ?? {};
  const url = j.result ?? j.Result;
  return {
    status: normalizeStatus(j.status ?? j.Status),
    provider: body,
    requestId: body.requestId ?? body.RequestId ?? null,
    error: j.errorMessage ?? j.ErrorMessage ?? j.errorCode ?? j.ErrorCode ?? null,
    outputs: url ? [{ outputUrl: url, editingProjectId: j.editingProjectId ?? j.EditingProjectId, outputLanguage: j.language ?? j.Language, kind: "video" as const }] : [],
    details: { remoteStatus: j.status ?? j.Status, editingProjectId: j.editingProjectId ?? j.EditingProjectId ?? null, apiVersion: "2026-07-07" },
  };
}

function normalizeStoryboard(body: AnyObject) {
  const result = body.jobResult ?? body.JobResult ?? {};
  const outputs: ResultMedia[] = [];
  const video = result.outputUrl ?? result.OutputUrl;
  const srt = result.srtFileUrl ?? result.SrtFileUrl;
  if (video) outputs.push({ outputUrl: video, kind: "video" });
  if (srt) outputs.push({ outputUrl: srt, kind: "subtitle", label: "SRT 字幕" });
  return {
    status: normalizeStatus(body.jobStatus ?? body.JobStatus),
    provider: body,
    requestId: body.requestId ?? body.RequestId ?? null,
    error: normalizeStatus(body.jobStatus ?? body.JobStatus) === "failed" ? "故事板任务失败" : inferStoryboardError(result),
    outputs,
    details: {
      remoteStatus: body.jobStatus ?? body.JobStatus,
      storyboardInfo: parseJson(result.storyboardInfoList ?? result.StoryboardInfoList, []),
      failedShots: parseJson(result.failureShotList ?? result.FailureShotList, []),
      exceptionStoryboardIds: parseJson(result.exceptionStoryboardIds ?? result.ExceptionStoryboardIds, []),
      successStoryboardIds: result.successStoryboardIds ?? result.SuccessStoryboardIds ?? null,
      apiVersion: "2026-03-19",
    },
  };
}

function normalizeAgentLike(body: AnyObject) {
  const status = normalizeStatus(body.jobStatus ?? body.JobStatus);
  const result = body.jobResult ?? body.JobResult ?? [];
  const outputs: ResultMedia[] = (Array.isArray(result) ? result : []).map((m: any) => ({
    mediaId: m.mediaId ?? m.MediaId,
    outputUrl: m.outputUrl ?? m.OutputUrl,
    outputLanguage: m.outputLanguage ?? m.OutputLanguage,
    editingProjectId: m.editingProjectId ?? m.EditingProjectId,
    kind: "video",
  }));
  return {
    status,
    provider: body,
    requestId: body.requestId ?? body.RequestId ?? null,
    error: body.errorCode ?? body.ErrorCode ?? null,
    outputs,
    details: { remoteStatus: body.jobStatus ?? body.JobStatus, remoteType: body.jobType ?? body.JobType ?? null, apiVersion: "2026-03-19" },
  };
}

function inferStoryboardError(result: AnyObject) {
  const failures = parseJson(result.failureShotList ?? result.FailureShotList, []);
  return Array.isArray(failures) && failures.length ? `${failures.length} 个镜头失败，可直接续跑原任务` : null;
}

export { normalizeGeneration, normalizeCoreFileJob, normalizeRender, normalizeStoryboard, normalizeAgentLike };
