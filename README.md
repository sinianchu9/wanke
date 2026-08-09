# Wanke Video Studio

个人自用的 **万镜一刻视频生产工作站**。目标不是复刻阿里云控制台，而是把视频生产真正整理成一个连续工作流：素材进入 → 生成/拆解/复刻/口播/故事板 → 异步任务 → 结果比较 → 失败回炉 → 本地归档。

**刻意不做**：注册登录、会员、支付、套餐、团队、多租户、运营后台。复杂度全部留给视频本身。

## 核心能力

### 1. AI 视频生成（Yike 2026-07-07）

- 文生视频 `text_to_video`
- 图生视频 `image_to_video`
- 首尾帧 `first_last_frame`
- 多参考 `reference_to_video`
- 4–15 秒
- 720P / 1080P
- 1–4 个结果并排比较
- 模型：`wan2.7` / `happyhorse-1.1` / `happyhorse-1.0`
- 参考素材可使用 URL 或最新媒资 MediaId

### 2. 高级复刻生产线（Yike 2026-07-07）

不是把“复刻”做成一个黑盒按钮，而是保留三个可检查阶段：

```text
原视频
  ↓
VideoBreakdown 视频拆解
  ↓  结构化 JSON
faithful-remake 复刻脚本
  ↓  creative/v1 JSON
VideoRender 独立渲染
  ↓
最终视频 + EditingProjectId
```

每一步都是独立任务，可以单独重跑；上下游通过父子任务关系追踪。Wanke 会在服务端读取复刻脚本 JSON，再提交给 VideoRender，避免浏览器处理临时签名文件。

### 3. 快速复刻（Yike 2026-03-19）

适合“不想检查中间过程，只做一个快速变体”的场景：

- 原视频 MediaId
- 商品替换
- 用户素材替换
- 数字人人像 / 声音
- 字幕、分辨率

### 4. 数字人口播

- 知识讲解 `creator-talk`
- 固定数字人口播 `avatar-broadcast`
- 原始资料自动口语化 / 已写好口播稿
- 用户素材穿插
- 中文 / 英文 / 粤语
- 字幕、画幅、分辨率、目标时长
- UI 预先阻止 Yike 明确不支持的参数组合

### 5. 旁白成片

- 原始资料自动改写或直接旁白稿
- 多素材组合
- 内置声音选择
- 多语言
- 竖屏二次包装
- 主标题 / 副标题 / 日期 / 水印
- AI 封面、IP 角色素材

### 6. 故事板生产线

- `.txt` / `.doc` 长文本
- `StoryboardOnly` 或 `FullPipeline`
- 视觉风格、画幅、720P/1080P/2K/4K
- 旁白、字幕、原对话、音频
- 多参考/图生镜头模式
- 失败镜头明细
- **原任务 Resume 续跑**，不是整条重新生成

### 7. 视频翻译（Yike 2026-07-07）

- 语音翻译 `VoiceTranslate`
- 字幕翻译 `SubtitleTranslate`
- 源语言 / 目标语言
- 去文字 / 视觉文字翻译开关
- 输入与输出使用调用账号下的 `oss://` URI

当前 Yike 2026-07-07 SDK 暴露提交接口，但没有同版本的查询模型。Wanke 会保存 JobId，并明确标记为“不可轮询”，不会伪造进度；输出到指定 OSS 目录。

### 8. 素材库

- Yike 临时上传凭证
- 浏览器使用 STS **直接分片上传 OSS**，大视频不经过 Wanke Node 服务
- 视频 / 图片 / 音频同时注册到 2026-07-07 Core 与 2026-03-19 Studio 两个 API surface
- 两套 MediaId 分开保存，不假定 ID 命名空间永远互通
- `.txt/.doc` 脚本作为 URL-only 素材供故事板使用
- 公网 URL 可直接注册
- 删除素材时可选择“只删本地索引”或“同步逻辑删除 Core/Studio 云端媒资登记”；默认不强制删除底层物理文件

### 9. 任务中心

