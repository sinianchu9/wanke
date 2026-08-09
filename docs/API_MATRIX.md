# Yike API 能力矩阵

> 以仓库实现使用的两个官方 TypeScript SDK surface 为准。

| Wanke 功能 | API 版本 | 提交 | 查询/恢复 | 关键约束 |
|---|---|---|---|---|
| AI 视频 | 2026-07-07 | `SubmitVideoGenerationJob` | `GetVideoGenerationJob` | 4–15s；1–4 输出；720P/1080P；text/image/first-last/reference |
| 视频拆解 | 2026-07-07 | `SubmitMediaComprehensionJob` | `GetMediaComprehensionJob` | `JobType=VideoBreakdown`；结果为 JSON URL |
| 复刻脚本 | 2026-07-07 | `SubmitRemakeScriptJob` | `GetRemakeScriptJob` | `faithful-remake`；消费拆解结果；输出 creative script JSON |
| 创意渲染 | 2026-07-07 | `SubmitVideoRenderJob` | `GetVideoRenderJob` | `Script` 是 JSON 字符串；可返回 `EditingProjectId` |
| 视频翻译 | 2026-07-07 | `SubmitVideoTranslationJob` | 同版本 SDK 无 Get 模型 | 输入/输出为调用账号的 OSS URI；Subtitle/Voice translate |
| 媒资注册 | 2026-07-07 | `ImportMedia` | `GetMedia`/Search APIs 可扩展 | Wanke 当前用 ImportMedia 获取 Core MediaId |
| 快速视频复刻 | 2026-03-19 | `SubmitYikeVideoCloneJob` | `GetYikeAgentJob` | OriginalVideo MediaId；商品/素材/数字人替换 |
| 数字人口播 | 2026-03-19 | `SubmitYikeAvatarNarratorJob` | `GetYikeAgentJob` | creator-talk / avatar-broadcast；场景限制不同 |
| 旁白成片 | 2026-03-19 | `SubmitYikeVoiceNarratorJob` | `GetYikeVoiceNarratorJob` | briefing-voiceover；竖屏包装/封面/IP |
| 故事板 | 2026-03-19 | `SubmitYikeStoryboardJob` | `GetYikeStoryboardJob` / `ResumeYikeStoryboardJob` | .txt/.doc OSS；StoryboardOnly/FullPipeline；失败镜头可续跑 |
| 上传凭证 | 2026-03-19 | `CreateYikeAssetUpload` | — | 返回 Base64 UploadAddress/UploadAuth，浏览器 STS 直传 |
| Studio 媒资注册 | 2026-03-19 | `RegisterYikeAssetMediaInfo` | — | Wanke 同时保存 Studio MediaId，供旧版营销能力使用 |

## VideoGeneration 输入规则

- `text_to_video`: 不要参考素材。
- `image_to_video`: 必须 1 个素材。
- `first_last_frame`: 必须正好 2 个素材。
- `reference_to_video`: 1–9 个素材。
- Media 支持 Type + URL / MediaId。
- Model: `wan2.7`, `happyhorse-1.1`, `happyhorse-1.0`。

## Render bridge

`GetRemakeScriptJob` 返回的是脚本文件 URL，而 `SubmitVideoRenderJob.Script` 接受 JSON 字符串。Wanke 在服务端实现了桥接：

1. 只接受公网 HTTP/HTTPS；
2. 拒绝 localhost / 私网地址，避免 SSRF；
3. 最大读取 5MB；
4. 必须能解析为 JSON；
5. 再把原始 JSON 字符串提交给 VideoRender。

## VideoTranslation 查询说明

2026-07-07 Yike SDK 提供 `SubmitVideoTranslationJob`，但其模型目录未提供对应 `GetVideoTranslationJob`。阿里 IMS WebSDK 文档存在通过其他智能媒体任务查询接口轮询视频翻译的做法，但那属于另一套服务/API surface。Wanke 当前不隐式引入第二个产品 SDK，因此将翻译作业明确标记为 submit-only，并让输出落到用户指定 OSS 目录。
