# Wanke 运维与数据安全

## 1. 凭证与地域

Wanke 支持在“设置”页面保存视频服务配置，也保留环境变量作为部署级 fallback。真实凭证只保存在服务端 SQLite / `.env.local`，不要使用 `NEXT_PUBLIC_` 前缀。

环境变量示例：

```bash
DASHSCOPE_API_KEY=...
ALIYUN_MODELSTUDIO_WORKSPACE_ID=...

ALIYUN_ACCESS_KEY_ID=...
ALIYUN_ACCESS_KEY_SECRET=...
ALIYUN_REGION_ID=ap-southeast-1
```

Wanke 当前默认使用万镜一刻新加坡地域：

```text
RegionId: ap-southeast-1
Endpoint: yike.ap-southeast-1.aliyuncs.com
```

切回上海时使用：

```bash
ALIYUN_REGION_ID=cn-shanghai
```

默认不要同时手工填写 `ALIYUN_YIKE_ENDPOINT`；只有需要显式覆盖官方区域 Endpoint 时再配置。Wanke 不做上海/新加坡自动回退，避免跨地域任务、媒资与账户状态被静默混用。

建议给自用 AK 最小权限，测试完临时 AK 后轮换或删除。

> 已存在的 `.env.local` 不会被 Git 更新覆盖。UI 设置的优先级高于环境变量；`npm run doctor` 会同时读取当前 SQLite 设置和环境变量，不会再因为只在 UI 配置凭证而误报“未配置”。

## 2. 系统运行依赖

### Node.js

要求 Node.js 22+。

### FFmpeg / ffprobe

AI 视频本身在云端生成，不需要本地 GPU；但 **Project 最终成片**依赖：

- `ffmpeg`：统一编码、转场、声音/BGM、最终 MP4；
- `ffprobe`：视频时长、分辨率、FPS、音轨和最终文件校验。

裸机 Ubuntu / Debian：

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

`ffmpeg` Debian/Ubuntu 软件包会同时提供 `ffprobe`。

Docker：仓库 Dockerfile 已在 runner 镜像中安装 `ffmpeg`，使用 `docker compose up -d --build` 无需宿主机额外安装。

如果二进制不在 PATH，可配置：

```bash
FFMPEG_PATH=/path/to/ffmpeg
FFPROBE_PATH=/path/to/ffprobe
```

部署或升级后建议执行：

```bash
npm run doctor
```

Doctor 会检查 Node 版本、当前有效视频服务配置、数据目录写权限、FFmpeg 和 ffprobe。

## 3. 数据目录

默认：

```text
data/
  wanke.db
  wanke.db-wal
  wanke.db-shm
  inputs/
  outputs/
```

- DB：任务、素材、Project / Shot、设置、请求、远端响应、结果元数据和成片记录；
- inputs：百炼本地图片直传的可重试短期源文件；
- outputs：自动/手动归档的视频结果，以及 Project 最终 MP4。

不要把 `data/` 提交 Git。

### 本地图片生命周期

本地 JPG / PNG / WEBP 会保存为 `wanke-input://...` 短引用。只要仍有 Job request 引用该图片，删除页面临时选择不会物理删除源文件；相关 Job 全部删除后才允许清理。

### 素材删除语义

素材库删除时默认只移除 Wanke SQLite 索引，不主动删除已经生成的视频和历史成片。需要扩展工作流云端清理时，由对应 Yike 删除逻辑处理；不要把“从素材库移除”理解成强制物理删除所有云端文件。

## 4. 备份

最简单可靠的方式：停止 Wanke 后完整备份 `data/`。

Docker：

```bash
docker compose stop
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
docker compose start
```

`data/` 同时包含 SQLite、可重试本地输入、已归档结果和最终成片，因此只备份数据库并不等于完整备份作品。

## 5. 结果归档上限

默认单文件 2048MB：

