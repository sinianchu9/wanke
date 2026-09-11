import "server-only";
import { getAsset } from "@/lib/repository";
import { getSubjectCard } from "@/lib/subjects";
import { isLocalInputRef } from "@/lib/video/local-input";

export type QuickCreationType = "text_video" | "product_ad" | "person_short" | "image_video";
export type QuickPlatform = "douyin" | "xiaohongshu" | "youtube" | "landscape" | "square";

export type QuickCreationInput = {
  type: QuickCreationType;
  name: string;
  goal: string;
  platform: QuickPlatform;
  totalDuration: number;
  subjectId?: string | null;
  imageAssetId?: string | null;
  referenceUrl?: string | null;
  localInputRef?: string | null;
  preferredModel?: "auto" | "wan3.0" | "happyhorse-1.1" | string | null;
};

export type QuickShotPlan = {
  name: string;
  brief: string;
  prompt: string;
  jobType: "text_to_video" | "image_to_video" | "reference_to_video";
  recipeId: "general" | "product_ad" | "character_consistency" | "social_short";
  duration: number;
  aspectRatio: "9:16" | "16:9" | "3:4" | "1:1";
  medias: Array<{ type: "image"; url: string; mediaId: string }>;
  subjectCardIds: string[];
  model: "wan3.0" | "happyhorse-1.1";
};

type ResolvedReference = {
  medias: Array<{ type: "image"; url: string; mediaId: string }>;
  subjectCardIds: string[];
  source: "none" | "subject" | "asset" | "url" | "local";
};

export function buildQuickCreationPlan(input: QuickCreationInput) {
  const cleanName = input.name.trim() || defaultName(input.type);
  const cleanGoal = input.goal.trim();
  if (!cleanGoal) throw new Error("请用一句话说明你希望视频表达什么");
  const aspectRatio: "9:16" | "16:9" | "3:4" | "1:1" =
    input.platform === "youtube" || input.platform === "landscape" ? "16:9"
    : input.platform === "xiaohongshu" ? "3:4"
    : input.platform === "square" ? "1:1"
    : "9:16";

  const reference = resolveReference(input);
  const total = Math.max(2, Math.min(30, Math.round(Number(input.totalDuration) || 5)));

  const rawModel = String(input.preferredModel || "auto").trim().toLowerCase();
  const prefersWan = rawModel.includes("wan");
  const prefersHh = rawModel.includes("happyhorse");

  let shotDurations: number[];
  let shotModel: "wan3.0" | "happyhorse-1.1";

  if (prefersWan) {
    // 用户指定 Wan 3.0：原生单镜头支持单次 2–30 秒直出
    shotDurations = [total];
    shotModel = "wan3.0";
  } else if (prefersHh) {
    // 用户指定 HappyHorse 1.1：单镜头最大上限为 15 秒（3–15 秒）
    shotModel = "happyhorse-1.1";
    if (total <= 15) {
      // 15 秒及以内：支持单镜头直出
      shotDurations = [Math.max(3, total)];
    } else {
      // 超过 15 秒（16–30 秒）：HappyHorse 无法单镜头直出，需要做多镜头智能分段兼容，
      // 确保每个镜头时长均在 3–15 秒以内，由项目自动无缝衔接
      if (total <= 20) {
        const d1 = Math.floor(total / 2);
        shotDurations = [d1, total - d1];
      } else if (total <= 26) {
        const d = Math.floor(total / 2);
        shotDurations = [d, total - d];
      } else {
        // 27–30 秒：若 30 秒则拆为 15s + 15s 或 10s + 10s + 10s
        const d1 = Math.floor(total / 2);
        shotDurations = [d1, total - d1];
      }
    }
  } else {
    // 智能自适应 auto：
    if (total > 15 || total < 3) {
      shotDurations = [total];
      shotModel = "wan3.0";
    } else {
      shotDurations = [total];
      shotModel = "happyhorse-1.1";
    }
  }

  const blueprints = blueprintsFor(input.type, shotDurations.length);

  const shots: QuickShotPlan[] = blueprints.map((blueprint, index) => ({
    name: `Shot ${String(index + 1).padStart(2, "0")} · ${blueprint.name}`,
    brief: blueprint.brief,
    prompt: buildPrompt(input.type, cleanGoal, blueprint.prompt),
    jobType: input.type === "text_video" ? "text_to_video" : input.type === "image_video" ? "image_to_video" : "reference_to_video",
    recipeId: input.type === "text_video" ? "general" : input.type === "product_ad" ? "product_ad" : input.type === "person_short" ? "character_consistency" : "social_short",
    duration: shotDurations[index],
    aspectRatio,
    medias: reference.medias,
    subjectCardIds: reference.subjectCardIds,
    model: shotModel,
  }));

  const modelLabel = shotModel === "wan3.0" ? "Wan 3.0" : "HappyHorse 1.1";
  const modeLabel = shots.length > 1 ? `${shots.length} 镜头分段兼容合成` : "单镜头直出";

  return {
    projectName: cleanName,
    projectDescription: `${quickTypeLabel(input.type)} · ${platformLabel(input.platform)} · 目标 ${total} 秒 (${modelLabel} · ${modeLabel})\n${cleanGoal}`,
    shots,
    referenceSource: reference.source,
    summary: `${quickTypeLabel(input.type)} · 目标 ${total} 秒 · ${modelLabel} (${modeLabel}) · ${aspectRatio} · ${platformLabel(input.platform)}`,
  };
}

