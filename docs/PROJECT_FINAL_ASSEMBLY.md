# Wanke Project Final Assembly / 项目成片装配

## 1. 目的

Project / Shot 已经解决：

- 作品属于哪个 Project；
- 镜头顺序；
- 每个 Shot 的候选版本；
- 每个 Shot 明确采用哪个视频；
- 定稿媒体规格检查。

这一阶段把这些已经明确的采用视频转成一个真正的本机 MP4。

核心原则：**先统一规格，再拼接。**

不是把不同模型输出直接裸 concat。

## 2. 输入边界

成片装配只消费：

```text
Project
  ↓
按 position 排序的 Shot
  ↓
每个 Shot 的 selected_job_id
  ↓
该 Job 的视频输出
  ↓
output.archivedFile
```

所有采用视频必须先在任务中心保存到本机。

如果任何一个 Shot：

- 没有采用版本；
- 采用 Job 已不存在；
- 没有视频输出；
- 采用视频没有归档；
- 本机归档文件已经丢失；

本次成片直接停止，并明确指出具体镜头。

不会自动拿其他候选替代。

## 3. 为什么强制本机归档

Provider 返回的云端结果 URL 可能过期。

最终成片属于生产输出，不应该在长流程中依赖临时云链。

因此：

```text
满意结果
  ↓
任务中心保存到本机
  ↓
Project 设为采用
  ↓
项目成片
```

这样同一 Project 可以反复重新装配，不受旧云链失效影响。

## 4. 工具要求

成片需要：

- `ffmpeg`
- `ffprobe`

默认命令名：

```text
ffmpeg
ffprobe
```

也可以配置：

```text
FFMPEG_PATH=/path/to/ffmpeg
FFPROBE_PATH=/path/to/ffprobe
```

单个 FFmpeg 命令默认最大运行 10 分钟：

```text
WANKE_FFMPEG_TIMEOUT_MS=600000
```

编码质量默认：

```text
WANKE_FFMPEG_CRF=20
WANKE_FFMPEG_PRESET=medium
```

Wanke 不会在运行时下载 FFmpeg 二进制。

缺少工具时只禁用项目成片，不影响生成、项目、Shot、定稿等其他能力。

## 5. 目标媒体规格

第一版为了减少用户配置，目标画面规格由**第一个定稿 Shot**决定：

- width：第一个 Shot 宽度；
- height：第一个 Shot 高度；
- FPS：第一个 Shot FPS；
- 如果尺寸是奇数，会向下调整到偶数；
- FPS 最大限制为 60；
- 无法得到 FPS 时默认 30。

其他 Shot 会保持比例缩放：

```text
scale = fit
pad = black
```

即：

- 不拉伸人物/产品；
- 不强行裁掉画面；
- 尺寸不一致时用黑边补足目标画布。

## 6. 统一编码

每一个 Shot 先单独标准化为：

```text
container: MP4
video: H.264 / libx264
pixel format: yuv420p
audio: AAC
audio sample rate: 48000 Hz
audio channels: stereo
```

视频默认 CRF 20。

### 有音轨

原音频：

- 重采样到 48kHz；
- 转 AAC；
- 双声道；
- 如果音频比画面短，使用 `apad` 补静音到视频结束。

因此不会因为 `-shortest` 把画面提前截短。

### 无音轨

系统生成 48kHz 双声道静音轨，并严格按视频探测时长结束。

这样所有标准化片段具有一致的音视频结构。

## 7. 拼接

所有片段标准化后才进入 concat：

```text
normalized Shot 01
normalized Shot 02
normalized Shot 03
        ↓
FFmpeg concat demuxer
        ↓
-c copy
        ↓
final MP4
```

因为每个片段已经统一为同一套编码/画面/FPS/音频结构，最终 concat 不再承担“猜不同规格是否兼容”的风险。

## 8. 顺序

最终顺序完全由 Project 的 Shot `position` 决定。

不会：

- 根据任务创建时间排序；
- 根据 Job ID 排序；
- 自动把最新版本放到前面；
- 自动修改用户已经确定的镜头顺序。

## 9. 输出与记录

最终文件保存到现有 Wanke 本机输出目录：

```text
WANKE_OUTPUT_DIR
```

未配置时默认：

```text
./data/outputs
```

文件名：

```text
project-<projectId>-<assemblyId>.mp4
```

可直接通过现有：

```text
/api/archive/<fileName>
```

播放和 Range 请求。

数据库 `project_assemblies` 保存：

- assembly id；
- project id；
- 成片文件名；
- 目标规格；
- 总时长；
- Shot 数量；
- 本次使用的 Shot / Job / 归档文件快照；
- 每个源视频的原始探测规格；
- 创建时间。

这意味着以后 Project 改了采用版本，旧成片仍然知道当时到底用了哪些素材。

## 10. 删除规则

删除单个成片：

- 删除 `project_assemblies` 记录；
- 删除对应本机成片文件；
- 不删除 Shot；
- 不删除 Job；
- 不删除源归档视频。

删除整个 Project：

- Project / Shot / 组织关系按既有规则删除；
- 成片数据库记录级联删除；
- API 会根据删除前的记录尽力清理项目成片文件；
- 原始 Job 和原始归档视频仍然保留。

## 11. 限制

第一版限制：

- 最多 60 个 Shot；
- 定稿总时长最多 15 分钟；
- 顺序单轨；
- 没有转场；
- 没有 BGM 轨；
- 没有字幕轨；
- 没有多轨音频混音；
- 没有关键帧编辑；
- 没有片头片尾模板。

这不是 NLE 编辑器。

它是**可靠的 AI 镜头装配层**。

## 12. 推荐操作流程

```text
创建 Project
  ↓
建立 Shot
  ↓
生成候选
  ↓
选采用版本
  ↓
保存采用视频到本机
  ↓
调整 Shot 顺序
  ↓
检查成片规格
  ↓
生成项目成片
  ↓
预览 / 保存最终 MP4
```

## 13. 失败行为

任一标准化或 concat 命令失败时：

- 不写成功数据库记录；
- 删除本次未完成的 final MP4；
- 清理 `.assembly-*` 临时目录；
- 保留所有原始归档视频；
- 返回 FFmpeg stderr 尾部的有效错误信息。

不会把半成品标记成成功。

## 14. 验收标准

- [x] FFmpeg/ffprobe 都存在才允许成片；
- [x] 不运行时下载二进制；
- [x] 只消费明确采用的 Shot；
- [x] 只消费本机归档视频；
- [x] 每个源视频先 ffprobe；
- [x] 目标尺寸/FPS 有明确规则；
- [x] 保持比例缩放并补边；
- [x] 所有片段统一 H.264/yuv420p；
- [x] 音频统一 AAC/48k/双声道；
- [x] 无音频时补静音；
- [x] 短音轨不会截短视频；
- [x] 最终严格按 Shot 顺序 concat；
- [x] 成片文件走现有 archive 播放能力；
- [x] 保存本次源素材快照；
- [x] 失败清理临时目录和半成片；
- [x] 可删除单个成片而不影响源任务；
- [x] Project 删除尽力清理成片文件。
