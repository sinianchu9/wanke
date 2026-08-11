import { NextResponse } from "next/server";
import { z } from "zod";
import { getModelStudioRuntimeConfig } from "@/lib/settings";
import { buildTemplateEnhancedPrompt, getVideoRecipe, recipeSupportsMode } from "@/lib/video/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  prompt: z.string().trim().min(1, "请先输入视频描述").max(5000),
  recipeId: z.enum(["general", "product_ad", "character_consistency", "cinematic", "social_short"]).default("general"),
  jobType: z.enum(["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
  duration: z.coerce.number().int().min(4).max(15),
  referenceCount: z.coerce.number().int().min(0).max(9).default(0),
});

function compatibleBaseUrl() {
  const config = getModelStudioRuntimeConfig();
  if (config.workspaceId) {
    return `https://${config.workspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`;
  }
  const explicit = config.baseUrl?.trim();
  if (!explicit) return "";
  try {
    const url = new URL(explicit);
    return `${url.origin}/compatible-mode/v1`;
  } catch {
    return "";
  }
}

function plainText(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const recipe = getVideoRecipe(input.recipeId);
    if (!recipeSupportsMode(recipe.id, input.jobType)) {
      return NextResponse.json({ error: `生成预设“${recipe.label}”不适用于当前生成方式，请重新选择预设。` }, { status: 400 });
    }
    const fallback = buildTemplateEnhancedPrompt(input.prompt, recipe.id, input.jobType);
    const config = getModelStudioRuntimeConfig();
    const baseUrl = compatibleBaseUrl();

    if (!config.apiKey || !baseUrl) {
      return NextResponse.json({
        prompt: fallback,
        engine: "template",
        recipeId: recipe.id,
        note: "未检测到可用于文本模型的百炼 API Key + Workspace/专属 Base URL，已使用本地生成预设整理。",
      });
    }

    const system = [
      "你是 AI 视频生成提示词编辑器，只负责把用户原始描述整理成更清晰的单镜头视频提示词。",
      "必须保留用户事实，不虚构品牌、人物身份、产品型号、文字内容或额外剧情。",
      "输出只包含最终提示词，不要解释，不要标题，不要 Markdown。",
      "提示词优先明确：主体、动作、环境、镜头运动、光线/质感；不要同时加入互相冲突的镜头运动。",
      "如果有参考素材，参考素材负责主体外观，提示词不要重新设计主体。",
      "控制在 220 个中文字符左右；用户原描述已经清楚时只做轻量整理。",
    ].join("\n");

    const user = [
      `生成预设：${recipe.label}`,
      `预设边界：${recipe.summary}`,
      `生成方式：${input.jobType}`,
      `画幅：${input.aspectRatio}`,
      `时长：${input.duration} 秒`,
      `参考素材数量：${input.referenceCount}`,
      `稳定要求：${recipe.executionGuidance}`,
      `用户原始描述：${input.prompt}`,
    ].join("\n");

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen-plus",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.35,
          max_tokens: 500,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => ({}));
      const enhanced = plainText(body?.choices?.[0]?.message?.content);
      if (!response.ok || !enhanced) {
        throw new Error(String(body?.message || body?.error?.message || `HTTP ${response.status}`));
      }
      return NextResponse.json({ prompt: enhanced, engine: "qwen-plus", recipeId: recipe.id });
    } catch (error) {
      return NextResponse.json({
        prompt: fallback,
        engine: "template",
        recipeId: recipe.id,
        note: `百炼提示词增强暂不可用，已安全回退到本地生成预设整理：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