function resolveReference(input: QuickCreationInput): ResolvedReference {
  if (input.type === "text_video") {
    if (input.subjectId || input.imageAssetId || input.referenceUrl || input.localInputRef) {
      throw new Error("纯文字生成不使用参考素材，请清除主体、图片或链接后再试");
    }
    return { medias: [], subjectCardIds: [], source: "none" };
  }

  if (input.subjectId) {
    if (input.type === "image_video") throw new Error("图片变视频不使用人物或产品主体，请直接选择一张图片");
    const card = getSubjectCard(input.subjectId);
    if (!card) throw new Error("所选主体已经不存在，请重新选择");
    if (input.type === "product_ad" && card.subjectType !== "product") throw new Error("产品广告只能选择产品主体");
    if (input.type === "person_short" && card.subjectType !== "person") throw new Error("人物短片只能选择人物主体");
    const assets = card.assetIds.map(id => getAsset(id)).filter(Boolean).slice(0, 5);
    if (!assets.length) throw new Error("所选主体没有可用参考图片，请换一个主体或本次直接使用一张图片");
    if (assets.some(asset => asset!.mediaType !== "image")) throw new Error("所选主体包含无效参考素材，请换一个主体或本次直接使用一张图片");
    return {
      medias: assets.map(asset => mediaFromAsset(asset!)),
      subjectCardIds: [card.id],
      source: "subject",
    };
  }

  return resolveSingleImage(input);
}

function resolveSingleImage(input: QuickCreationInput): ResolvedReference {
  if (input.localInputRef) {
    if (!isLocalInputRef(input.localInputRef)) throw new Error("本次上传的图片引用无效，请重新选择图片");
    return {
      medias: [{ type: "image", url: input.localInputRef, mediaId: "" }],
      subjectCardIds: [],
      source: "local",
    };
  }

  if (input.imageAssetId) {
    const asset = getAsset(input.imageAssetId);
    if (!asset) throw new Error("所选图片素材已经不存在，请重新选择");
    if (asset.mediaType !== "image") throw new Error("快速创作这里只接受图片素材");
    return { medias: [mediaFromAsset(asset)], subjectCardIds: [], source: "asset" };
  }

  const url = String(input.referenceUrl || "").trim();
  if (url) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("图片链接无效，请使用可公开访问的 HTTP/HTTPS 图片直链"); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("图片链接必须是 HTTP/HTTPS 公网地址");
    return {
      medias: [{ type: "image", url, mediaId: "" }],
      subjectCardIds: [],
      source: "url",
    };
  }

  if (input.type === "product_ad") throw new Error("请选择一个产品，或本次直接提供一张产品图片");
  if (input.type === "person_short") throw new Error("请选择一个人物，或本次直接提供一张人物图片");
  throw new Error("请选择、上传或粘贴一张要动起来的图片");
}

function mediaFromAsset(asset: NonNullable<ReturnType<typeof getAsset>>) {
  return { type: "image" as const, url: asset.sourceUrl, mediaId: asset.providerMediaId || "" };
}

