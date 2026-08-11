import { z } from "zod";
import type { JobKind } from "@/lib/types";

const ratio = z.enum(["16:9", "9:16", "4:3", "3:4", "1:1"]);
const standardRatio = z.enum(["16:9", "9:16", "4:3", "3:4"]);
const resolution = z.enum(["720P", "1080P"]);

function isKnownLandingPageUrl(value: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname === "ibb.co" || url.hostname === "www.ibb.co";
  } catch {
    return false;
  }
}

const mediaRef = z.object({
  type: z.enum(["image", "video", "audio"]),
  url: z.string().url().optional().or(z.literal("")),
  mediaId: z.string().optional().default(""),
}).superRefine((value, ctx) => {
  if (!value.url && !value.mediaId) {
    ctx.addIssue({ code: "custom", message: "参考素材至少需要 URL 或 MediaId" });
    return;
  }
  if (value.type === "image" && value.url && isKnownLandingPageUrl(value.url)) {
    ctx.addIssue({
      code: "custom",
      path: ["url"],
      message: "ibb.co 是图片分享页面，不是图片文件直链。请使用 i.ibb.co/...jpg/png 直链，或把图片上传到 Wanke 素材库后再选择。",
    });
  }
});
const idList = z.array(z.string().min(1)).max(20).default([]);
const expert = z.record(z.string(), z.unknown()).optional();

