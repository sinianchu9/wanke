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
| Phase 2 | 支付宝配置、电脑/手机支付、异步通知验签、主动查单、超时关闭、重复通知、退款 | 支付宝专项 10 条（已达成，见 §5.3） |
| Phase 3 | 邮箱验证、找回密码、改密、会话管理、用户中心重构、订单列表、额度明细 | 账号 E2E |
| Phase 4 | 分类额度规则、提交前报价、冻结/确认/退回、成本记录、服务端 Worker | 额度专项 7 条 + 关浏览器续跑 |
| Phase 5 | Storage 抽象、本地/OSS、私有访问、统计、清理 | 存储 E2E |
| Phase 6 | 后台完整化（经营/用户/商品/订单/财务/退款/额度/任务/作品/工单/发票/公告/创作服务/存储/邮件/系统设置/操作记录） | 后台 E2E + 权限测试 |
| Phase 7 | 前台与 Studio 产品化、全站文案审查、移动端 | 文案扫描 0 命中 + 移动端检查 |
| Phase 8 | 上线前高强度验收（用户/支付/创作/权限/后台五类场景） | 全量脚本 + 重启恢复 |

## 3. 阶段进度

- [x] Phase 0：审计与基线冻结（本文档；typecheck/build/33 项 SaaS E2E 通过）
- [x] Phase 1：商业数据基础（详见 §4；typecheck/build 通过，SaaS E2E 60 项 + 商业 E2E 78 项全绿）
- [x] Phase 2：支付宝（详见 §5；typecheck/build 通过，SaaS E2E 61 项 + 商业 E2E 80 项 + 支付宝专项 110 项全绿）
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

---

## 5. Phase 2 完成记录（支付宝收款闭环）

### 5.1 落地内容

- **协议层** `lib/billing/alipay.ts`：只用 `node:crypto`，无新依赖。RSA2 签名/验签、
  密钥归一化（控制台裸 base64 或 PEM 都能用）、金额分↔元字符串严格互转、
  北京时间时间戳（不受宿主时区影响）、`alipay.trade.page.pay`（电脑）/`alipay.trade.wap.pay`（手机）
  收银台地址、`alipay.trade.query`/`refund`/`close`/`fastpay.refund.query`。
  请求签名包含 `sign_type`、异步通知验签按官方 `verifyV1` 剔除 `sign` 与 `sign_type`
  （并保留 `verifyV2` 回退），同步响应按「原始 JSON 子串」验签而不是重新序列化。
- **下单到收银台** `startPayment()`（`lib/billing/orders.ts`）：校验通道可用、订单可支付、
  未过期（过期先关单再要求重新下单）；一笔订单只有一条 `payments` 记录，重复打开收银台只更新设备；
  返回签名后的支付地址，**不在这里发放任何权益**。
- **异步通知** `POST /api/payments/alipay/notify` + `lib/billing/alipay-notify.ts`：
  先验签，再核对 `app_id`、商户订单号、金额、收款主体；成功走 `finalizePaidOrder()`
  （条件跃迁 + `order:<id>` 账本幂等键），每一条通知（含伪造/未知订单）原文落
  `payment_notifications`。应答规则：已处理/重复/需人工 → `success`（避免无意义重试 24 小时），
  验签失败/内部错误 → `failure`（等支付宝重试）。
- **主动查单** `lib/billing/payment-sync.ts` + `GET /api/orders/[id]/pay-status`：
  订单仍在飞行中时才向支付宝查询，查到已付款走与通知完全相同的结算路径；
  带 3 秒节流；`ACQ.TRADE_NOT_EXIST` 一律呈现为「正在确认支付结果……」，绝不显示「支付失败」。
- **支付结果页** `app/payment/result/page.tsx` + `components/payment-result.tsx`：
  轮询 `pay-status`，文案来自 `PAYMENT_RESULT_COPY`（§10.3）；支付宝回跳参数只用于定位订单，
  不能触发任何发放。会员中心下单后直接跳转收银台，「我的订单」提供继续支付/支付结果/取消/申请退款。
- **退款** `lib/billing/refund-gateway.ts` + `POST /api/orders/[id]/refund`（用户申请，需审核）
  + `/api/admin/refunds`（列表/运营发起并执行）+ `/api/admin/refunds/[id]`（通过/驳回/执行）。
  `fund_change=Y` 才算成功；`fund_change=N` 用退款查询确认 `REFUND_SUCCESS` 才按幂等成功处理，
  否则记为「退款结果未知」交人工核对，**不自动重复提交**；运营重试沿用同一 `out_request_no`。
- **后台** 系统设置页新增「支付通道状态」卡片 + 「支付测试」（免费连通性：查询一个不存在的订单号，
  `ACQ.TRADE_NOT_EXIST` 即凭据有效），测试时间与结果落库；订单详情新增「主动查询支付结果」
  与「发起退款」；新增「退款与售后」页面；订单/退款状态改为业务话术显示；
  新增 `alipay_seller_id`（收款主体）配置项，所有操作写入管理员记录。
- **运维文档**：`docs/OPERATIONS.md` §10 上线配置清单、主密钥注意事项与支付故障处理；
  `docs/SAAS.md`/`README.md` 中「模拟支付」的过期描述已改为现行支付链路。

### 5.2 本轮修掉的真实缺陷

