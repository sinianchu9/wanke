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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  type: z.enum(["product_ad", "person_short", "image_video"]),
  name: z.string().max(120).default(""),
  goal: z.string().trim().min(1).max(1200),
  platform: z.enum(["douyin", "xiaohongshu", "youtube", "landscape"]),
  totalDuration: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  providerMode: z.enum(["auto", "modelstudio", "yike"]).optional(),
  subjectId: z.string().min(1).nullable().optional(),
  imageAssetId: z.string().min(1).nullable().optional(),
  referenceUrl: z.string().trim().max(2048).optional().default(""),
  localInputRef: z.string().trim().max(240).optional().default(""),
}).superRefine((value, ctx) => {
  const directCount = [value.imageAssetId, value.referenceUrl, value.localInputRef].filter(Boolean).length;
  if (directCount > 1) {
    ctx.addIssue({ code: "custom", message: "一次快速创作只能使用一种直接图片来源，请保留素材库图片、本地图片或公网链接中的一种" });
    return;
  }
  if (value.type === "image_video") {
    if (value.subjectId) ctx.addIssue({ code: "custom", path: ["subjectId"], message: "图片变视频不需要人物或产品主体" });
    if (directCount !== 1) ctx.addIssue({ code: "custom", message: "图片变视频需要选择、上传或粘贴一张图片" });
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
  try {
    const input = schema.parse(await request.json());
    const effectiveProviderMode = input.providerMode ?? getVideoProviderMode();
    assertQuickGenerationReady(Boolean(input.localInputRef), effectiveProviderMode);
    const plan = buildQuickCreationPlan({ ...input, name: input.name || inferredProjectName(input.goal, input.type) });
    await preflightQuickPlan(plan, effectiveProviderMode);

    const project = createProject({ name: plan.projectName, description: plan.projectDescription });
    if (input.subjectId) setProjectSubjects(project.id, [input.subjectId]);
    if (plan.shots.length > 1) setProjectTransitionSettings({ projectId: project.id, transitionType: "fade", duration: 0.5 });

    const results: Array<{ shotId: string; shotName: string; jobId: string; status: string; error?: string | null }> = [];
    for (const shotPlan of plan.shots) {
      const shot = createShot({ projectId: project.id, name: shotPlan.name, brief: shotPlan.brief });
      const jobInput = buildJobInput(shotPlan, {
        type: input.type,
        projectId: project.id,
        shotId: shot.id,
        referenceSource: plan.referenceSource,
      });
      let job = createJob({ kind: "video_generation", title: `${project.name} · ${shot.name}`, request: jobInput });
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
    model: "happyhorse-1.1",
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
  return type === "product_ad" ? "产品广告" : type === "person_short" ? "人物短视频" : "图片变视频";
}
