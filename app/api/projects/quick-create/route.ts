import { NextResponse } from "next/server";
import { z } from "zod";
import { createProject, createShot, assignJobToShot, setProjectSubjects } from "@/lib/projects";
import { createJob, updateJobRemote } from "@/lib/repository";
import { submitJob, type VideoProviderMode } from "@/lib/video/provider";
import { prepareJobInput } from "@/lib/video/prepare";
import { canUseModelStudio } from "@/lib/video/modelstudio";
import { buildQuickCreationPlan } from "@/lib/video/quick-create";
import { setProjectTransitionSettings } from "@/lib/video/project-transitions";
import { validateJobInput } from "@/lib/yike/schemas";
import { getModelStudioRuntimeConfig, getVideoProviderMode, getYikeRuntimeConfig } from "@/lib/settings";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser, type SessionUser } from "@/lib/auth";
import { assertBatchAffordable, attachJobToCharge, beginSubmitCharge, failSubmitCharge } from "@/lib/billing/charges";
import { getAssetForUser } from "@/lib/repository";
import { getSubjectCardForUser } from "@/lib/subjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  type: z.enum(["text_video", "product_ad", "person_short", "image_video"]),
  name: z.string().max(120).default(""),
  goal: z.string().trim().min(1).max(1200),
  platform: z.enum(["douyin", "xiaohongshu", "youtube", "landscape", "square"]),
  totalDuration: z.number().int().min(2).max(30).default(5),
  providerMode: z.enum(["auto", "modelstudio", "yike"]).optional(),
  preferredModel: z.enum(["auto", "wan3.0", "happyhorse-1.1", "wan", "happyhorse"]).optional().default("auto"),
  subjectId: z.string().min(1).nullable().optional(),
  imageAssetId: z.string().min(1).nullable().optional(),
  referenceUrl: z.string().trim().max(2048).optional().default(""),
  // Client-generated request id: a repeated submit reuses the same per-shot charges.
  clientRequestId: z.string().min(8).max(128).optional(),
  localInputRef: z.string().trim().max(240).optional().default(""),
}).superRefine((value, ctx) => {
  const directCount = [value.imageAssetId, value.referenceUrl, value.localInputRef].filter(Boolean).length;
  if (value.type === "text_video") {
    if (value.subjectId || directCount > 0) ctx.addIssue({ code: "custom", message: "纯文字生成不需要主体、图片或链接，请清除参考素材后直接描述视频" });
    return;
  }
  if (directCount > 1) {
    ctx.addIssue({ code: "custom", message: "一次快速创作只能使用一种直接图片来源，请保留素材库图片、本地图片或公网链接中的一种" });
    return;
  }
  if (value.type === "image_video") {
    if (value.subjectId) ctx.addIssue({ code: "custom", path: ["subjectId"], message: "图片动起来不需要人物或产品主体" });
    if (directCount !== 1) ctx.addIssue({ code: "custom", message: "图片动起来需要选择、上传或粘贴一张图片" });
    return;
  }
  const sourceCount = (value.subjectId ? 1 : 0) + directCount;
  if (sourceCount !== 1) {
    ctx.addIssue({ code: "custom", message: value.type === "product_ad"
      ? "请选择一个产品，或本次直接提供一张产品图片"
      : "请选择一个人物，或本次直接提供一张人物图片" });
  }
});

