import "server-only";
import { z } from "zod";

export const videoExtensionSchema = z.object({
  sourceUrl: z.string().url("延长视频需要可访问的云端视频 URL").refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "延长视频只接受 HTTP/HTTPS 视频 URL"),
  prompt: z.string().trim().min(1, "请描述延长后接下来发生什么").max(5000),
  sourceDuration: z.coerce.number().int().min(2).max(10),
  targetDuration: z.coerce.number().int().min(3).max(15),
  resolution: z.enum(["720P", "1080P"]).default("1080P"),
  sourceJobId: z.string().min(1),
  sourceOutputIndex: z.coerce.number().int().min(0).default(0),
}).superRefine((value, ctx) => {
  if (value.targetDuration <= value.sourceDuration) {
    ctx.addIssue({
      code: "custom",
      path: ["targetDuration"],
      message: `最终总时长必须大于原视频 ${value.sourceDuration} 秒`,
    });
  }
});

export type VideoExtensionInput = z.infer<typeof videoExtensionSchema>;

export function validateVideoExtensionInput(input: unknown) {
  return videoExtensionSchema.parse(input);
}