| 缺陷 | 影响 | 处理 |
|---|---|---|
| `decryptSecret()` 按 5 段解析 `enc:v1:<keyId>:<iv>:<tag>:<ct>`（实际 6 段） | **所有已加密的秘密配置永远读不出来**：支付宝私钥/公钥不可用；Phase 1 迁移进 `secrets` 的 `modelstudio_api_key`、`yike_access_key_*` 也读不回来（明文行已删），视频链路只能靠环境变量兜底 | 按 6 段解析并校验前缀与十六进制字段；后台掩码由「配置需要重新保存」恢复为真实掩码；商业 E2E 增加「存进去能再读出来」的往返断言，防止格式再次静默损坏 |
| `finalizePaidOrder()` 直接 INSERT 支付记录，而收银台已经写入同 `out_trade_no` 的 `created` 行 | 通知一到就撞 UNIQUE 约束，**付款成功却发不出权益** | 新增 `markPaymentSuccess()`：按 `out_trade_no` 更新既有行、只在缺失时插入，已成功的行不被覆盖或降级 |
| 用户重复提交退款申请时无法区分「新建」与「返回在途记录」 | 界面把在途申请当成新申请（201），运营也可能重复发起 | `requestRefund()` 返回 `{refund, reused}`；用户端据此回 200 与「已在处理中」，运营端遇到在途记录直接 409 并给出退款单号 |
| 已全额退款订单再次申请退款报「该订单当前不能申请退款」 | 用户看不懂，也不符合 §15「已退款再次退款」的明确拒绝 | 先判 `refunded` 状态并返回 `ALREADY_REFUNDED`／「该订单已经完成退款」 |
| `markOrderPaying()` 只允许 `pending → paying` | 电脑下单后改用手机继续支付时设备信息不更新 | 改为 `pending/paying` 幂等更新设备 |

### 5.3 验收证据

```
node_modules/.bin/tsc --noEmit                     # 通过
node_modules/.bin/next build                       # 通过
./scripts/e2e-run.sh scripts/saas-e2e.mjs          # ALL E2E CHECKS PASSED（61 项）
./scripts/e2e-run.sh scripts/commerce-e2e.mjs      # ALL COMMERCE CHECKS PASSED（80 项）
./scripts/e2e-run.sh scripts/payment-e2e.mjs       # ALL PAYMENT CHECKS PASSED（110 项）
```

支付宝专项测试用 `scripts/alipay-mock.mjs`（协议级本地网关：用商户公钥校验我们的签名，
用支付宝私钥签名自己的响应与异步通知）跑真实链路，§51 十条逐条对应：

| § | 场景 | 证据 |
|---|---|---|
| 1 | 创建订单两次不能产生错误权益 | 同 `clientToken`、同商品重复下单都复用同一订单；未支付时账本 0 行、会员仍为免费版；支付后 `order:<id>` 账本恰好 1 行 |
| 2 | 同一通知发送 10 次只发一次会员 | 10 条通知全部应答 `success`；订单 `paid` 一次；`payments` 1 行、`verified=1`、`notify_count=10`；账本 1 行、站内通知 1 条；`payment_notifications` 留存 10 条 |
| 3 | 金额与订单不符拒绝发放 | 有效签名但金额 1.00 的通知 → 订单/支付记录标记「需要确认」，账本 0 行，会员不变，原因写入通知记录；收款主体不符同样拒绝 |
| 4 | 假通知不能通过验签 | 用错误私钥签名 / 无签名 / `app_id` 不符 → 一律 `failure`，订单不动、权益不发，通知以 `verified=0` 落库；未知订单号 → 记录后 `success` 停止无意义重试 |
| 5 | 付款后立即关闭网页仍然到账 | 只发通知、完全不访问结果页：订单 `paid`、加油包额度到账（仅 bonus，会员不变） |
| 6 | 回调延迟最终仍然到账 | 先不通知 → `pay-status` 主动查单结算为 `paid`；随后 2 条迟到通知应答 `success` 且不重复发放，仅 `notify_count` 递增 |
| 7 | 支付页刷新不会新建无限订单 | 连续 4 次发起支付 + 重新下单：`orders` 1 行、`payments` 1 行 |
| 8 | 订单过期不能继续发放 | 过期订单发起支付 → 409 `ORDER_EXPIRED` 并关单；过期后收到付款通知 → 订单转「需要确认」、账本 0 行、结果页提示联系客服且绝不提示重新付款 |
| 9 | 退款两次不能多退 | 用户重复申请复用同一退款单；审核前资金未动；执行成功后订单 `refunded`、`refunded_cents=9900`、权益回收账本 1 行、会员回到免费版；再次申请 409 `ALREADY_REFUNDED`，运营再发起 409，重复执行不改变金额，网关侧只有 1 次资金变动 |
| 10 | 不能通过前端参数把未支付订单改成已支付 | 后台订单无写接口（405）；`action=mark_paid` → 400；`pay-status` 只读（405）；下单携带 `status/payableCents` 被忽略（仍 `pending`、9900）；免费套餐不可 0 元购买；运营主动查单在支付宝未收到付款时不会造出已支付订单；会员访问运营接口一律 403 |

另外覆盖：支付通道状态与掩码（私钥/公钥永不回浏览器）、错误私钥时支付测试给出可执行提示、
收银台参数（`FAST_INSTANT_TRADE_PAY`/`QUICK_WAP_WAY`、金额元字符串、`timeout_express`、
通知与返回地址、RSA2 签名且网关验签通过）、退款结果未知时不谎报成功且不改动订单、
运营确认后重试只退一次、`TRADE_CLOSED` 关闭未支付订单、`WAIT_BUYER_PAY` 不发放、
结果页与会员文案不含协议细节、财务与异常视图可运营。

Phase 2 边界：**仅支持支付宝公钥模式**（证书模式未实现）；未接自动续费/免密代扣（§10.5）；
真实支付宝沙箱与生产联调需要运营者提供 APPID、应用私钥、支付宝公钥与公网 HTTPS 回调地址，
本轮全部验证在协议级本地网关上完成，未产生真实资金流动。
