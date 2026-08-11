# Wanke Video Studio

个人自用的 **AI 视频生产工作站**。目标不是复刻任一云厂商控制台，而是把视频生产真正整理成一个连续工作流：素材进入 → 生成/拆解/复刻/口播/故事板 → 异步任务 → 结果比较 → 失败回炉 → 本地归档。

**刻意不做**：注册登录、会员、支付、套餐、团队、多租户、运营后台。复杂度全部留给视频本身。

## Phase 1：视频生成优先

基础 AI 视频生成已经改成 provider-neutral 架构。配置新加坡百炼 Model Studio Key 后，Wanke 会直接调用 HappyHorse / Wan，并自动根据用户目标选择模型；普通用户不需要选择模型或理解 API 参数。

主入口只有四种操作：

- **描述生成**：没有素材，直接描述画面；
- **让图片动起来**：本地图片、素材库图片或公网图片均可；
- **首尾画面过渡**：指定开始和结束画面；
- **保持人物 / 产品一致**：多张参考图片或参考视频。

本地 JPG / PNG / WEBP 可以直接在 AI 视频页选择，不需要先上传 OSS。公网视频参考使用 MP4/MOV URL。生成结果进入统一任务中心，可自动查询、重试和保存到本机。

自动生成路由当前包括：

- `happyhorse-1.1-t2v`
- `happyhorse-1.1-i2v`
- `happyhorse-1.1-r2v`
- `wan2.7-i2v-2026-04-25`
- `wan2.7-r2v-2026-06-12`

详见 `docs/VIDEO_GENERATION_PHASE1.md`。

## 现有扩展能力

Phase 1 没有删除原有 Yike 工作流。以下能力继续作为扩展生产工具保留：

### 高级复刻生产线

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

每一步都是独立任务，可以单独重跑；上下游通过父子任务关系追踪。

### 快速复刻

- 原视频 MediaId
- 商品替换
- 用户素材替换
- 数字人人像 / 声音
- 字幕、分辨率

### 数字人口播

- 知识讲解 `creator-talk`
- 固定数字人口播 `avatar-broadcast`
- 原始资料自动口语化 / 已写好口播稿
- 用户素材穿插
- 中文 / 英文 / 粤语
- 字幕、画幅、分辨率、目标时长

### 旁白成片

- 原始资料自动改写或直接旁白稿
- 多素材组合
- 内置声音选择
- 多语言
- 竖屏二次包装
- 主标题 / 副标题 / 日期 / 水印
- AI 封面、IP 角色素材

### 故事板生产线

- `.txt` / `.doc` 长文本
- `StoryboardOnly` 或 `FullPipeline`
- 视觉风格、画幅、720P/1080P/2K/4K
- 旁白、字幕、原对话、音频
- 多参考/图生镜头模式
- 失败镜头明细
- 原任务 Resume 续跑

### 视频翻译

- 语音翻译 `VoiceTranslate`
- 字幕翻译 `SubtitleTranslate`
- 源语言 / 目标语言
- 去文字 / 视觉文字翻译开关
- 输入与输出使用调用账号下的 `oss://` URI

当前扩展 SDK 暴露提交接口但没有同版本查询模型的任务，Wanke 会明确标记为不可轮询，不伪造进度。

## 素材与任务

### 素材库

- 公网 HTTP/HTTPS 图片、视频、音频可以直接保存为 provider-neutral URL 资产；
- 基础生成的本地图片直接在 AI 视频页选择；
- 配置扩展工作流后仍可使用原有 OSS 分片上传与媒资登记；
- 普通界面不要求用户理解 MediaId；
- `.txt/.doc` 脚本继续供故事板使用。

### 任务中心

- SQLite WAL 持久化
- 页面打开后自动续查活动任务
- Model Studio 与扩展工作流远端状态统一
- RequestId + 原始 API 响应保留在折叠技术详情
- 参数复制重跑，不覆盖历史
- 父/子任务链
- 结果预览与本机归档
- Storyboard 失败镜头明细

### 本机结果归档

成功结果可以一键流式保存到：

```text
data/outputs/
```

Wanke 自带支持 HTTP Range 的本地文件路由，因此归档后的视频仍可以拖动播放，不依赖会过期的远端签名 URL。

本地生成参考图默认保存在：

```text
data/inputs/
```

任务只保存短引用，真正提交模型时才临时编码；没有其他任务引用时会安全清理。

## 配置与启动

要求 Node.js 22。

```bash
cp .env.example .env.local
```

基础视频生成推荐配置：

```env
DASHSCOPE_API_KEY=
ALIYUN_MODELSTUDIO_WORKSPACE_ID=
```

扩展复刻、数字人、故事板等能力按需继续配置：

```env
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_REGION_ID=ap-southeast-1
```

然后：

```bash
npm install
npm run doctor
npm run typecheck
npm run build
npm run dev
```

打开：`http://localhost:3000`

生产运行：

```bash
npm start
```

## Docker

```bash
cp .env.example .env.local
docker compose up -d --build
```

SQLite、本地输入和结果归档都位于 `./data`，Docker Compose 已挂载为持久卷。

## 验证状态

当前 Phase 1 已完成代码级 Bug 审查和官方 API 参数核对。由于仓库当前没有 PR GitHub Actions workflow，且本执行环境无法从 `github.com` 拉取分支，本轮不能把 `typecheck/build` 标记成已通过。

合并前应在实际运行环境执行：

```bash
npm install
npm run typecheck
npm run build
npm run doctor
```

然后使用实际新加坡百炼 Key 对四种生成入口完成最小 smoke test。真实 Key 只放 `.env.local`，不要提交或分享。

## 安全

真实 API Key / AccessKey **只能放服务端 `.env.local`**。不要写入：

- React / 浏览器代码
- `NEXT_PUBLIC_*`
- README
- GitHub Actions 明文日志
- Issue / PR

`.env.local` 已被 `.gitignore` 排除。

## 项目结构

```text
app/
  api/
    jobs/             # 提交、查询、续跑、重试、归档
    assets/           # 素材记录 / 扩展上传凭证
    video-inputs/     # 基础生成本地图片输入
    archive/          # 本机归档文件 + Range 播放
    status/           # Provider 配置与扩展能力健康状态
components/
  studio.tsx
  simple-video-generator.tsx
  forms.tsx
  asset-library.tsx
  job-center.tsx
lib/
  video/
    provider.ts       # 应用层统一视频生成出口
    modelstudio.ts    # HappyHorse / Wan 直连与自动路由
    prepare.ts        # provider-neutral 素材准备
    local-input.ts    # 本地图片持久化、Base64 临时转换与清理
  yike/
    client.ts
    schemas.ts
    jobs.ts
    normalizers.ts
    assets.ts
    shared.ts
    provider.ts       # 扩展工作流兼容出口
  archive.ts
  db.ts
  repository.ts
docs/
  VIDEO_GENERATION_PHASE1.md
  WORKFLOW.md
  API_MATRIX.md
  OPERATIONS.md
```

## 设计原则

Wanke 不照搬单一开源项目，而是借鉴成熟 AI 视频工作台的共同经验：阶段化生产、可复用资产、异步任务恢复、失败回炉和本地归档。

当前优先级明确：**先把视频生成做强、做稳、做简单**。完整 NLE 时间线、Wonder 等后续 Provider，以及更广的外围功能不进入 Phase 1 主链路。
