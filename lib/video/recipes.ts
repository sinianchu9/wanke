export type VideoMode = "text_to_video" | "image_to_video" | "first_last_frame" | "reference_to_video";
export type VideoRecipeId = "general" | "product_ad" | "character_consistency" | "cinematic" | "social_short";

export type VideoRecipe = {
  id: VideoRecipeId;
  label: string;
  summary: string;
  useWhen: string;
  notFor: string;
  supportedModes: VideoMode[];
  defaultAspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  defaultDuration: 5 | 10 | 15;
  executionGuidance: string;
  demoInput: string;
  demoOutput: string;
};

export const VIDEO_RECIPES: VideoRecipe[] = [
  {
    id: "general",
    label: "通用镜头",
    summary: "不强加商业或人物策略，只整理主体、动作、环境和镜头。",
    useWhen: "需求还比较自由，或暂时不确定属于哪一类视频。",
    notFor: "明确要求产品卖点、人物长期一致或短视频节奏时，优先选择对应预设。",
    supportedModes: ["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"],
    defaultAspectRatio: "16:9",
    defaultDuration: 5,
    executionGuidance: "保持用户核心内容不变，主体清楚，动作连续，镜头运动单一明确，避免无意义的主体变形和突变",
    demoInput: "一辆黑色跑车晚上经过城市街道",
    demoOutput: "黑色跑车在夜间城市街道平稳驶过，湿润路面反射霓虹灯光，镜头低机位侧向跟拍，车辆结构保持稳定，运动自然连续，电影感光影。",
  },
  {
    id: "product_ad",
    label: "产品广告",
    summary: "优先保证产品结构、颜色、标志和卖点表达，避免产品在运动中变形。",
    useWhen: "电商广告、新品展示、产品主视觉、商品动态展示。",
    notFor: "纯剧情、纯人物表演或需要大幅改变参考产品结构的创意。",
    supportedModes: ["text_to_video", "image_to_video", "reference_to_video"],
    defaultAspectRatio: "9:16",
    defaultDuration: 5,
    executionGuidance: "产品必须是视觉主体，结构、颜色、材质和标志稳定；优先展示一个清晰卖点，镜头运动克制，避免手指、包装、文字和产品边缘发生畸变",
    demoInput: "黑色智能手环放在桌面上，做一个高级广告",
    demoOutput: "黑色智能手环置于深色极简桌面中央，屏幕和表带结构清晰稳定，柔和轮廓光勾勒材质，镜头缓慢推近并轻微环绕，突出屏幕与表带质感，整体为高端科技产品广告风格。",
  },
  {
    id: "character_consistency",
    label: "人物一致",
    summary: "参考人物身份优先，脸部、发型、服装和体型不要在镜头中漂移。",
    useWhen: "固定人物、数字角色、连续内容、同一人物多个镜头。",
    notFor: "没有人物参考且只想随机生成人物时，没有必要使用。",
    supportedModes: ["image_to_video", "reference_to_video"],
    defaultAspectRatio: "9:16",
    defaultDuration: 5,
    executionGuidance: "把参考人物身份一致性放在第一优先级，保持脸部特征、发型、年龄感、体型和主要服装稳定；动作自然但不要用过大的遮挡、快速旋转或极端运动破坏身份",
    demoInput: "让参考图里的女孩走进咖啡店并回头看镜头",
    demoOutput: "保持参考女孩的脸部、发型、体型和服装一致，她自然走入咖啡店，在门口轻微回头看向镜头，镜头平稳跟随，动作幅度适中，不改变人物身份特征。",
  },
  {
    id: "cinematic",
    label: "电影镜头",
    summary: "强调构图、景深、光线和单一明确的镜头运动。",
    useWhen: "氛围镜头、剧情短镜头、品牌片、电影感 B-roll。",
    notFor: "需要快速展示很多卖点或强信息密度的短视频。",
    supportedModes: ["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"],
    defaultAspectRatio: "16:9",
    defaultDuration: 10,
    executionGuidance: "采用电影化构图和真实光影，景深关系清楚；每个短镜头只使用一种主要镜头运动，主体动作连续自然，避免同时塞入过多事件",
    demoInput: "男人在东京雨夜街头向镜头走来",
    demoOutput: "东京雨夜街头，一名男人从霓虹灯与细雨中朝镜头缓慢走来，湿润路面形成彩色倒影，浅景深，镜头稳定后退跟拍，人物动作自然，电影级低照度光影。",
  },
  {
    id: "social_short",
    label: "短视频主镜头",
    summary: "前几秒快速建立主体和动作，画面信息集中，适合竖屏内容。",
    useWhen: "短视频开场、社媒主镜头、5 秒左右的高辨识度内容。",
    notFor: "需要慢节奏铺垫、复杂剧情或长镜头叙事时。",
    supportedModes: ["text_to_video", "image_to_video", "reference_to_video"],
    defaultAspectRatio: "9:16",
    defaultDuration: 5,
    executionGuidance: "第一秒内明确主体，主要动作简单直接，背景不抢主体；适合竖屏观看，构图中心明确，5 秒内只表达一个核心视觉信息",
    demoInput: "一杯冰咖啡，适合短视频开头",
    demoOutput: "竖屏近景，一杯冰咖啡在第一秒内清晰占据画面中心，冰块与杯壁水珠细节明显，镜头快速但平稳地轻推近，背景简洁虚化，5 秒内只突出清凉与质感。",
  },
];

export function getVideoRecipe(id: unknown) {
  return VIDEO_RECIPES.find(recipe => recipe.id === id) || VIDEO_RECIPES[0];
}

export function recipeSupportsMode(recipeId: unknown, mode: VideoMode) {
  return getVideoRecipe(recipeId).supportedModes.includes(mode);
}

export function applyVideoRecipe(prompt: string, recipeId: unknown) {
  const recipe = getVideoRecipe(recipeId);
  const clean = prompt.trim();
  if (!clean) return clean;
  return `${clean}\n\n生成策略：${recipe.executionGuidance}。`;
}

export function buildTemplateEnhancedPrompt(prompt: string, recipeId: unknown, mode: VideoMode) {
  const recipe = getVideoRecipe(recipeId);
  const clean = prompt.trim();
  const modeHint = mode === "text_to_video"
    ? "画面从文字描述直接建立，主体、环境和镜头动作需要具体。"
    : mode === "image_to_video"
      ? "以输入图片为外观基础，只补充动作、环境变化和镜头运动，不重新设计主体。"
      : mode === "first_last_frame"
        ? "首帧与尾帧已经决定开始和结束状态，重点描述中间如何自然连续地过渡。"
        : "参考素材决定人物、产品或场景身份，提示词重点描述动作、关系、环境和镜头。";
  return `${clean}。${modeHint}${recipe.executionGuidance}。`;
}
