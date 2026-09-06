# Wanke 商业化收口计划（Phase 0 审计基线）

本文档记录商业化收口的现状审计、复用/修改/新增边界、数据迁移策略与风险点。
执行过程按阶段推进，每阶段独立提交并跑测试；本文档随阶段推进持续更新（见文末「阶段进度」）。

视频生产能力（`lib/video/*`、`lib/yike/*`、任务轮询、本地归档、项目/镜头/成片）
**不重写**，商业化能力全部叠加在账号、计费、订单、额度、后台、任务运行方式与文案边界层。

---

## 1. 现状审计（基线冻结时的真实状态）

基线校验（本机执行，全部通过）：

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` (`tsc --noEmit`) | 通过 |
| 生产构建 | `next build` | 通过 |
| SaaS 验收 | `scripts/e2e-run.sh scripts/saas-e2e.mjs` | 33 项全部通过 |

### 1.1 已有且可复用

- 账号：`users` / `sessions`（scrypt 口令、SHA-256 会话令牌、30 天滑动过期、登录限流 `login_attempts`）。
- 守卫：`getCurrentUser` / `requireUser` / `requireAdmin` / `checkOrigin`（`lib/auth.ts`）。
- 会员骨架：`memberships`（plan=free/pro/studio、`quota_limit_videos`、`quota_used_videos`、30 天惰性滚动）。
- 额度策略：提交预扣（原子 UPDATE 带上界校验）、同步失败退回、异步失败不退（`lib/membership.ts`）。
- 数据隔离：`jobs/assets/projects/subject_cards` 已补 `user_id`，越权读取返回 404 而非 403。
- 作品：`works` + 归档文件（`lib/archive.ts`、`data/outputs`）。
- 后台雏形：`admin_audit_logs`、用户列表/详情、任务监管、作品管理、系统信息。
- 视频服务配置：`settings` 表（KV）+ `lib/settings.ts`（含掩码读取、Token Plan Key 拦截）。
- 创作能力：11 种 `JOB_KINDS`，快速/高级创作、复刻、数字人、旁白、故事板、翻译、编辑、续创。
- 验收脚本模式：`scripts/saas-e2e.mjs` 对真实生产服务器跑端到端断言（可复用为商业 E2E 骨架）。

### 1.2 必须修改（商业阻塞项）

| 编号 | 问题 | 证据 | 处理 |
|---|---|---|---|
| M1 | 模拟支付是正式业务入口，用户可直接调接口升级会员 | `app/api/membership/switch/route.ts` + `switchPlan()` | 下线该入口；改为「创建订单 → 支付宝 → 服务端确认 → 发放权益」 |
| M2 | 套餐价格/额度硬编码在代码与 React 页面（双真值） | `lib/membership.ts` 的 `PLANS`、`app/page.tsx`、`components/account-center.tsx` | 套餐迁移到 `plans` 表，官网/会员中心/下单/后台读同一真值 |
| M3 | 额度只有累计数字，无账本，无法追查 | `memberships.quota_used_videos` | 新增 `quota_ledger` + `task_charges`，所有变动带幂等键 |
| M4 | 失败扣费规则一刀切（异步失败不退） | `docs/SAAS.md` §3 | 失败分类 + 后台可配置退款规则（平台原因/服务异常/参数问题/内容不可生成/用户取消） |
| M5 | 普通用户可读平台内部配置（视频线路/密钥掩码/区域/地址） | `GET /api/settings` 仅 `requireUser`；`components/settings-panel.tsx` | 接口改 `requireAdmin`；用户设置只留资料/创作偏好/通知/安全；服务配置迁到后台「创作服务」 |
| M6 | 任务推进依赖浏览器打开（`POST /api/jobs/refresh`） | `app/api/jobs/refresh/route.ts` | 新增服务端 Worker（`instrumentation` 内定时 sweep + `scripts/worker-tick.mjs` 供 cron），前端只做展示与手动刷新 |
| M7 | 用户界面出现工程腔与内部状态（queued/running/succeeded、Provider、RequestId、多租户、配额预扣） | `app/page.tsx`、`components/*` | 统一业务文案层（`lib/copy.ts`），全仓扫描替换 |
| M8 | 敏感配置明文存 `settings` | `lib/settings.ts` `writeValue` | 统一秘密层 `lib/secrets.ts`（AES-256-GCM + 主密钥），旧值一次性加密迁移 |
| M9 | 无订单/支付/退款/发票/工单/通知/公告域 | `app/api/*` 列表 | Phase 1–3 新增 |
| M10 | 存储直连本地目录，无生产对象存储与私有访问 | `lib/archive.ts` | Phase 5 抽象 Storage（本地 / OSS），保留现有归档行为 |
| M11 | 数据库仅 SQLite，关键写入事务边界不完整 | `lib/db.ts` | 仓储层保持；支付+发放+额度收敛为单事务；PostgreSQL 兼容层预留 |
| M12 | 无经营数据、无成本记录、无异常监控 | `adminStats()` 仅计数 | Phase 6 新增 `经营数据` + `task_charges` 成本字段 |

### 1.3 新增实体（先核对现有 schema 后融合，不建重复模型）

`plans`（含会员套餐与额度加油包）、`order_items`、`orders`、`payments`、`refunds`、
`order_events`、`quota_ledger`、`task_charges`、`pricing_rules`、`failure_rules`、
`notifications`、`user_preferences`、`support_tickets`、`support_messages`、
`invoice_requests`、`announcements`、`secrets`、`email_verification_tokens`、
`password_reset_tokens`、`coupons`（预留）、`worker_runs`。

复用而非新建：`memberships` 继续作为「当前权益快照」（新增 `bonus_credits` 表示加油包/赠送额度），
`settings` 继续作为非敏感 KV，`admin_audit_logs` 继续作为管理员操作记录。

### 1.4 迁移策略

- 全部迁移写在 `lib/db.ts` 的 `CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing()`，**可重复执行**、
  多进程并发启动安全（`duplicate column` 视为成功）。
- 首启按现有 `PLANS` 常量播种 `plans` / `pricing_rules` / `failure_rules`（仅在表为空时写入），
  保证旧库升级后价格与额度不变，不产生回归。
- 旧 `memberships.quota_used_videos` 数值保留；升级时为其补一条 `reason='migration_baseline'` 的账本行，
  使历史用量可追溯但不改变余额。
- 敏感设置一次性迁移：读取旧明文 → 写入 `secrets`（加密）→ 删除旧明文行；重复执行安全。
- `orders.client_token` / `payments.out_trade_no` / `refunds.out_request_no` /
  `quota_ledger.idempotency_key` / `task_charges.idempotency_key` 均建唯一索引，作为幂等硬边界。

### 1.5 风险点

1. **视频链路回归**：额度从「1 任务 = 1 条」改为「按规则计创作额度」，必须保证 11 种 `JOB_KINDS`
   的默认报价等于旧行为（默认 1 额度），否则老用户体感突变。默认规则播种为 1，后台再调。
2. **并发一致性**：better-sqlite3 单连接串行写入是现有安全前提；Worker 与请求进程可能同库并发，
   所有权益变更必须走条件 UPDATE + 事务，禁止「读-改-写」。
3. **支付重放**：支付宝异步通知可能重复/乱序/延迟；发放必须以「订单状态条件跃迁」为准，
   不能以通知次数为准。
4. **越权与泄露**：`/api/settings` 目前对普通用户开放，属于必须先修的安全边界。
5. **文案替换误伤**：内部状态值仍是数据契约（`queued/running/...`），只能在展示层翻译，
   不得改数据库枚举，否则轮询与归档逻辑回归。
6. **无测试框架**：仓库无单测运行器；沿用「真实服务器 + 脚本断言」模式，
   新增 `scripts/commerce-e2e.mjs`（支付/额度/权限）与 `scripts/alipay-mock.mjs`（本地网关桩），
   避免引入新依赖导致构建风险。
7. **密钥管理**：主密钥缺失时不得静默降级为明文；开发态允许自动生成并落盘 `data/.wanke-master.key`(0600)。
8. **上线门槛**：typecheck / build / 旧 E2E / 新商业 E2E 全绿才算阶段完成，禁止删测试绕过。

---

## 2. 阶段划分与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| Phase 0 | 现状审计、基线冻结、本文档 | typecheck + build + 旧 E2E 全绿 |
| Phase 1 | 商品/套餐后台化、创作额度、额度账本、订单、支付记录、退款记录、任务计费、下线模拟支付 | 商业 E2E（额度/订单/权益幂等） |
| Phase 2 | 支付宝配置、电脑/手机支付、异步通知验签、主动查单、超时关闭、重复通知、退款 | 支付宝专项 10 条 |
| Phase 3 | 邮箱验证、找回密码、改密、会话管理、用户中心重构、订单列表、额度明细 | 账号 E2E |
| Phase 4 | 分类额度规则、提交前报价、冻结/确认/退回、成本记录、服务端 Worker | 额度专项 7 条 + 关浏览器续跑 |
| Phase 5 | Storage 抽象、本地/OSS、私有访问、统计、清理 | 存储 E2E |
| Phase 6 | 后台完整化（经营/用户/商品/订单/财务/退款/额度/任务/作品/工单/发票/公告/创作服务/存储/邮件/系统设置/操作记录） | 后台 E2E + 权限测试 |
| Phase 7 | 前台与 Studio 产品化、全站文案审查、移动端 | 文案扫描 0 命中 + 移动端检查 |
| Phase 8 | 上线前高强度验收（用户/支付/创作/权限/后台五类场景） | 全量脚本 + 重启恢复 |

## 3. 阶段进度

- [x] Phase 0：审计与基线冻结（本文档；typecheck/build/33 项 SaaS E2E 通过）
- [x] Phase 1：商业数据基础（详见 §4；typecheck/build 通过，SaaS E2E 60 项 + 商业 E2E 78 项全绿）
- [ ] Phase 2：支付宝
- [ ] Phase 3：账号完整化
- [ ] Phase 4：视频任务商业化
- [ ] Phase 5：作品与存储商业化
- [ ] Phase 6：管理后台完整化
- [ ] Phase 7：前台与 Studio 产品化
- [ ] Phase 8：上线前高强度验收

---

## 4. Phase 1 完成记录（商业数据基础）

### 4.1 落地内容

- **商品与套餐后台化**：`plans` 表成为唯一真值（`lib/billing/catalog.ts`），官网、会员中心、下单、
  后台读同一份数据； seeded 免费版/创作者版/工作室版 + 50/200 创作额度加油包；订单固化商品快照，
  后台改价不改写已售订单。
- **创作额度与账本**：`quota_ledger`（变动前/变动后/来源/幂等键 UNIQUE）+ `task_charges`
  （reserved → settled/refunded/voided 单向流转）；会员额度分「套餐周期额度」与「加油包/赠送额度」。
- **计费规则**：`pricing_rules`（默认 1 额度，与商业化前完全一致）+ `failure_rules`
  （用户参数=不扣、平台/服务异常=自动退回、内容/取消/未知=人工复核）。
- **订单域**：`orders`/`order_items`/`order_events`；`client_token` UNIQUE + 待支付订单复用，
  刷新收银台不会堆单；金额全部为整数分；升级为按未使用价值折抵。
- **支付/退款域**：`payments`（`out_trade_no` UNIQUE）、`payment_notifications`（指纹去重）、
  `refunds`（`out_request_no` UNIQUE，可注入执行器）；权益发放 `grantEntitlementForOrder`
  以 `order:<id>` 账本幂等键 + 订单状态条件跃迁保证「只发一次」。
- **下线模拟支付**：删除 `POST /api/membership/switch`，会员生效只能由服务端确认支付触发。
- **秘密配置**：`lib/crypto-secrets.ts`（AES-256-GCM，主密钥 WANKE_MASTER_KEY → AUTH_SECRET →
  自动生成 `data/.wanke-master.key` 0600，支持轮换）+ `lib/secrets.ts`（留空=保持原值、
  单独清除、只回掩码）；旧明文设置一次性加密迁移。
- **产品边界**：`GET /api/settings` 收敛为管理员；`/api/status` 只回能力开关；
  新增 `/api/admin/creation-service` 承载线路/凭证/连通性等内部诊断；
  会员任务响应剥离上游原始响应与技术错误（`lib/job-view.ts` + `lib/copy.ts`）。
- **账号与会员中心**：`/api/account/*`（资料、创作偏好、通知偏好、改密、登录设备、注销）、
  会员中心左侧导航（我的会员/额度明细/我的订单/账号设置）、后台导航化
  （经营概览/用户/商品与套餐/订单/任务/作品/创作服务/系统设置/操作记录）。

### 4.2 本轮修掉的真实缺陷

| 缺陷 | 影响 | 处理 |
|---|---|---|
| 并发启动播种套餐撞主键（`next build` 9 worker 同时迁移） | 生产构建直接失败 | 整个迁移收敛到一个 `BEGIN IMMEDIATE` 写锁内，播种改 `INSERT OR IGNORE`；`PRAGMA foreign_keys` 移到事务外（事务内为 no-op，否则重建 `users` 会级联删子表） |
| 免费套餐可被下单（应付 0 → 立即发放） | 用户可无限「购买」免费版重置已用额度 | `createOrder` 拒绝 `priceCents <= 0` 的套餐 |
| 校验错误原文回给会员（`jobType: Invalid option: expected one of "text_to_video"…`） | 内部字段与枚举泄露 | `publicErrorMessage` 识别 schema 校验输出并转业务话术；`classifyFailure` 据此判定「用户参数不符合要求 → 不扣额度」，不再依赖关键字巧合 |
| 会员任务详情展示「技术详情」原始 JSON、上游任务编号、MediaId、百炼字样 | 违反 §4/§22/§47 边界 | 删除展示；服务端对非管理员剥离 `provider` 原文并清洗 `error` |
| E2E 就绪探针打 `/api/status`（现已需登录） | 每次跑测试空等 90 秒 | 探针改打公开首页，失败即退出并打印服务日志 |

### 4.3 验收证据

```
node_modules/.bin/tsc --noEmit                     # 通过
node_modules/.bin/next build                       # 通过
./scripts/e2e-run.sh scripts/saas-e2e.mjs          # ALL E2E CHECKS PASSED（60 项）
./scripts/e2e-run.sh scripts/commerce-e2e.mjs      # ALL COMMERCE CHECKS PASSED（78 项）
```

商业 E2E 覆盖：套餐唯一真值、下单幂等（同 token / 刷新复用 / 仅一行订单）、快照冻结与改价隔离、
未支付不发放权益、支付通道未开通时诚实报 503、跨用户订单 404、取消后不可支付、
提交前报价、一次提交只产生一条扣费（含账本幂等键计数）、重复提交返回同一任务、
20 次状态查询不动额度、批量超额前置拒绝且不产生扣费/任务、额度明细业务话术与用户隔离、
管理员调整额度必须填原因、密钥加密落盘且永不回浏览器、留空保持原值、显式清除、
操作记录只记字段不记值。

Phase 1 边界：支付宝尚未接入，`POST /api/orders/:id/pay` 明确返回 503「支付通道尚未开通」，
不做任何模拟成功；真实支付与专项 10 条在 Phase 2 验收。