function blueprintsFor(type: QuickCreationType, count: number) {
  const sets = {
    text_video: [
      { name: "文字生视频", brief: "从文字直接建立主体、环境和氛围", prompt: "根据文字描述直接建立清晰主体、环境、时间、光线与整体视觉风格，画面连贯自然，镜头平稳推进，不依赖任何参考素材" },
      { name: "推进动作", brief: "让主体完成主要动作", prompt: "延续前一镜头的主体和场景，让主要动作自然推进，镜头运动保持单一明确" },
      { name: "丰富层次", brief: "增加环境或镜头层次", prompt: "在不改变核心主体和场景设定的前提下，通过景别、环境动态或视角变化增加画面层次" },
      { name: "自然收尾", brief: "形成完整且稳定的结尾", prompt: "让动作自然结束并形成清晰稳定的收尾画面，保持整体风格和主体设定连续" },
    ],
    product_ad: [
      { name: "产品广告", brief: "聚焦产品展示与核心卖点", prompt: "以产品为核心视觉主体，清楚稳定展示产品外观、结构、颜色和材质，围绕核心卖点直观表达，运镜平稳流畅，构图高级富有质感，避免产品变形" },
      { name: "产品展示", brief: "稳定展示外观和材质", prompt: "清楚展示产品外观、结构、颜色和材质，镜头缓慢移动，避免产品变形" },
      { name: "卖点表达", brief: "只突出一个核心卖点", prompt: "围绕用户给出的核心卖点做直观视觉表达，信息集中，不堆叠多个卖点" },
      { name: "收尾定格", brief: "形成可作为广告结尾的主视觉", prompt: "以稳定、干净的产品主视觉收尾，构图适合品牌广告结尾" },
    ],
    person_short: [
      { name: "人物短片", brief: "人物自然动作与真实场景", prompt: "人物自然出镜，脸部、发型、服装和体型保持与参考高度一致，动作自然流畅连贯，镜头运动平稳跟随，环境氛围自然真实" },
      { name: "主要动作", brief: "完成一个自然动作", prompt: "人物完成一个自然、明确的主要动作，动作幅度适中，避免快速旋转和大面积遮挡" },
      { name: "互动镜头", brief: "人物与镜头或环境产生互动", prompt: "人物与镜头或环境产生简单互动，表情和身份稳定，镜头运动克制" },
      { name: "自然收尾", brief: "留下可继续延展的结尾", prompt: "人物自然结束动作并保持身份稳定，结尾干净，方便继续创作或成片" },
    ],
    image_video: [
      { name: "图片动起来", brief: "保持原图主体，增加自然运动", prompt: "严格保持输入图片的主体外观和构图基础，只增加自然动作、环境变化和单一镜头运动" },
      { name: "继续运动", brief: "延续同一视觉方向", prompt: "延续参考图的主体与视觉风格，动作连续，避免重新设计主体" },
      { name: "变化镜头", brief: "增加一个轻微镜头变化", prompt: "保持主体不变，通过轻微推近、环绕或环境动态增加层次" },
      { name: "稳定收尾", brief: "回到稳定主视觉", prompt: "动作逐渐稳定，以清晰主视觉收尾，不改变主体身份和结构" },
    ],
  } as const;
  return [...sets[type]].slice(0, count);
}

function buildPrompt(type: QuickCreationType, goal: string, shotInstruction: string) {
  const identity = type === "text_video"
    ? "严格围绕文字描述建立主体、环境和视觉关系，不依赖任何参考素材"
    : type === "product_ad"
      ? "产品结构、颜色、材质、标志保持稳定"
      : type === "person_short"
        ? "人物脸部、发型、年龄感、体型和主要服装保持一致"
        : "保持输入图片中的主体外观、结构和画面关系";
  return `${goal}。本镜头：${shotInstruction}。${identity}。动作自然连续，画面不要出现无意义突变。`;
}

function defaultName(type: QuickCreationType) {
  return type === "text_video" ? "文字生视频" : type === "product_ad" ? "产品广告" : type === "person_short" ? "人物短片" : "图片动起来";
}

function quickTypeLabel(type: QuickCreationType) {
  return type === "text_video" ? "文字生视频" : type === "product_ad" ? "产品广告" : type === "person_short" ? "人物短片" : "图片动起来";
}

function platformLabel(platform: QuickPlatform) {
  return platform === "douyin" ? "抖音竖屏 (9:16)"
    : platform === "xiaohongshu" ? "小红书 (3:4)"
    : platform === "youtube" ? "YouTube (16:9)"
    : platform === "square" ? "方形画幅 (1:1)"
    : "通用横屏 (16:9)";
}
