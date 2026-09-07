# Wanke · AI 视频生产平台（商业级 SaaS）

面向创作者与小团队的 **AI 视频生产 SaaS**：注册/登录 → 选择或升级套餐 → 在 Studio 中生成/复刻/口播/故事板 → 任务中心跟踪 → 结果进入「我的作品」→ 管理素材与配额 → 管理员在后台运营用户、套餐、任务与系统健康。

三类角色：

- **访客**：可看产品介绍与套餐说明（`/`），不可消耗配额；
- **会员**：按套餐使用生成能力、作品库、素材库、任务中心（`/studio`、`/account`）；
- **管理员**：用户/套餐/任务/作品/审计运营后台（`/admin`）。

视频引擎（`lib/video`、`lib/yike`、任务轮询、本地归档）保持独立；账号、权限、配额、作品与后台全部叠加在边界层。完整数据模型、权限矩阵、配额扣减策略与 API 一览见 [`docs/SAAS.md`](docs/SAAS.md)。

## SaaS 快速上手

```bash
cp .env.example .env.local   # 填入 AUTH_SECRET 与 ADMIN_EMAIL
npm install && npm run build && npm start
```

1. 打开 `/register` 注册；使用 `ADMIN_EMAIL` 注册的账号自动成为管理员。
2. 新用户默认免费套餐，可在「会员中心」下单购买套餐或创作额度加油包；支付走支付宝电脑/手机网站支付，权益以服务器确认的支付结果为准（后台「系统设置 → 支付设置」配置并做支付测试）。
3. 提交生成任务前校验登录 + 会员状态 + 配额；提交成功计 1 条，远端同步拒绝自动退回。
4. 成功的任务结果可在任务中心一键「保存到作品」，进入作品库长期管理。
5. 注册时会自动发送邮箱验证邮件；`/reset-password` 提供找回密码，链接一次性且旧链接立即失效。邮件在后台「系统设置 → 邮件」配置（未配置时留档到 `data/mail-outbox`，不会谎报已发送）。
6. 后台开启「注册后必须验证邮箱」后，未验证会员仍可登录与查看订单，但不能开始创作，工作台会给出验证入口。
7. 管理员在 `/admin` 管理用户套餐/启停、监管全站任务与作品，所有关键写操作写入审计日志；「经营概览 → 异常与风险」包含邮件发送失败与未验证邮箱账号数。

端到端验收剧本（一次性数据库 + 生产构建，脚本自己拉起服务）：

```bash
npm run build
./scripts/e2e-run.sh scripts/saas-e2e.mjs       # 账号、隔离、权限、后台
./scripts/e2e-run.sh scripts/commerce-e2e.mjs   # 套餐真值、订单、额度账本、密钥
./scripts/e2e-run.sh scripts/payment-e2e.mjs    # 支付宝专项（scripts/alipay-mock.mjs 作为本地网关）
./scripts/e2e-run.sh scripts/account-e2e.mjs    # 账号专项（scripts/smtp-mock.mjs 作为本地邮件服务器）
```

`scripts/alipay-mock.mjs` 是协议级本地网关：它会用商户公钥校验我们的签名，并用支付宝私钥
签名自己的响应与异步通知，因此验签、金额核对、重复通知、过期订单、主动查单与退款都是真实链路，
不产生任何真实资金流动。

`scripts/smtp-mock.mjs` 同样是协议级本地服务器：严格状态机、真实校验登录账号密码、真实收取
DATA 内容，并能按剧本拒绝收件人、卡住不回或拒绝服务，因此邮箱验证、找回密码、SSL/STARTTLS、
限流与「发送失败不谎报成功」都是真实链路。`scripts/e2e-run.sh` 会用 openssl 现生成一张仅用于
localhost 的自签证书（写入 `data/`，不提交）来跑真实的证书校验。

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
- **创作在服务器后台推进**：关闭页面、断网、换设备都不影响，完成后自动出现在任务中心并进通知中心
- 页面打开后只是「加速看一眼」，轮询节奏由服务端 Worker 决定，刷新再多次也不会打满上游
- Model Studio 与扩展工作流远端状态统一
- 成员只看到业务状态与业务原因；RequestId、上游任务编号与原始 API 响应只保留在管理后台
- 参数复制重跑，不覆盖历史
- 父/子任务链
- 结果预览与本机归档
- Storyboard 失败镜头明细
- 超时、上游无法识别的状态、连续查询失败都由 Worker 收口：该退回的额度只退一次，
  可能已经生成的（状态无法确认）保留额度转人工确认，绝不自动重投生成

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

SaaS 必填项：

```env
AUTH_SECRET=          # openssl rand -hex 32；会话 token 哈希盐 + 一次性链接摘要盐，轮换会使所有会话与未使用的验证/重置链接失效
ADMIN_EMAIL=          # 该邮箱注册的账号自动成为管理员（种子管理员）
```

账号与邮件（也可全部在后台「系统设置」里配置，数据库优先）：

