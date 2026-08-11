import "server-only";
import { z } from "zod";

const referenceImage = z.string().min(1).refine(value => {
  if (value.startsWith("data:image/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "参考图必须是公网图片 URL 或 Wanke 准备的本地图片");

export const videoEditingSchema = z.object({
  sourceUrl: z.string().url("视频编辑需要可访问的云端视频 URL").refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "视频编辑只接受 HTTP/HTTPS 视频 URL"),
  prompt: z.string().trim().min(1, "请描述希望如何编辑整条视频").max(5000),
  sourceDuration: z.coerce.number().int().min(2).max(10),
  referenceImages: z.array(referenceImage).max(4, "Wan 2.7 视频编辑最多接受 4 张参考图片").default([]),
  resolution: z.enum(["720P", "1080P"]).default("1080P"),
  audioSetting: z.enum(["origin", "auto"]).default("origin"),
  sourceJobId: z.string().min(1),
  sourceOutputIndex: z.coerce.number().int().min(0).default(0),
});

export type VideoEditingInput = z.infer<typeof videoEditingSchema>;

export function validateVideoEditingInput(input: unknown) {
  return videoEditingSchema.parse(input);
}
