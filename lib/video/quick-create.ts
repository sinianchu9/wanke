import "server-only";
import { getAsset } from "@/lib/repository";
import { getSubjectCard } from "@/lib/subjects";

export type QuickCreationType = "product_ad" | "person_short" | "image_video";
export type QuickPlatform = "douyin" | "xiaohongshu" | "youtube" | "landscape";

export type QuickCreationInput = {
  type: QuickCreationType;
  name: string;
  goal: string;
  platform: QuickPlatform;
  totalDuration: 5 | 10 | 15 | 30;
  subjectId?: string | null;
  imageAssetId?: string | null;
};

export type QuickShotPlan = {
  name: string;
  brief: string;
  prompt: string;
  jobType: "image_to_video" | "reference_to_video";
  recipeId: "product_ad" | "character_consistency" | "social_short";
  duration: 5 | 10;
  aspectRatio: "9:16" | "16:9";
  medias: Array<{ type: "image"; url: string; mediaId: string }>;
  subjectCardIds: string[];
};

export function buildQuickCreationPlan(input: QuickCreationInput) {
  const cleanName = input.name.trim() || defaultName(input.type);
  const cleanGoal = input.goal.trim();
  if (!cleanGoal) throw new Error("请用一句话说明你希望视频表达什么");
  const aspectRatio = input.platform === "youtube" || input.platform === "landscape" ? "16:9" as const : "9:16" as const;

  const reference = resolveReference(input);
  const shotDurations: Array<5 | 10> = input.totalDuration === 5 ? [5]
    : input.totalDuration === 10 ? [5, 5]
      : input.totalDuration === 15 ? [5, 5, 5]
        : [10, 10, 5, 5];
  const blueprints = blueprintsFor(input.type, shotDurations.length);

  const shots: QuickShotPlan[] = blueprints.map((blueprint, index) => ({
    name: `Shot ${String(index + 1).padStart(2, "0")} · ${blueprint.name}`,
    brief: blueprint.brief,
    prompt: buildPrompt(input.type, cleanGoal, blueprint.prompt),
    jobType: input.type === "image_video" ? "image_to_video" : "reference_to_video",
    recipeId: input.type === "product_ad" ? "product_ad" : input.type === "person_short" ? "character_consistency" : "social_short",
    duration: shotDurations[index],
    aspectRatio,
    medias: reference.medias,
    subjectCardIds: reference.subjectCardIds,
  }));

  return {
    projectName: cleanName,
    projectDescription: `${quickTypeLabel(input.type)} · ${platformLabel(input.platform)} · 目标 ${input.totalDuration} 秒\n${cleanGoal}`,
    shots,
    summary: `${quickTypeLabel(input.type)} · ${shots.length} 个镜头 · 目标 ${input.totalDuration} 秒 · ${aspectRatio} · ${platformLabel(input.platform)}`,
  };
}

function resolveReference(input: QuickCreationInput) {
  if (input.type === "image_video") {
    const asset = input.imageAssetId ? getAsset(input.imageAssetId) : null;
    if (!asset) throw new Error("图片变视频需要先选择一张图片素材");
    if (asset.mediaType !== "image") throw new Error("图片变视频只能选择图片素材");
    return { medias: [mediaFromAsset(asset)], subjectCardIds: [] as string[] };
  }

  const card = input.subjectId ? getSubjectCard(input.subjectId) : null;
  if (!card) throw new Error(input.type === "product_ad" ? "产品广告需要先选择一个产品主体" : "人物短视频需要先选择一个人物主体");
  if (input.type === "product_ad" && card.subjectType !== "product") throw new Error("产品广告只能选择产品主体卡");
  if (input.type === "person_short" && card.subjectType !== "person") throw new Error("人物短视频只能选择人物主体卡");
  const assets = card.assetIds.map(id => getAsset(id)).filter(Boolean).slice(0, 5);
  if (!assets.length) throw new Error("所选主体卡没有可用参考图片");
  if (assets.some(asset => asset!.mediaType !== "image")) throw new Error("主体卡包含非图片素材，请先修复主体卡");
  return {
    medias: assets.map(asset => mediaFromAsset(asset!)),
    subjectCardIds: [card.id],
  };
}

