# Wanke SaaS 设计与规则

本文档是 Wanke 商业化（账号、套餐、配额、多租户隔离、管理后台）的唯一事实来源。
视频引擎（`lib/video`、`lib/yike`、任务轮询、本地归档）保持不变，SaaS 能力全部叠加在边界层。

## 1. 数据模型

| 表 | 说明 |
|---|---|
| `users` | id, email(唯一，NOCASE), name, password_hash(scrypt), role(user/admin), status(active/disabled), avatar_url, created_at, updated_at, last_login_at |
| `sessions` | token_hash(SHA-256(AUTH_SECRET+token)), user_id, expires_at(30 天滑动), last_seen_at |
| `memberships` | user_id(PK), plan(free/pro/studio), status, quota_limit_videos, quota_used_videos, period_start, period_end |
| `works` | id, user_id, title, description, cover_url, video_url, archived_file, job_ids_json, status(active/archived), visibility(private) |
| `admin_audit_logs` | id, admin_user_id, action, target_type, target_id, meta_json, created_at |
| `login_attempts` | email, ip, success, created_at（登录限流） |

既有表迁移（幂等，缺列才 ALTER，重复执行安全）：
`jobs`、`assets`、`projects`、`subject_cards` 增加 `user_id`（可空）+ 索引。

**历史数据（Legacy data）**：迁移前创建的数据 `user_id IS NULL`。
这些数据对所有普通会员不可见，仅在管理后台可见（任务列表显示「历史/系统数据」）。
不删除、不猜测归属，避免误伤。

## 2. 认证与安全

- 密码：`scrypt`（N=16384, r=8, p=1，每用户独立盐），不引入原生依赖。
- 会话：服务端 DB 会话，`wanke_session` Cookie（HttpOnly、SameSite=Lax、
  HTTPS 下自动 Secure）。30 天滑动过期。
- `AUTH_SECRET` 作为会话 token 哈希盐；**轮换 AUTH_SECRET 会使所有会话失效**。
- 守卫：`getCurrentUser()` / `requireUser()` / `requireAdmin()`（`lib/auth.ts`）。
- CSRF：SameSite=Lax 为主，写接口附加 Origin/Host 一致性校验。
- 登录限流：同一邮箱+IP 15 分钟内失败 5 次后拒绝（429）。
- 客户端从不携带 role / userId 做决策，全部以服务端会话为准。
- 扩展点（结构已预留）：邮箱验证、找回密码、OAuth（users 表字段与 sessions 模型兼容）。

## 3. 套餐与配额

套餐常量在 `lib/membership.ts` 的 `PLANS`（可配置）：

| Plan | 月生成条数 | 演示价格 |
|---|---|---|
| free | 10 | 免费 |
| pro | 100 | ¥99/月 |
| studio | 1000 | ¥699/月 |

**扣减策略（明确且可审计）——提交预扣制：**
1. 提交生成任务前：登录校验 → 会员状态校验 → 原子预扣。
   预扣使用带约束的原子 UPDATE（`quota_used + n <= quota_limit`），
   better-sqlite3 单连接串行写入，天然避免并发超扣。
2. 远端提交同步失败（Provider 在入队前拒绝）：**退回额度**（用户无感）。
3. 远端已受理、异步生成失败：**不退回**（商业规则，防止失败循环刷量）。
4. 批量提交：一次性预扣整批额度，逐条提交，同步失败的逐条退回。
5. 重试 / 类似版本 / 继续创作：属于新的生成，正常计 1 条。
6. 额度不足：返回 `402 + code=QUOTA_EXCEEDED` 稳定错误，前端展示升级引导。

**周期规则**：30 天周期（`period_start/period_end`），惰性滚动——
读取会员信息时若周期已过期，自动重置 `quota_used=0` 并滚动到当前周期。
不做复杂续费状态机；会员状态始终随周期自动续展（真实支付接入是扩展点）。

**计费扩展点**：`POST /api/membership/switch` 当前为「模拟支付」；
接入真实渠道时替换为支付回调驱动 `switchPlan()`，其余逻辑不变。