```env
WANKE_SITE_URL=       # 邮件里的验证/找回密码链接使用的网站地址，上线必填
WANKE_EMAIL_HOST=     # SMTP 服务器地址
WANKE_EMAIL_PORT=465  # 465 配 SSL，587 配 STARTTLS
WANKE_EMAIL_SECURE=true
WANKE_EMAIL_FROM=     # 例如 Wanke <no-reply@example.com>
WANKE_EMAIL_USERNAME=
WANKE_EMAIL_PASSWORD= # 数据库中以主密钥加密存储，界面只显示掩码
```

后台创作调度（Phase 4；节奏、超时与成本保护上限都在后台「系统设置」里，数据库优先）：

```env
WANKE_DISABLE_WORKER= # 置 true 表示改用外部调度（cron/systemd），进程内定时循环不启动
WANKE_WORKER_TOKEN=   # openssl rand -hex 24；cron 调用 /api/internal/worker 的令牌，留空则该接口 404 关闭
WANKE_BASE_URL=       # scripts/worker-tick.mjs 调用的站点地址
```

用外部调度时，一条 crontab 即可（与进程内循环跑的是同一份 Worker 代码）：

```cron
* * * * * cd /path/to/wanke && WANKE_WORKER_TOKEN=... node scripts/worker-tick.mjs >> /var/log/wanke-worker.log 2>&1
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

- `npm run typecheck` 与 `npm run build` 已通过。
- 验收剧本（一次性数据库 + 生产构建）当前状态：
  `scripts/worker-e2e.mjs` 241 项、`scripts/saas-e2e.mjs` 63 项、`scripts/commerce-e2e.mjs` 80 项、
  `scripts/payment-e2e.mjs` 110 项、`scripts/account-e2e.mjs` 187 项，全部通过。
- Worker 剧本用协议级 Mock（完整异步任务信封 + 鉴权校验 + 失败/无法识别/卡住/连接中断/HTTP 500 注入，
  以及真实 SMTP 投递）覆盖：提交一次只扣一次、完成只确认一次、失败只退回一次、内容类失败不自动退款、
  超时与连续查询失败按平台原因退回、上游状态无法识别保留额度转人工、100 次轮询与反复刷新不重复扣、
  四路并发推进只有一条计费单、**另起进程无人值守推进**、`SIGKILL` 后重启不重复扣也不丢任务、
  调度接口令牌权限与失败关闭、§48 四类防刷与付费/免费差异、§23 实际成本与「不伪装成本」、
  后台经营数据与毛利对账、成员可见面的技术信息泄露扫描。
- 账号剧本覆盖：注册与协议确认、验证邮件真实投递、链接一次性/过期/重放/跨用途、
  旧链接立即失效、60 秒节流、强制验证只限制创作不限制登录、找回密码反枚举、
  重置后全部退出、改密与会话管理、账号状态业务文案、邮件未开启与发送失败不谎报成功、
  SSL/STARTTLS/AUTH LOGIN、邮件模板可配置、越权与技术信息泄露扫描。
- 真实付费生成需使用实际新加坡百炼 Key 对四种生成入口完成最小 smoke test；
  真实 Key 只放 `.env.local`，不要提交或分享。

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
    admin/worker/     # 后台：Worker 健康 + 手动推进一轮
    admin/business/   # 后台：经营数据、成本与毛利、异常与风险
    internal/worker/  # cron 调度入口（Bearer 令牌，未配置令牌则 404）
instrumentation.ts    # Node 启动时拉起进程内创作调度循环
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
  worker.ts           # 服务端创作 Worker：推进、超时、终态结算、通知、归档
  guardrails.ts       # §48 创作成本保护：批量/并发/高速/每分钟 + 拦截留痕
  job-view.ts         # 成员可见任务视图（内部标识与技术字段不外发）
  billing/
    charges.ts        # 报价 → 预扣 → 确认/退回/作废（exactly-once）
    quota.ts          # 额度账本与计费单状态机
    costs.ts          # §23 任务成本、成本口径与毛利换算
  archive.ts
  db.ts
  repository.ts
scripts/
  worker-tick.mjs     # 外部调度（cron/systemd）入口
  worker-e2e.mjs      # Phase 4 验收剧本（含无人值守与重启）
  modelstudio-mock.mjs# 协议级上游 Mock，仅验收使用
docs/
  VIDEO_GENERATION_PHASE1.md
  WORKFLOW.md
  API_MATRIX.md
  OPERATIONS.md
  COMMERCIALIZATION_PLAN.md
```

## 设计原则

Wanke 不照搬单一开源项目，而是借鉴成熟 AI 视频工作台的共同经验：阶段化生产、可复用资产、异步任务恢复、失败回炉和本地归档。

当前优先级明确：**先把视频生成做强、做稳、做简单**。完整 NLE 时间线、Wonder 等后续 Provider，以及更广的外围功能不进入 Phase 1 主链路。