function mediaFromAsset(asset: NonNullable<ReturnType<typeof getAsset>>) {
  return { type: "image" as const, url: asset.sourceUrl, mediaId: asset.providerMediaId || "" };
}

function blueprintsFor(type: QuickCreationType, count: number) {
  const sets = {
    product_ad: [
      { name: "开场吸引", brief: "第一秒建立产品和氛围", prompt: "开场立即让产品成为视觉主体，用简洁有冲击力的构图建立高级感" },
      { name: "产品展示", brief: "稳定展示外观和材质", prompt: "清楚展示产品外观、结构、颜色和材质，镜头缓慢移动，避免产品变形" },
      { name: "卖点表达", brief: "只突出一个核心卖点", prompt: "围绕用户给出的核心卖点做直观视觉表达，信息集中，不堆叠多个卖点" },
      { name: "收尾定格", brief: "形成可作为广告结尾的主视觉", prompt: "以稳定、干净的产品主视觉收尾，构图适合品牌广告结尾" },
    ],
    person_short: [
      { name: "人物亮相", brief: "快速建立人物身份", prompt: "第一秒明确人物身份与环境，脸部、发型、服装和体型保持与参考一致" },
      { name: "主要动作", brief: "完成一个自然动作", prompt: "人物完成一个自然、明确的主要动作，动作幅度适中，避免快速旋转和大面积遮挡" },
      { name: "互动镜头", brief: "人物与镜头或环境产生互动", prompt: "人物与镜头或环境产生简单互动，表情和身份稳定，镜头运动克制" },
      { name: "自然收尾", brief: "留下可继续延展的结尾", prompt: "人物自然结束动作并保持身份稳定，结尾干净，方便继续创作或成片" },
    ],
    image_video: [
      { name: "图片动起来", brief: "保持原图主体，只增加自然运动", prompt: "严格保持输入图片的主体外观和构图基础，只增加自然动作、环境变化和单一镜头运动" },
      { name: "继续运动", brief: "延续同一视觉方向", prompt: "延续参考图的主体与视觉风格，动作连续，避免重新设计主体" },
      { name: "变化镜头", brief: "增加一个轻微镜头变化", prompt: "保持主体不变，通过轻微推近、环绕或环境动态增加层次" },
      { name: "稳定收尾", brief: "回到稳定主视觉", prompt: "动作逐渐稳定，以清晰主视觉收尾，不改变主体身份和结构" },
    ],
  } as const;
  return [...sets[type]].slice(0, count);
}

function buildPrompt(type: QuickCreationType, goal: string, shotInstruction: string) {
  const identity = type === "product_ad"
    ? "产品结构、颜色、材质、标志保持稳定"
    : type === "person_short"
      ? "人物脸部、发型、年龄感、体型和主要服装保持一致"
      : "保持输入图片中的主体外观、结构和画面关系";
  return `${goal}。本镜头：${shotInstruction}。${identity}。动作自然连续，画面不要出现无意义突变。`;
}

function defaultName(type: QuickCreationType) {
  return type === "product_ad" ? "产品广告" : type === "person_short" ? "人物短视频" : "图片变视频";
}

function quickTypeLabel(type: QuickCreationType) {
  return type === "product_ad" ? "产品广告" : type === "person_short" ? "人物短视频" : "图片变视频";
}

function platformLabel(platform: QuickPlatform) {
  return platform === "douyin" ? "抖音 / 竖屏" : platform === "xiaohongshu" ? "小红书 / 竖屏" : platform === "youtube" ? "YouTube / 横屏" : "横屏通用";
}