- SQLite WAL 持久化
- 页面打开后自动续查活动任务
- 普通视频、Core pipeline、Agent、Storyboard 不同远端状态统一
- RequestId + 原始 API 响应保留
- 参数复制重跑，不覆盖历史
- 父/子任务链
- 1–4 版本并排预览
- JSON/SRT/video 结果分类显示
- Storyboard 失败镜头明细

### 10. 本机结果归档

Yike 视频结果通常是带签名的临时 URL。成功结果可以一键流式保存到：

```text
data/outputs/
```

Wanke 自带支持 HTTP Range 的本地文件路由，因此归档后的视频仍可以拖动播放，不依赖过期的远端签名 URL。

## 为什么同时使用两个 Yike API 版本

阿里当前两个版本的能力面并不完全重叠：

- **2026-07-07**：基础视频生成、媒资理解、复刻脚本、创意渲染、视频翻译、媒资管理。
- **2026-03-19**：营销 Agent、数字人口播、旁白成片、快速视频复刻、故事板、故事板 Resume、Yike 上传凭证等。

Wanke 因此把它们视为两个 provider surface，而不是把新版本粗暴当成旧版本的完全替代。

## 启动

要求 Node.js 22。

```bash
cp .env.example .env.local
# 填入你自己的临时/受限阿里云 AccessKey
npm install
npm run doctor
npm run dev
```

打开：`http://localhost:3000`

生产构建：

```bash
npm run typecheck
npm run build
npm start
```

## Docker

```bash
cp .env.example .env.local
# 填好环境变量
docker compose up -d --build
```

SQLite 和本机归档都位于 `./data`，Docker Compose 已挂载为持久卷。

## 安全

真实 AccessKey **只能放服务端 `.env.local`**。不要写入：

- React / 浏览器代码
- `NEXT_PUBLIC_*`
- README
- GitHub Actions 明文日志
- Issue / PR

`.env.local` 已被 `.gitignore` 排除。浏览器上传拿到的只是 Yike 下发的临时 STS 凭证。

## 项目结构

```text
app/
  api/
    jobs/             # 提交、查询、续跑、重试、归档
    assets/           # 素材注册 / 上传凭证
    archive/          # 本机归档文件 + Range 播放
    status/           # 双 API surface 健康探测
components/
  studio.tsx          # 总工作台
  forms.tsx           # 各生产工作流
  asset-library.tsx
  job-center.tsx
lib/
  yike/
    client.ts         # 2026-07-07 + 2026-03-19 双客户端
    schemas.ts        # 各视频能力输入校验
    jobs.ts           # 提交 / 查询 / Resume
    normalizers.ts    # 状态与输出归一
    assets.ts         # 上传 / 双媒资登记 / 安全删除
    shared.ts         # 安全合并、脚本读取与公共工具
    provider.ts       # 对应用层保持稳定的统一出口
  archive.ts          # 结果持久化
  db.ts
  repository.ts
docs/
  WORKFLOW.md
  API_MATRIX.md
  OPERATIONS.md
```

## 设计参考

Wanke 没有照搬单一开源项目，而是借鉴成熟 AI 视频工作台的共同经验：

- AI Video Production Editor：Script → Director → Storyboard → filming → continuity review → re-film → timeline/export。
- Jellyfish：一致性、可复用生产资产、异步任务与恢复优先。
- OpenDirector：把研究、脚本、风格、故事板、角色、声音、媒体、渲染拆成明确生产阶段。
- ArcReel：长任务断点、版本回溯、素材一致性和生产队列。
- OpenReel / OpenChatCut：真正编辑器应围绕 timeline 和可编辑项目，而不是把“生成完成”冒充“剪辑完成”。

因此本仓库当前专注 **Yike 视频生产闭环**。没有硬塞一个半成品时间线编辑器；后续如果需要 NLE，应该作为独立本地编辑模块接入，而不是污染生成层。

详见：

- `docs/WORKFLOW.md`
- `docs/API_MATRIX.md`
- `docs/OPERATIONS.md`
