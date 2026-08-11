import { NextResponse } from "next/server";
import { z } from "zod";
import { createProject, createShot, assignJobToShot, setProjectSubjects } from "@/lib/projects";
import { createJob, updateJobRemote } from "@/lib/repository";
import { submitJob } from "@/lib/video/provider";
import { prepareJobInput } from "@/lib/video/prepare";
import { buildQuickCreationPlan } from "@/lib/video/quick-create";
import { setProjectTransitionSettings } from "@/lib/video/project-transitions";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  type: z.enum(["product_ad", "person_short", "image_video"]),
  name: z.string().max(120).default(""),
  goal: z.string().trim().min(1).max(1200),
  platform: z.enum(["douyin", "xiaohongshu", "youtube", "landscape"]),
  totalDuration: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  subjectId: z.string().min(1).nullable().optional(),
  imageAssetId: z.string().min(1).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const plan = buildQuickCreationPlan(input);
    const project = createProject({ name: plan.projectName, description: plan.projectDescription });
    if (input.subjectId) setProjectSubjects(project.id, [input.subjectId]);
    if (plan.shots.length > 1) setProjectTransitionSettings({ projectId: project.id, transitionType: "fade", duration: 0.5 });

    const results: Array<{ shotId: string; shotName: string; jobId: string; status: string; error?: string | null }> = [];
    for (const shotPlan of plan.shots) {
      const shot = createShot({ projectId: project.id, name: shotPlan.name, brief: shotPlan.brief });
      const jobInput = {
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
        _quickCreation: { type: input.type, projectId: project.id, shotId: shot.id },
      };
      let job = createJob({ kind: "video_generation", title: `${project.name} · ${shot.name}`, request: jobInput });
      assignJobToShot(shot.id, job.id);
      try {
        const prepared = await prepareJobInput("video_generation", jobInput);
        const submitted = await submitJob("video_generation", prepared);
        job = updateJobRemote(job.id, {
          providerJobId: submitted.providerJobId,
          status: submitted.initialStatus,
          provider: submitted.provider,
          requestId: submitted.requestId,
          error: null,
          details: { ...(submitted.details || {}), creationAction: "quick_creation", quickProjectId: project.id, quickShotId: shot.id },
        })!;
      } catch (error) {
        job = updateJobRemote(job.id, {
          status: "failed",
          error: describeError(error),
          details: { creationAction: "quick_creation", quickProjectId: project.id, quickShotId: shot.id },
        })!;
      }
      results.push({ shotId: shot.id, shotName: shot.name, jobId: job.id, status: job.status, error: job.error });
    }

    const submitted = results.filter(item => item.status !== "failed").length;
    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      summary: plan.summary,
      shots: results,
      submitted,
      failed: results.length - submitted,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