## 4. 多租户隔离

- 所有新数据写入时绑定当前用户（`jobs/assets/projects/subject_cards/works`）。
- 所有列表 / 详情 / 更新 / 删除路由：先鉴权，再校验归属；非归属资源返回 404（不泄露存在性）。
- 项目子资源（镜头、合成、字幕、音频、转场）通过所属项目的归属校验间接隔离。
- 归档文件 `/api/archive/[name]`：仅当请求者拥有引用该文件的任务或作品时才提供。
- 本地上传输入（`data/inputs`）为临时文件，靠不可猜测引用 + 鉴权保护，24 小时清理。
- 管理员：可读全站数据；受控写（改套餐、启停用户、删作品、改系统配置）全部写审计日志。

## 5. 权限矩阵

| 能力 | 访客 | 会员 | 管理员 |
|---|---|---|---|
| 浏览产品页 | ✅ | ✅ | ✅ |
| 提交生成任务 | ❌ 401 | ✅（受配额） | ✅（受配额） |
| 任务/素材/主体/项目/作品 | ❌ | 仅本人 | 全站读 |
| 会员中心 / 模拟升级 | ❌ | ✅ | ✅ |
| /admin 与 /api/admin/* | ❌ | ❌ 403 | ✅（写操作留审计） |
| 系统配置修改 | ❌ | ❌ 403 | ✅ |

## 6. 管理员种子

- 设置环境变量 `ADMIN_EMAIL` 后：
  - 该邮箱注册时自动提升为 admin；
  - 已存在的账号在下次服务启动（db 初始化）时提升为 admin。
- 未配置 `ADMIN_EMAIL` 时，可直接在 SQLite 中执行：
  `UPDATE users SET role='admin' WHERE email='you@example.com';`

## 7. API 一览（SaaS 层）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register | 注册并自动登录（默认 free） |
| POST | /api/auth/login | 登录（限流保护） |
| POST | /api/auth/logout | 登出 |
| GET | /api/auth/me | 当前用户 + 会员信息 |
| GET | /api/membership | 会员详情 + 套餐目录 |
| POST | /api/membership/switch | 模拟支付切换套餐（新周期，额度重置） |
| GET/POST | /api/works | 作品列表 / 从成功任务保存作品 |
| PATCH/DELETE | /api/works/[id] | 重命名 / 归档 / 删除 |
| GET | /api/admin/stats | 运营数字 |
| GET | /api/admin/users | 用户检索（分页/筛选） |
| PATCH | /api/admin/users/[id] | 改套餐 / 清零用量 / 启停用户（审计） |
| GET | /api/admin/jobs | 全站任务（筛选） |
| GET | /api/admin/works | 全站作品 |
| DELETE | /api/admin/works/[id] | 删除作品（审计） |
| GET | /api/admin/audit-logs | 审计日志 |
| GET | /api/admin/system | 配置摘要 / Provider 状态 / 套餐常量 |

既有生成类 API（/api/jobs、/api/assets、/api/projects 等）协议保持不变，
仅叠加鉴权、归属校验与配额预扣；错误形状统一为 `{ error, code? }`。

## 8. 已知限制与下一步商业化清单

- 支付：当前为模拟切换；需接入支付宝/微信/Stripe + 支付回调与发票。
- 邮件：邮箱验证、找回密码、配额告警通知（结构已预留，未实现完整流程）。
- OAuth：微信/Google 登录（users/sessions 模型兼容，需加 identities 表）。
- Postgres：当前 SQLite + WAL 满足单机；表结构与 SQL 均使用标准语法，
  迁移时替换 `lib/db.ts` 驱动并复核 `LIKE`/JSON 字段即可。
- 组织/团队：当前仅 user/admin 两级；多团队需引入 organizations 与 RBAC。
- 监控：任务失败率、配额使用率、登录失败告警建议接入现有运维体系。
- 存储配额：`works` 未限制存储量（仅生成条数配额）；可按需扩展存储额度字段。
