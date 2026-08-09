# Wanke 视频生产工作流

## 1. 产品原则

Wanke 是单人生产工具，不是 SaaS。评价一个功能是否应该进入主界面的标准只有三个：

1. 是否能减少重复操作；
2. 是否能让失败可恢复；
3. 是否让生成结果更容易比较、复用和继续加工。

账号、计费、团队、权限、营销页都不进入当前架构。

## 2. 从成熟 AI 视频工作台借鉴的模式

### 阶段化，而不是“一键黑盒”

成熟影视生产天然分阶段。AI Video Production Editor 的核心链路把 script、director treatment、storyboard、filming、continuity review、re-film 和 export 分开；OpenDirector 也把脚本、风格、分镜、人物、声音、媒体和渲染分离。

Wanke 因此同时提供：

- **快速工作流**：一次调用快速得到成片；
- **可检查工作流**：拆解 → 脚本 → 渲染逐段执行。

这两种不能互相替代。

### Re-film / retry lineage

不满意的镜头或任务不覆盖原结果。每次 retry 生成子任务，保留原参数、原响应和结果。故事板如果 Yike 已提供 Resume，则优先续跑原远端任务。

### 一致性依赖资产复用

Jellyfish、ArcReel 等工具都把 character / scene / prop / reference 资产视为长期资源，而不是一次性上传附件。Wanke 的素材库因此持久保存 URL 与 MediaId，并让生成/复刻/口播直接引用。

### 长任务是任务系统，不是 HTTP 请求

所有生成动作先取得远端 JobId，再持久化；浏览器关闭并不会丢失任务。页面恢复后根据 JobId 继续查询。

### 结果不是终点，必须可以继续加工

高级复刻的分析 JSON 是下一步脚本生成输入；脚本 JSON 是渲染输入；最终视频可归档到本机。结果形成生产资产，而不是临时 toast。

## 3. 主要工作流

### A. AI 视频

```text
Prompt + optional references
  ↓
SubmitVideoGenerationJob
  ↓
JobId persisted
  ↓
GetVideoGenerationJob
  ↓
1..4 output variants
  ↓
compare / archive / rerun
```

输入模式的素材数量由服务端再次校验，不能只依赖前端。

### B. 高级复刻

```text
Source video
  ↓
SubmitMediaComprehensionJob(VideoBreakdown)
  ↓
analysis JSON
  ↓
SubmitRemakeScriptJob(faithful-remake)
  ↓
creative/v1 JSON
  ↓
Wanke server safely fetches script JSON
  ↓
SubmitVideoRenderJob
  ↓
video + EditingProjectId
```

上一步任务成为下一步的 parent，任务中心可来回跳转。

### C. 快速复刻

用于不需要检查中间创意脚本的变体任务。它保留在旧版 Studio API surface，因为该能力并没有以相同形态出现在 2026-07-07 Core SDK 中。

### D. 故事板

```text
.txt/.doc on OSS
  ↓
StoryboardOnly / FullPipeline
  ↓
storyboard + shots
  ↓
partial failures?
  ├─ no  → output
  └─ yes → inspect failedShots → Resume same JobId
```

### E. 本机归档

```text
signed remote OutputUrl
  ↓ stream
size guard
  ↓
data/outputs/<job>-<variant>.<ext>
  ↓
/api/archive/<file> (Range supported)
```

归档元数据会和远端 refresh 结果合并，后续续查不会把本地归档标记覆盖掉。

## 4. 状态统一

Wanke 内部只暴露：

- `queued`
- `running`
- `succeeded`
- `failed`
- `unknown`

映射包括：

- Core video: Created / Queuing / Executing / Finished / Failed
- Core file jobs: Created / Executing / Finished / Failed / Deleted
- Agent: Running / Succeeded / Failed
- Storyboard: Running / Succeeded / Failed

`video_translation` 当前是有意的 `unknown`：不是“不知道怎么写”，而是 2026-07-07 Yike SDK 没有对应查询模型。Wanke 不伪造轮询能力。

## 5. 为什么不引入 Redis / Worker

Yike 本身就是远端异步执行器。对于单用户：

- SQLite 保存 JobId；
- 页面打开时定时触发 refresh；后端按任务年龄采用约 6s / 15s / 30s 的自适应查询间隔；
- 重启后继续；
- 并发由 Yike 承担。

再加 Redis、BullMQ、Celery 或独立 worker 只会制造第二套状态机。

## 6. 为什么暂时不做内置时间线编辑器

真正的 NLE 至少需要：多轨 timeline、trim/split、音频轨、字幕、关键帧、预览、代理文件、导出、项目序列化和恢复。OpenReel、OpenChatCut 等项目说明这是一套独立产品。

对于当前个人 Wanke，先把 **生成 → 资产 → 任务 → 回炉 → 归档** 做完整，比塞一个只能拼接视频的“伪编辑器”价值更高。需要编辑时，后续应以独立模块接入成熟本地编辑器或标准时间线交换格式。
