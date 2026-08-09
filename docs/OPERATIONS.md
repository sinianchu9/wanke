# Wanke 运维与数据安全

## 1. 凭证

只在 `.env.local`：

```bash
ALIYUN_ACCESS_KEY_ID=...
ALIYUN_ACCESS_KEY_SECRET=...
```

不要使用 `NEXT_PUBLIC_` 前缀。浏览器永远不应得到长期 AK/SK。

建议给自用 AK 最小权限，测试完临时 AK 后轮换或删除。

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

侧边栏“测试连接”会分别探测：

- Core 2026-07-07：核心视频 / media surface；
- Studio 2026-03-19：营销 Agent / 故事板 surface。

Core 失败会判定主连接失败；Studio 单独失败时仍会显示局部告警，方便区分“基础生成可用”和“营销/故事板不可用”。

## 7. 故障处理

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
