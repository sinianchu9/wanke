import { NextResponse } from "next/server";
import type { StoredJob } from "@/lib/types";
import { createJob, deleteJob, getJob, getJobForUser, requestReferenceExists, updateJobRemote } from "@/lib/repository";
import { assignJobToShot } from "@/lib/projects";
import { db } from "@/lib/db";
import { refreshJob, resumeStoryboard, submitJob, type VideoProviderMode } from "@/lib/video/provider";
import { prepareJobInput } from "@/lib/video/prepare";
import { collectLocalInputRefs, deleteLocalInput } from "@/lib/video/local-input";
import { archiveJobOutput, deleteArchivedOutputs } from "@/lib/archive";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser, type SessionUser } from "@/lib/auth";
import { refundQuota, reserveQuota } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    const job = getJobForUser(id, user.id, user.role === "admin");
    return job ? NextResponse.json({ job }) : NextResponse.json({ error: "任务不存在" }, { status: 404 });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  let user: SessionUser;
  try {
    user = requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const job = getJobForUser(id, user.id, user.role === "admin");
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "refresh";

    if (action === "refresh") {
      const remote = await refreshJob(job);
      const updated = updateJobRemote(id, remote);
      return NextResponse.json({ job: updated });
    }

    if (action === "retry") {
      if (job.status !== "failed") {
        return NextResponse.json({ error: "重试只用于失败任务。成功结果请使用“再来一个类似版本”或“继续创作”。" }, { status: 400 });
      }
      const retryRequest = withoutBatchMembership(job.request);
      const child = await submitChildWithQuota(user, job, retryRequest, `${job.title} · 重试`, {
        creationAction: "retry",
        sourceJobId: job.id,
      }, true);
      if ("error" in child) return child.error;
      return NextResponse.json({ job: child.job }, { status: 201 });
    }

    if (action === "similar") {
      requireSuccessfulVideoJob(job);
      const similarRequest = withoutBatchMembership(job.request);
      const child = await submitChildWithQuota(user, job, similarRequest, `${job.title} · 类似版本`, {
        creationAction: "similar_variant",
        sourceJobId: job.id,
      }, true);
      if ("error" in child) return child.error;
      return NextResponse.json({ job: child.job }, { status: 201 });
    }

    if (action === "continue") {
      requireSuccessfulVideoJob(job);
      const outputIndex = Number(body.outputIndex ?? 0);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return NextResponse.json({ error: "继续创作需要填写新的创作要求" }, { status: 400 });
      if (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex >= job.outputs.length) {
        return NextResponse.json({ error: "请选择一个有效的视频结果作为参考" }, { status: 400 });
      }
      const output = job.outputs[outputIndex];
      const sourceUrl = output.outputUrl?.trim();
      if (!sourceUrl) {
        return NextResponse.json({ error: "这个结果没有可供远端模型访问的云端视频 URL，暂时不能作为继续创作参考" }, { status: 400 });
      }

      const base = withoutBatchMembership(job.request) as Record<string, any>;
      const { _subjectCardIds: sourceSubjectCardIds, ...directInputsRemoved } = base;
      const continueRequest = {
        ...directInputsRemoved,
        title: `${job.title} · 继续创作`,
        prompt,
        jobType: "reference_to_video",
        medias: [{ type: "video", url: sourceUrl, mediaId: "" }],
        duration: Math.min(Number(base.duration) || 5, 10),
        n: 1,
        _sourceSubjectCardIds: Array.isArray(sourceSubjectCardIds) ? sourceSubjectCardIds : [],
      };
      const child = await submitChildWithQuota(user, job, continueRequest, `${job.title} · 继续创作`, {
        creationAction: "continue_from_result",
        sourceJobId: job.id,
        sourceOutputIndex: outputIndex,
        sourceOutputUrl: sourceUrl,
      });
      if ("error" in child) return child.error;
      return NextResponse.json({ job: child.job }, { status: 201 });
    }

    if (action === "resume") {
      if (job.kind !== "storyboard" || !job.providerJobId) return NextResponse.json({ error: "只有故事板远端任务支持续跑" }, { status: 400 });
      const provider = await resumeStoryboard(job.providerJobId);
      const updated = updateJobRemote(id, { status: "running", provider, error: null, finishedAt: null });
      return NextResponse.json({ job: updated });
    }

    if (action === "archive") {
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= job.outputs.length) return NextResponse.json({ error: "无效的结果序号" }, { status: 400 });
      const archived = await archiveJobOutput(job, index);
      const outputs = job.outputs.map((item, i) => i === index ? archived : item);
      const updated = updateJobRemote(id, { outputs });
      return NextResponse.json({ job: updated, output: archived });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    const job = getJobForUser(id, user.id, user.role === "admin");
    if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    const localRefs = [...collectLocalInputRefs(job.request)];
    deleteArchivedOutputs(job.outputs);
    if (!deleteJob(id)) return NextResponse.json({ error: "任务删除失败" }, { status: 500 });

    const orphaned = localRefs.filter(ref => !requestReferenceExists(ref));
    await Promise.allSettled(orphaned.map(deleteLocalInput));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

/** Reserve one quota unit, submit the child job, and refund when submission fails synchronously. */
async function submitChildWithQuota(
  user: SessionUser,
  parent: StoredJob,
  requestPayload: Record<string, unknown>,
  title: string,
  relationDetails: Record<string, unknown>,
  attachToParentShot = false,
): Promise<{ job: StoredJob } | { error: NextResponse }> {
  try {
    reserveQuota(user.id, 1);
  } catch (error) {
    const handled = errorResponse(error);
    return { error: handled || NextResponse.json({ error: "服务器错误" }, { status: 500 }) };
  }
  const child = await submitChild(user, parent, requestPayload, title, relationDetails, attachToParentShot);
  if (child.status === "failed") refundQuota(user.id, 1);
  return { job: child };
}

async function submitChild(
  user: SessionUser,
  parent: StoredJob,
  requestPayload: Record<string, unknown>,
  title: string,
  relationDetails: Record<string, unknown>,
  attachToParentShot = false,
) {
  const child = createJob({ kind: parent.kind, title, request: requestPayload, parentJobId: parent.id, userId: user.id });
  if (attachToParentShot) {
    const relation = db.prepare("SELECT shot_id FROM shot_jobs WHERE job_id = ? LIMIT 1").get(parent.id) as { shot_id?: string } | undefined;
    if (relation?.shot_id) assignJobToShot(relation.shot_id, child.id);
  }

  const inheritedProviderMode = providerModeFromJob(parent);
  try {
    const preparedInput = await prepareJobInput(parent.kind, requestPayload);
    const submitted = await submitJob(parent.kind, preparedInput, inheritedProviderMode ? { videoProviderMode: inheritedProviderMode } : undefined);
    return updateJobRemote(child.id, {
      providerJobId: submitted.providerJobId,
      status: submitted.initialStatus,
      provider: submitted.provider,
      requestId: submitted.requestId,
      error: null,
      details: {
        ...(submitted.details || {}),
        ...relationDetails,
        ...(inheritedProviderMode ? { requestedProviderMode: inheritedProviderMode } : {}),
      },
    })!;
  } catch (error) {
    return updateJobRemote(child.id, {
      status: "failed",
      error: describeError(error),
      details: {
        ...relationDetails,
        ...(inheritedProviderMode ? { requestedProviderMode: inheritedProviderMode } : {}),
      },
    })!;
  }
}

function providerModeFromJob(job: StoredJob): VideoProviderMode | undefined {
  const mode = job.details?.requestedProviderMode;
  return mode === "auto" || mode === "modelstudio" || mode === "yike" ? mode : undefined;
}

function requireSuccessfulVideoJob(job: StoredJob) {
  if (job.kind !== "video_generation" || job.status !== "succeeded") {
    throw new Error("只有已完成的 AI 视频生成任务支持继续创作");
  }
}

function withoutBatchMembership(request: Record<string, unknown>) {
  const { _batch: _ignored, ...rest } = request as Record<string, unknown> & { _batch?: unknown };
  return rest;
}
