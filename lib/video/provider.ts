import "server-only";
import type { JobKind, StoredJob } from "@/lib/types";
import { validateJobInput } from "@/lib/yike/schemas";
import { refreshJob as refreshYikeJob, resumeStoryboard, submitJob as submitYikeJob } from "@/lib/yike/jobs";
import { canUseModelStudio, refreshModelStudioVideo, submitModelStudioVideo } from "@/lib/video/modelstudio";

export { resumeStoryboard };

export async function submitJob(kind: JobKind, rawInput: unknown) {
  if (kind !== "video_generation") return submitYikeJob(kind, rawInput);

  const input = validateJobInput(kind, rawInput) as any;
  if (canUseModelStudio(input)) return submitModelStudioVideo(input);

  const submitted = await submitYikeJob(kind, input);
  return {
    ...submitted,
    details: {
      ...(submitted.details || {}),
      engine: "yike-fallback",
      routeReason: "百炼 Model Studio API Key 未配置，或素材暂时只有 Yike MediaId；自动回退现有 Yike 生成链路",
    },
  };
}

export async function refreshJob(job: StoredJob) {
  if (job.kind === "video_generation" && job.details?.engine === "modelstudio") {
    return refreshModelStudioVideo(job);
  }
  return refreshYikeJob(job);
}
