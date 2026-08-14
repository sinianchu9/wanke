# 百炼计费通道与 Wanke 接入边界

## Wanke 当前支持的直连方式

Wanke 的基础视频生成是服务端直接调用百炼原生视频 API：

```text
/api/v1/services/aigc/video-generation/video-synthesis
```

因此 Wanke 当前的“百炼 Model Studio”配置只接受 **Pay-As-You-Go（按量付费）**凭证与原生 API Root。

推荐配置：

```text
API Key: Pay-As-You-Go Key（常见为 sk-ws-...）
Workspace ID: ws-...
Base URL: 留空
```

填写 Workspace ID 后，Wanke 会自动使用新加坡业务空间专属域名：

```text
https://<WorkspaceId>.ap-southeast-1.maas.aliyuncs.com
```

如果确实需要手工覆盖 Base URL，只填写域名根地址，不要追加 `/compatible-mode/v1` 或 `/api/v1`。

## 为什么 Token Plan Base URL 不能直接填进 Wanke

Token Plan 控制台给出的：

```text
https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
```

是 OpenAI-compatible 接口入口，不是 Wanke 当前使用的原生视频 API Root。把它直接填进旧版 Wanke 后，会被继续拼接 `/api/v1/services/...`，形成不存在的 URL 并返回 404。

更重要的是，阿里云当前规则把 Token Plan / Coding Plan 限定在受支持的 AI 编程工具或 OpenClaw 类 Agent 中交互式使用，不允许把套餐专属 Key 直接放进自动化脚本或自定义应用后端。Wanke 当前属于自定义应用后端直连，因此不把 `sk-sp-...` Token Plan Key 作为直接视频 Provider 使用。

## Wanke 的防误用行为

设置页和运行时会主动识别以下情况：

- `sk-sp-...` Token Plan 专属 Key；
- `token-plan.*` / Coding Plan Endpoint；
- `/compatible-mode/v1`；
- `/apps/anthropic`。

检测到后：

1. 设置页给出明确说明；
2. 保存配置时拒绝把该配置作为 Wanke 直连 Provider；
3. 已经存在数据库或环境变量里的不兼容配置会在运行时被视为不可用于新任务；
4. `npm run doctor` 会直接指出问题来源。

这避免两类风险：一是把兼容接口误当成原生视频接口导致 404；二是把套餐专属 Key 用在官方不允许的应用后端场景而产生订阅或 Key 风险。

## Token Plan 后续接入方向

如果以后需要在 Wanke 中利用 Token Plan，应该通过官方允许的 **AI 工具 / Agent Skill 扩展通道**来设计，而不是让 Wanke Node 后端直接拿 `sk-sp-...` 发请求。这个能力应与当前 Pay-As-You-Go Provider 分开，避免计费、权限和合规边界混在一起。