const schemas = {
  video_generation: z.object({
    prompt: z.string().min(1, "请输入提示词"),
    jobType: z.enum(["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"]),
    medias: z.array(mediaRef).max(9).default([]),
    aspectRatio: ratio.default("16:9"),
    duration: z.coerce.number().int().min(4).max(15).default(5),
    resolution: resolution.default("720P"),
    model: z.enum(["wan2.7", "happyhorse-1.1", "happyhorse-1.0"]).default("wan2.7"),
    n: z.coerce.number().int().min(1).max(4).default(1),
    title: z.string().optional(),
    expert,
  }).superRefine((v, ctx) => {
    const count = v.medias.length;
    if (v.jobType === "image_to_video" && count !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["medias"],
        message: `图生视频只允许 1 个参考素材，当前收到 ${count} 个。需要首帧+尾帧请选择“首尾帧”；需要多个参考请选择“多参考”。`,
      });
    }
    if (v.jobType === "image_to_video" && count === 1 && v.medias[0]?.type !== "image") {
      ctx.addIssue({
        code: "custom",
        path: ["medias", 0, "type"],
        message: "让图片动起来需要一张图片，不能使用视频或音频作为首帧。",
      });
    }
    if (v.jobType === "first_last_frame" && count !== 2) {
      ctx.addIssue({
        code: "custom",
        path: ["medias"],
        message: `首尾帧模式必须恰好 2 张图片（首帧 + 尾帧），当前收到 ${count} 个。`,
      });
    }
    if (v.jobType === "first_last_frame" && count === 2 && v.medias.some(media => media.type !== "image")) {
      ctx.addIssue({
        code: "custom",
        path: ["medias"],
        message: "首尾画面必须都是图片，不能混入视频或音频。",
      });
    }
    if (v.jobType === "reference_to_video" && (count < 1 || count > 9)) {
      ctx.addIssue({
        code: "custom",
        path: ["medias"],
        message: `多参考模式需要 1-9 个参考素材，当前收到 ${count} 个。`,
      });
    }
    if (v.jobType === "text_to_video" && count !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["medias"],
        message: `文生视频不使用参考素材，当前仍有 ${count} 个。请删除参考素材或切换生成模式。`,
      });
    }
  }),

  video_analysis: z.object({
    sourceUrl: z.string().url("请输入可访问的视频 URL"),
    productName: z.string().optional().default(""),
    brandName: z.string().optional().default(""),
    sellingPoints: z.array(z.string()).max(20).default([]),
    title: z.string().optional(),
    expert,
  }),

  remake_script: z.object({
    comprehensionResult: z.string().url("请选择视频拆解结果 JSON URL"),
    remakeType: z.string().default("faithful-remake"),
    originalProductName: z.string().optional().default(""),
    productName: z.string().optional().default(""),
    productDescription: z.string().optional().default(""),
    productImages: z.array(z.string().url()).max(20).default([]),
    productKnowledge: z.string().optional().default(""),
    originalAvatarName: z.string().optional().default(""),
    newAvatarImages: z.array(z.string().url()).max(10).default([]),
    voiceoverLanguage: z.string().default("zh"),
    title: z.string().optional(),
    expert,
  }),

  video_render: z.object({
    scriptUrl: z.string().url().optional().or(z.literal("")),
    scriptJson: z.string().optional().default(""),
    voiceoverLanguage: z.string().default("zh"),
    resolution: resolution.default("1080P"),
    aspectRatio: standardRatio.default("9:16"),
    ttsVoiceUrl: z.string().url().optional().or(z.literal("")),
    bgmUrl: z.string().url().optional().or(z.literal("")),
    withSubtitles: z.boolean().default(true),
    title: z.string().optional(),
    expert,
  }).superRefine((v, ctx) => {
    if (!v.scriptUrl && !v.scriptJson.trim()) ctx.addIssue({ code: "custom", path: ["scriptUrl"], message: "请选择复刻脚本结果或粘贴 creative/v1 脚本 JSON" });
    if (v.scriptJson.trim()) {
      try { JSON.parse(v.scriptJson); } catch { ctx.addIssue({ code: "custom", path: ["scriptJson"], message: "脚本 JSON 格式无效" }); }
    }
  }),

  video_translation: z.object({
    inputVideoOssUri: z.string().startsWith("oss://", "输入必须是调用账号下的 oss:// 地址"),
    outputOssUri: z.string().startsWith("oss://", "输出目录必须是 oss:// 地址"),
    jobType: z.enum(["SubtitleTranslate", "VoiceTranslate"]).default("VoiceTranslate"),
    sourceLanguage: z.string().min(2).default("zh"),
    targetLanguage: z.string().min(2).default("en"),
    needDetext: z.boolean().default(false),
    needVisualTranslate: z.boolean().default(false),
    title: z.string().optional(),
    description: z.string().optional().default(""),
    expert,
  }),

  video_clone: z.object({
    originalMediaId: z.string().min(1, "请选择原视频"),
    oldProductName: z.string().optional().default(""),
    productName: z.string().optional().default(""),
    userMaterialIds: idList,
    avatarPortrait: z.string().url().optional().or(z.literal("")),
    avatarVoice: z.string().optional().default(""),
    resolution: resolution.default("720P"),
    withSubtitles: z.boolean().default(true),
    title: z.string().optional(),
    expert,
  }),

  avatar_narrator: z.object({
    sceneType: z.enum(["creator-talk", "avatar-broadcast"]).default("creator-talk"),
    textType: z.union([z.literal(1), z.literal(2)]).default(2),
    textContent: z.string().min(1).max(10000),
    userMaterialIds: idList,
    avatarPortrait: z.string().url("请输入可访问的人像 URL"),
    avatarVoice: z.string().optional().default(""),
    voiceDuration: z.coerce.number().int().min(1).max(3600).default(60),
    aspectRatio: standardRatio.default("9:16"),
    resolution: resolution.default("720P"),
    outputLanguages: z.array(z.enum(["CN", "EN", "YUE"])).min(1).default(["CN"]),
    withSubtitles: z.boolean().default(true),
    title: z.string().optional(),
    expert,
  }).superRefine((v, ctx) => {
    if (v.sceneType === "avatar-broadcast" && v.textType === 1) ctx.addIssue({ code: "custom", path: ["textType"], message: "固定数字人口播不支持原始文案自动改写，请使用口播稿" });
    if (v.sceneType === "avatar-broadcast" && v.userMaterialIds.length) ctx.addIssue({ code: "custom", path: ["userMaterialIds"], message: "固定数字人口播不支持用户素材" });
  }),

  voice_narrator: z.object({
    textType: z.union([z.literal(1), z.literal(2)]).default(2),
    textContent: z.string().min(1).max(10000),
    userMaterialIds: idList,
    narrationVoiceId: z.string().default("sys_ElegantProperMiddleAgedWoman"),
    voiceDuration: z.coerce.number().int().min(1).max(3600).default(60),
    aspectRatio: standardRatio.default("16:9"),
    resolution: resolution.default("720P"),
    outputLanguages: z.array(z.enum(["CN", "EN", "YUE"])).min(1).default(["CN"]),
    withSubtitles: z.boolean().default(true),
    targetAspectRatio: z.enum(["9:16", "3:4"]).optional(),
    heading: z.string().optional().default(""),
    subHeading: z.string().optional().default(""),
    date: z.string().optional().default(""),
    watermarkText: z.string().optional().default(""),
    enabledAICover: z.boolean().default(false),
    ipCharacterMediaId: z.string().optional().default(""),
    ipCharacterMediaUrl: z.string().optional().default(""),
    title: z.string().optional(),
    expert,
  }),

  storyboard: z.object({
    fileURL: z.string().url("请输入已上传的 .txt 或 .doc 文件 URL"),
    title: z.string().max(128).optional().default(""),
    execMode: z.enum(["FullPipeline", "StoryboardOnly"]).default("FullPipeline"),
    aspectRatio: standardRatio.default("16:9"),
    resolution: z.enum(["720P", "1080P", "2K", "4K"]).default("1080P"),
    styleId: z.string().default("RealisticPhotography"),
    shotPromptMode: z.enum(["multi", "default"]).default("multi"),
    shotPromptLang: z.string().optional().default("zh-CN"),
    shotSplitMode: z.literal("firstPersonNarration").default("firstPersonNarration"),
    sourceType: z.literal("Novel").default("Novel"),
    narrationVoiceId: z.string().default("sys_YoungGracefulWoman"),
    keepOriginDialogue: z.boolean().default(true),
    needCaption: z.boolean().default(true),
    skipFailureShot: z.boolean().default(true),
    audioEnable: z.boolean().default(true),
    videoModel: z.string().default("wan2.6-r2v-flash"),
    expert,
  }),
} satisfies Record<JobKind, any>;

export function validateJobInput(kind: JobKind, input: unknown) {
  return schemas[kind].parse(input) as Record<string, any>;
}