export async function POST(request: Request) {
  let user: SessionUser;
  try {
    user = requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
  try {
    const input = schema.parse(await request.json());
    if (input.subjectId && !getSubjectCardForUser(input.subjectId, user.id)) {
      return NextResponse.json({ error: "所选主体卡不存在" }, { status: 400 });
    }
    if (input.imageAssetId && !getAssetForUser(input.imageAssetId, user.id)) {
      return NextResponse.json({ error: "所选素材不存在" }, { status: 400 });
    }
    const effectiveProviderMode = input.providerMode ?? getVideoProviderMode();
    assertQuickGenerationReady(Boolean(input.localInputRef), effectiveProviderMode);
    const plan = buildQuickCreationPlan({ ...input, name: input.name || inferredProjectName(input.goal, input.type) });
    await preflightQuickPlan(plan, effectiveProviderMode);

    const project = createProject({ name: plan.projectName, description: plan.projectDescription, userId: user.id });
    if (input.subjectId) setProjectSubjects(project.id, [input.subjectId]);
    if (plan.shots.length > 1) setProjectTransitionSettings({ projectId: project.id, transitionType: "fade", duration: 0.5 });

    // Check the whole plan is affordable first, then reserve per shot so a single
    // synchronous rejection only returns that shot's credits.
    const firstShot = plan.shots[0];
    const quickQuote = assertBatchAffordable(user.id, "video_generation", {
      duration: firstShot?.duration || Math.round(Number(input.totalDuration || 5) / Math.max(1, plan.shots.length)),
      model: firstShot?.model || input.preferredModel || "auto",
      preferredModel: input.preferredModel,
    }, plan.shots.length);
    const results: Array<{ shotId: string; shotName: string; jobId: string; status: string; error?: string | null }> = [];
    for (const shotPlan of plan.shots) {
      const shot = createShot({ projectId: project.id, name: shotPlan.name, brief: shotPlan.brief });
      const jobInput = buildJobInput(shotPlan, {
        type: input.type,
        projectId: project.id,
        shotId: shot.id,
        referenceSource: plan.referenceSource,
      });
      const { charge } = beginSubmitCharge({
        userId: user.id,
        kind: "video_generation",
        jobInput,
        clientRequestId: input.clientRequestId ? `${input.clientRequestId}:${shot.id}` : undefined,
        // The whole plan was approved as one submission by assertBatchAffordable above.
        guard: "batch_member",
      });
      let job = createJob({ kind: "video_generation", title: `${project.name} · ${shot.name}`, request: jobInput, userId: user.id });
      attachJobToCharge(charge.id, job.id);
      assignJobToShot(shot.id, job.id);
      try {
        const prepared = await prepareJobInput("video_generation", jobInput);
        const submitted = await submitJob("video_generation", prepared, { videoProviderMode: effectiveProviderMode });
        job = updateJobRemote(job.id, {
          providerJobId: submitted.providerJobId,
          status: submitted.initialStatus,
          provider: submitted.provider,
          requestId: submitted.requestId,
          error: null,
          details: {
            ...(submitted.details || {}),
            creationAction: "quick_creation",
            quickProjectId: project.id,
            quickShotId: shot.id,
            requestedProviderMode: effectiveProviderMode,
          },
        })!;
      } catch (error) {
        failSubmitCharge(charge.id, describeError(error), job.id);
        job = updateJobRemote(job.id, {
          status: "failed",
          error: describeError(error),
          details: {
            creationAction: "quick_creation",
            quickProjectId: project.id,
            quickShotId: shot.id,
            requestedProviderMode: effectiveProviderMode,
          },
        })!;
      }
      results.push({ shotId: shot.id, shotName: shot.name, jobId: job.id, status: job.status, error: job.error });
    }

    const submitted = results.filter(item => item.status !== "failed").length;
    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      summary: plan.summary,
      providerMode: effectiveProviderMode,
      shots: results,
      submitted,
      failed: results.length - submitted,
    }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

function buildJobInput(shotPlan: ReturnType<typeof buildQuickCreationPlan>["shots"][number], quickCreation?: {
  type: string;
  projectId: string;
  shotId: string;
  referenceSource: string;
}) {
  return {
    prompt: shotPlan.prompt,
    recipeId: shotPlan.recipeId,
    jobType: shotPlan.jobType,
    medias: shotPlan.medias,
    aspectRatio: shotPlan.aspectRatio,
    duration: shotPlan.duration,
    resolution: "1080P",
    model: shotPlan.model || (shotPlan.duration > 15 || shotPlan.duration < 3 ? "wan3.0" : "happyhorse-1.1"),
    n: 1,
    _subjectCardIds: shotPlan.subjectCardIds,
    ...(quickCreation ? { _quickCreation: quickCreation } : {}),
  };
}

async function preflightQuickPlan(plan: ReturnType<typeof buildQuickCreationPlan>, providerMode: VideoProviderMode) {
  const first = plan.shots[0];
  if (!first) throw new Error("没有生成出可执行的镜头计划");
  const prepared = await prepareJobInput("video_generation", buildJobInput(first));
  validateJobInput("video_generation", prepared);

  const yike = getYikeRuntimeConfig();
  const yikeReady = Boolean(yike.accessKeyId && yike.accessKeySecret);
  const modelStudioCompatible = canUseModelStudio(prepared as any);

  if (providerMode === "modelstudio" && !modelStudioCompatible) {
    throw new Error("当前图片无法通过强制百炼线路读取。请换一张公网图片、重新选择素材，或把本次生成线路切回自动路由。作品还没有创建，不会留下失败任务。");
  }
  if (providerMode === "auto" && !modelStudioCompatible && !yikeReady) {
    throw new Error("当前图片与已配置的视频服务不兼容。请换一张公网图片，或在设置中补充万镜一刻后再试。作品还没有创建，不会留下失败任务。");
  }
}

function assertQuickGenerationReady(usesLocalInput: boolean, providerMode: VideoProviderMode) {
  const modelStudio = getModelStudioRuntimeConfig();
  const yike = getYikeRuntimeConfig();
  const modelStudioReady = Boolean(modelStudio.apiKey);
  const yikeReady = Boolean(yike.accessKeyId && yike.accessKeySecret);

  if (providerMode === "modelstudio" && modelStudio.blockedReason) {
    throw new Error(`当前百炼配置不能用于 Wanke 服务端直连：${modelStudio.blockedReason} 请先到设置清除或更换，作品还没有创建。`);
  }
  if (providerMode === "modelstudio" && !modelStudioReady) {
    throw new Error("本次已强制使用百炼，但百炼 Pay-As-You-Go API Key 尚未配置。请先到设置完成配置。");
  }
  if (providerMode === "yike" && !yikeReady) {
    throw new Error("本次已强制使用万镜一刻，但 AccessKey 尚未配置。请先到设置完成配置。");
  }
  if (providerMode === "auto" && !modelStudioReady && !yikeReady) {
    throw new Error("还没有可用的视频生成服务。请先到设置完成一次 API 配置，再开始创作。");
  }
  if (usesLocalInput && (!modelStudioReady || providerMode === "yike")) {
    throw new Error("当前线路暂不支持直接读取本机图片。请改用素材库图片或公网图片链接，或者选择百炼/自动路由。");
  }
}

function inferredProjectName(goal: string, type: z.infer<typeof schema>["type"]) {
  const compact = goal.replace(/\s+/g, " ").trim();
  const firstClause = compact.split(/[。！？!?；;\n]/)[0]?.replace(/^[“”"']+|[“”"']+$/g, "").trim() || "";
  if (firstClause) return firstClause.length > 26 ? `${firstClause.slice(0, 26)}…` : firstClause;
  return type === "text_video" ? "文字生视频" : type === "product_ad" ? "产品广告" : type === "person_short" ? "人物短片" : "图片动起来";
}
