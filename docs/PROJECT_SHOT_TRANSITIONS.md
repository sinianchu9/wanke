# Project Shot Transitions

## 定位

Shot 转场属于 Project 时间线层，发生在所有采用镜头已经完成媒体规格统一之后、项目 BGM / 响度和字幕之前。

当前成片顺序：

```text
采用 Shot
  ↓
统一分辨率 / FPS / 编码 / 音轨结构
  ↓
Shot 转场时间线
  ↓
项目 BGM / LUFS 母版
  ↓
Project 字幕轨
  ↓
最终 MP4
```

## 第一阶段只提供两种

### 直接切换 `cut`

这是默认模式。

已经统一规格的 Shot 通过 FFmpeg concat demuxer 顺序连接，使用 `-c copy`。

优点：

- 不为转场额外编码视频；
- 最快；
- 质量损失最少；
- 最适合大量镜头或本身已经有剪辑节奏的视频。

### 淡化 `fade`

所有相邻 Shot 使用同一淡化时长。

- 视频：`xfade=transition=fade`
- 原声：`acrossfade`

画面和声音会一起交叉过渡，不会出现画面已经柔和过渡但声音仍然硬切的问题。

## 淡化时长

Project 可以统一设置：

- 最短 `0.2s`
- 最长 `1.5s`
- 默认 `0.5s`

第一阶段不支持每一个 Shot 边界独立配置。

## 时间轴变化

淡化本质上让相邻 Shot 重叠。

例如：

```text
Shot A 5s
Shot B 5s
Shot C 5s
转场 0.5s
```

直接切换：

```text
5 + 5 + 5 = 15s
```

淡化：

```text
5 + 5 + 5 - 0.5 × 2 = 14s
```

因此 Project 不再把“所有源视频时长相加”当成最终时间轴长度。

`renderProjectTimeline()` 返回真实 `timelineDuration`，后续：

- BGM 循环；
- BGM 淡出位置；
- 最终 LUFS 音频母版；
- SRT 字幕尾部校验；
- assembly 历史记录；

全部使用这个转场后的时长。

## 为什么先统一媒体规格

`xfade` 要求输入画面具备可兼容的：

- 分辨率；
- 像素格式；
- 帧率；
- 时间基。

Wanke 已经先把每个 Shot 归一为同一个目标规格，再进入转场。

转场输入还会显式：

- 视频 `settb=AVTB,setpts=PTS-STARTPTS`
- 音频 `aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS`

避免不同来源视频残留时间戳影响 xfade / acrossfade。

## 短镜头保护

如果某个 Shot 时长小于或接近转场时长，淡化会拒绝执行，并告诉用户：

- 缩短淡化时长；
- 或改回直接切换。

不会自动吞掉整个短镜头。

## 规模限制

Project 原有单次成片上限：

- 最多 60 个 Shot；
- 源镜头总时长最多 15 分钟。

但淡化模式需要构建一个多输入 FFmpeg filter graph，并且会增加一次视频编码。

因此第一阶段额外限制：

- 淡化最多 30 个 Shot。

超过 30 个 Shot 时可以：

- 使用直接切换；
- 或把长项目拆成章节再分别装配。

## 编码成本

### cut

Shot 已经统一规格以后，时间线阶段使用 stream copy，不增加一次视频转码。

### fade

由于 xfade 必须渲染新像素，时间线阶段会：

- 再编码 H.264；
- 使用项目现有 `WANKE_FFMPEG_PRESET`；
- 使用项目现有 `WANKE_FFMPEG_CRF`。

因此 fade 比 cut 更慢、更耗 CPU，也多一次有损编码。

这是第一阶段为了可靠实现真实视觉转场接受的明确成本，不会隐藏。

## 历史成片记录

每条 `project_assemblies.settings_json` 记录：

- `transitionType`
- `duration`
- `boundaryCount`
- 是否真正 render
- 转场后的 `timelineDuration`

如果 Project 只有一个 Shot，即使设置了 fade，也没有边界可应用，因此记录 `rendered=false`。

## 当前明确不做

这一阶段没有：

- 每个 Shot 边界独立转场；
- wipe / slide / zoom 等大量模板；
- 转场预览缓存；
- 转场关键帧；
- J-cut / L-cut；
- 多轨 NLE；
- AI 自动决定转场。

第一阶段的目标是把：

```text
Shot 顺序
+ 真实画面/声音重叠
+ 后续 BGM
+ 后续字幕
+ 最终时长
```

形成一个正确、可追溯的生产闭环。
