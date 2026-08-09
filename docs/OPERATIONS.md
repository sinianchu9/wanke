# Wanke 运维与数据安全

## 1. 凭证与地域

只在 `.env.local`：

```bash
ALIYUN_ACCESS_KEY_ID=...
ALIYUN_ACCESS_KEY_SECRET=...
ALIYUN_REGION_ID=ap-southeast-1
```

Wanke 当前默认使用万镜一刻新加坡地域：

```text
RegionId: ap-southeast-1
Endpoint: yike.ap-southeast-1.aliyuncs.com
```

官方 2026-07-07 Core 与 2026-03-19 Studio SDK 都原生包含该地域 Endpoint。切回上海时使用：

```bash
ALIYUN_REGION_ID=cn-shanghai
```

默认不要同时手工填写 `ALIYUN_YIKE_ENDPOINT`；只有需要显式覆盖官方区域 Endpoint 时再配置。Wanke 不做上海/新加坡自动回退，避免跨地域任务、媒资与账户状态被静默混用。

不要使用 `NEXT_PUBLIC_` 前缀。浏览器永远不应得到长期 AK/SK。

建议给自用 AK 最小权限，测试完临时 AK 后轮换或删除。

> 已存在的 `.env.local` 不会被 Git 更新覆盖。如果之前写的是 `ALIYUN_REGION_ID=cn-shanghai`，拉取新版代码后仍需手工改为 `ap-southeast-1` 并重启 Wanke。

## 2. 数据目录

默认：

```text
data/
  wanke.db
  wanke.db-wal
  wanke.db-shm
  outputs/
```

- DB：任务、素材、请求、远端响应、结果元数据。
- outputs：用户主动归档的结果文件。

不要把 `data/` 提交 Git。

### 素材删除语义

素材库删除时有两种路径：

- **只删本地**：仅移除 Wanke SQLite 索引，阿里云媒资不变。
- **同步云端逻辑删除**：删除本地索引，同时分别清理 2026-07-07 Core 与 2026-03-19 Studio 的媒资登记；Core 使用 `DeleteMedias(deletePhysicalFiles=false)`，Studio 使用 `DeleteYikeAssetMediaInfos(logicDelete=true)`，不主动强制物理删除底层文件。

这项设计是为了避免个人工作流里误删仍被其他任务引用的源文件。

## 3. 备份

最简单可靠的方式：停止 Wanke 后完整备份 `data/`。

Docker：

```bash
docker compose stop
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
docker compose start
```

## 4. 结果归档上限

默认单文件 2048MB：

```bash
WANKE_MAX_ARCHIVE_MB=2048
```

归档是流式的，不把整个视频载入 Node 内存。超出限制会终止并删除 `.part` 临时文件。

## 5. SQLite

使用 WAL，适合单用户并发读写。Wanke 不需要 Redis；真正的视频执行状态在 Yike，SQLite 只是本地控制面和历史记录。

## 6. 双版本健康检查

侧边栏“测试连接”会显示实际 RegionId 与 Endpoint，并分别探测：

- Core 2026-07-07：核心视频 / media surface 是否可访问；
- Studio 2026-03-19：营销 Agent / 故事板 surface 是否可访问。

Core 探测只调用轻量媒资分类接口，**不会提交真实视频任务**。因此“Core API 可访问”只证明 AK、签名、地域 Endpoint 与基础 Core surface 正常，**不等于 AI Generation 会员资格已开通**。AI 视频生成的会员资格只在实际提交生成任务时由 Yike 校验。

若 Studio 返回 `MainAccountUserNotFound`，Wanke 会解释为当前地域的 Studio 主账户未初始化或尚未开通，而不是把它误判成 AK 失效。

## 7. 故障处理

### `Forbidden.MembershipRequired`

说明请求已经到达 Yike，但当前账号/地域对应的会员资格不足以调用该能力。它不是普通的 Endpoint 或签名错误。

### `MainAccountUserNotFound`

说明 Studio surface 找不到当前账号在该地域对应的主账户实体。先确认万镜一刻产品已经开通/激活，再测试数字人口播、旁白、快速复刻和故事板。

### 任务提交失败

任务记录仍保存在 SQLite，状态标记 failed，并保留错误。修改参数后可重新提交。

### 页面关闭

不影响远端任务。重新打开页面后活动任务继续轮询。

### Storyboard 部分镜头失败

先查看 `failedShots`，优先使用“续跑故事板”；不要马上复制整单重跑。

### 视频结果打不开

远端签名 URL 可能已过期。对重要结果在成功后点击归档。已经过期且没有归档时，需要依据原任务重新查询是否能取得新的 URL；如果服务端不再返回有效 URL，则只能重跑或从云端媒资另行获取。

### 翻译一直显示待确认

这是当前实现的明确限制：Yike 2026-07-07 SDK 没有同版本 query model。去任务指定的 OSS 输出目录检查文件。
