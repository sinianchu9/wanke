# Project BGM / Loudness

## 目标

项目成片现在增加一个独立的声音母版层。它不改变 Shot、候选任务或采用关系，只在最终项目 MP4 生成时处理声音。

推荐流程：

```text
Shot 定稿
  ↓
保存采用视频到本机
  ↓
镜头画面 / 音频结构统一
  ↓
按 Shot 顺序形成时间线
  ↓
项目声音母版
  ├─ 原声响度归一化
  ├─ 可选 BGM
  ├─ 原声 / BGM 相对增益
  └─ 最终目标 LUFS
  ↓
项目 MP4
```

## 项目声音设置

每个 Project 独立保存：

- `bgmAssetId`：可选，必须引用素材库里的 `audio`；
- `targetLufs`：最终成片目标响度，允许 -24 到 -9 LUFS；
- `originalGainDb`：使用 BGM 时的镜头原声相对增益，允许 -12 到 +6 dB；
- `bgmGainDb`：BGM 相对增益，允许 -30 到 0 dB。

默认值：

- 目标响度：`-16 LUFS`；
- 原声相对增益：`0 dB`；
- BGM：关闭；
- BGM 相对增益：`-12 dB`。

## BGM 来源

BGM 直接复用现有素材库，不增加第二套音乐库。

用户可以：

1. 在素材库上传音频；
2. 或保存一个公网音频 URL；
3. 在作品项目的“项目声音”中选择这条音频。

删除素材库里的该音频后，SQLite 外键会把 Project 的 `bgm_asset_id` 自动置空；项目、Shot、历史成片不受影响。

## 最终混音逻辑

### 没有 BGM

时间线音轨直接经过 `loudnorm`，最终输出到项目目标 LUFS。

### 使用 BGM

1. Shot 时间线原声先归一化；
2. 再应用 `originalGainDb`，用于控制它与 BGM 的相对关系；
3. BGM 单独归一化后应用 `bgmGainDb`；
4. BGM 自动循环覆盖整个项目；
5. BGM 首尾约 1 秒淡入 / 淡出；
6. 原声与 BGM 通过 `amix` 合并；
7. 使用 limiter 控制峰值；
8. 最终混音再次回到项目 `targetLufs`。

这保证“目标响度”和“原声/BGM 相对关系”是两个不同维度。

## 为什么不在每个 Shot 内加 BGM

BGM 是项目级声音，不属于某一个生成任务。如果在 Shot 阶段混进去，会导致：

- 延长或编辑视频时重复带入音乐；
- 换候选版本需要重新混音；
- Shot 排序以后音乐连续性被打断；
- 后续字幕、转场和成片母版难以统一管理。

因此 BGM 只在最终成片阶段处理。

## 远端 BGM 安全

如果素材是公网 URL，服务器不会把 URL 直接交给 FFmpeg 长时间读取。

流程是：

```text
素材 URL
  ↓
服务器安全检查
  ↓
下载到本次 assembly 临时目录
  ↓
FFmpeg 读取本机临时文件
  ↓
成片结束后删除临时文件
```

安全限制包括：

- 只接受 HTTP / HTTPS；
- 拒绝 localhost / `.localhost` / `.local`；
- 拒绝私网、loopback、link-local、CGNAT 等地址；
- 域名解析到私网地址也拒绝；
- 每次 HTTP 重定向都会重新验证；
- 默认最多 5 次重定向；
- 默认下载超时 5 分钟；
- 默认最大 250 MB；
- 下载大小即使没有 `Content-Length` 也会通过流式计数限制。

可通过：

- `WANKE_BGM_DOWNLOAD_TIMEOUT_MS`
- `WANKE_MAX_BGM_MB`

调整下载边界。

## 历史成片

每次 Project assembly 会把当时的声音配置快照写入 `project_assemblies.settings_json`：

- target LUFS；
- original gain；
- BGM gain；
- BGM asset ID；
- BGM 名称。

之后修改项目声音设置不会重写旧 MP4，也不会改变旧记录。

## 当前明确不做

这一阶段没有：

- 自动对白 ducking / sidechain；
- 每个 Shot 不同的 BGM；
- BGM 剪辑点和关键帧；
- 多条音乐轨；
- 音效轨；
- 多轨 NLE；
- AI 自动选音乐。

这些不应该和项目级基础响度闭环混在同一阶段。
