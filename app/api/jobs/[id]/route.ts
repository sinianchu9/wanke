import { NextResponse } from "next/server";
import type { StoredJob } from "@/lib/types";
import { createJob, deleteJob, getJob, requestReferenceExists, updateJobRemote } from "@/lib/repository";
import { refreshJob, resumeStoryboard, submitJob, type VideoProviderMode } from "@/lib/video/provider";
import { prepareJobInput } from "@/lib/video/prepare";
import { collectLocalInputRefs, deleteLocalInput } from "@/lib/video/local-input";
import { archiveJobOutput, deleteArchivedOutputs } from "@/lib/archive";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "任务不存在" }, { status: 404 });
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
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
      const child = await submitChild(job, retryRequest, `${job.title} · 重试`, {
        creationAction: "retry",
        sourceJobId: job.id,
      });
      return NextResponse.json({ job: child }, { status: 201 });
    }

    if (action === "similar") {
      requireSuccessfulVideoJob(job);
      const similarRequest = withoutBatchMembership(job.request);
      const child = await submitChild(job, similarRequest, `${job.title} · 类似版本`, {
        creationAction: "similar_variant",
        sourceJobId: job.id,
      });
      return NextResponse.json({ job: child }, { status: 201 });
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
      const child = await submitChild(job, continueRequest, `${job.title} · 继续创作`, {
        creationAction: "continue_from_result",
        sourceJobId: job.id,
        sourceOutputIndex: outputIndex,
        sourceOutputUrl: sourceUrl,
      });
      return NextResponse.json({ job: child }, { status: 201 });
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
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  const localRefs = [...collectLocalInputRefs(job.request)];
  deleteArchivedOutputs(job.outputs);
  if (!deleteJob(id)) return NextResponse.json({ error: "任务删除失败" }, { status: 500 });

  const orphaned = localRefs.filter(ref => !requestReferenceExists(ref));
  await Promise.allSettled(orphaned.map(deleteLocalInput));
  return NextResponse.json({ ok: true });
}

async function submitChild(parent: StoredJob, request: Record<string, unknown>, title: string, relationDetails: Record<string, unknown>) {
  const child = createJob({ kind: parent.kind, title, request, parentJobId: parent.id });
  const inheritedProviderMode = providerModeFromJob(parent);
  try {
    const preparedInput = await prepareJobInput(parent.kind, request);
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
