# Wanke 视频生成 Phase 1

## 目标

第一阶段只集中力量提升“生成视频”这件事，不让用户承担模型选择、API 差异和素材规则。

用户只需要回答两个问题：

1. 我手里有什么素材；
2. 我想生成什么画面。

模型、API 路由、参考素材编号、时长兼容和失败查询都由 Wanke 处理。

## 用户入口

主界面只保留四种用户语言：

- **描述生成**：没有素材，直接描述想要的视频；
- **让图片动起来**：一张图片生成视频；
- **首尾画面过渡**：指定开始画面和结束画面；
- **保持人物 / 产品一致**：用多张图片或参考视频保持主体一致性。

默认：1080P、5 秒、单版本。画幅、时长、清晰度和任务名称收进“画面设置”，模型名和专家 JSON 不出现在普通生成流程。

## 自动路由

| 用户目标 | 自动模型 | 原因 |
|---|---|---|
| 描述生成 | `happyhorse-1.1-t2v` | 默认主生成模型 |
| 单图生成 | `happyhorse-1.1-i2v` | 默认主图生视频模型 |
| 首尾画面 | `wan2.7-i2v-2026-04-25` | 原生首帧 + 尾帧控制 |
| 纯图片多参考 | `happyhorse-1.1-r2v` | 强调人物 / 产品参考一致性 |
| 包含视频参考 | `wan2.7-r2v-2026-06-12` | 支持参考视频 |

多参考时 Wanke 自动补充模型需要的 Image / Video 引用语义和一致性约束，用户不需要学习 `[Image 1]` 等提示词格式。

包含参考视频时，生成时长自动限制在 10 秒以内，避免用户提交后才收到模型参数错误。

## Provider 策略

`lib/video/provider.ts` 是应用层唯一的视频生成任务入口。

- 配置 `DASHSCOPE_API_KEY`：基础视频生成优先直连 Alibaba Cloud Model Studio；
- 只有旧 Yike MediaId、或尚未迁移的输入：自动使用现有 Yike 兼容路径；
- 高级复刻、数字人口播、旁白、故事板等 Phase 1 不改，继续使用现有 Yike 工作流。

这样可以逐步替换底层能力，而不需要推倒已有任务中心、素材库、归档和高级工作流。

## 配置

推荐新加坡 Model Studio：

```env
DASHSCOPE_API_KEY=
ALIYUN_MODELSTUDIO_WORKSPACE_ID=
```

如果未填写 Workspace ID，代码仍保留国际通用域名作为兼容路径。已有 Yike 凭证可以继续保留：

```env
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_REGION_ID=ap-southeast-1
```

不要把真实 Key 提交进仓库。

## 任务闭环

```text
用户选择目标 + 描述 + 素材
        ↓
prepare input
        ↓
video provider router
        ↓
HappyHorse / Wan / Yike fallback
        ↓
task_id / JobId
        ↓
SQLite task center
        ↓
auto polling
        ↓
result preview
        ↓
retry / archive
```

单任务刷新、批量自动刷新和重试都经过同一个 provider router，避免不同 Provider 的任务 ID 被错误查询。

## Phase 1 暂不做

- 不删除 Yike；
- 不重写高级复刻、数字人和故事板；
- 不引入 Wonder 作为生产依赖，等其可稳定集成后再增加 Provider；
- 不做完整 NLE 时间线；
- 不把底层模型参数暴露给普通用户。

下一步在真实 API Key 下完成四种入口的 smoke test，然后围绕生成质量增加自动提示词增强、失败原因翻译、结果对比和进一步的模型路由策略。