```bash
WANKE_MAX_ARCHIVE_MB=2048
WANKE_ARCHIVE_TIMEOUT_MS=1800000
```

归档是流式的，不把整个视频载入 Node 内存。无效的数值配置会回退到安全默认值；超出限制会终止并清理 `.part` 临时文件。

快速创作的视频在远端任务成功后会尽力自动归档；用户点击“生成最终视频”时还会再次补归档。因此普通用户不需要把“先去任务中心手动保存”当成成片前置步骤。

## 6. 最终成片资源

当前成片链会把采用镜头统一为 H.264 / yuv420p / AAC，再处理转场、BGM/响度、字幕轨并生成最终 MP4。

默认：

```bash
WANKE_FFMPEG_TIMEOUT_MS=600000
WANKE_FFPROBE_TIMEOUT_MS=45000
WANKE_FFMPEG_PRESET=medium
WANKE_FFMPEG_CRF=20
```

小型 2C/4GB 服务器可以正常承担个人 1080P 成片；如果 CPU 较弱，可以把 `WANKE_FFMPEG_PRESET` 调成 `fast` 或 `veryfast` 换取更快编码。不要为了提升速度随意并发很多最终成片任务，FFmpeg 才是当前服务器侧主要 CPU/内存消耗来源。

## 7. SQLite

使用 WAL，适合当前单机/个人工作台的并发读写。Wanke 不需要 Redis；真正的视频执行状态在远端 Provider，SQLite 是本地控制面和历史记录。

Job 删除如果会改变 Shot 候选或当前采用版本，Wanke 会同步更新 Shot / Project 时间戳，使历史 MP4 正确标记为“旧成片”，不会把已经改变来源关系的旧视频冒充当前成片。

## 8. 状态查询与恢复

页面打开后会继续查询可轮询任务。

远端 Provider 如果临时返回 Wanke 尚未识别的状态：

- Job 不会从自动轮询队列消失；
- `pollable=false` 的明确不可查询任务除外；
- 未知可轮询状态会降低到至少约 30 秒一次查询，等待恢复为已知状态。

这可以避免 Provider 新增中间状态时，一次未知响应就让长任务永久停止追踪。

扩展工作流健康检查会分别探测 Core / Studio surface。健康检查通过只证明 AK、签名、地域和 API surface 可访问，不等于每个 AI 能力的会员资格已经开通；生成资格仍以真实提交结果为准。

## 9. 故障处理

### `Forbidden.MembershipRequired`

请求已经到达 Yike，但当前账号/地域对应会员资格不足。它不是普通 Endpoint 或签名错误。

### `MainAccountUserNotFound`

Studio surface 找不到当前地域的主账户实体。先确认万镜一刻产品已经在对应地域初始化/开通。

### 任务提交失败

任务记录保存在 SQLite 并标记 failed。快速作品可以直接在“我的作品”里重试；高级任务也可以在任务中心重试。

### 页面关闭

不影响已经提交到远端的任务。重新打开页面后，可查询任务会继续轮询。

### 视频结果打不开

远端签名 URL 可能过期。快速创作结果会尽力自动归档；高级任务的重要结果仍建议保存到本机。已经过期且没有归档时，如果 Provider 不能重新提供有效 URL，只能重新生成或从云端媒资另行取回。

### 最终视频按钮失败并提示 FFmpeg / ffprobe

先执行：

```bash
npm run doctor
```

裸机安装 FFmpeg；Docker 用户重新构建当前镜像：

```bash
docker compose up -d --build
```

已经生成并归档的镜头不会因为补装 FFmpeg 丢失。

### Storyboard 部分镜头失败

先查看 `failedShots`，优先使用“续跑故事板”；不要马上复制整单重跑。

### 视频翻译一直显示待确认

这是明确能力边界：当前 Yike 2026-07-07 SDK 没有同版本 query model，该任务会标记 `pollable=false`，不会被未知状态恢复逻辑反复查询。到任务指定 OSS 输出目录检查结果。
