# Wanke Project Media Readiness / 成片规格检查

## 1. 目的

在真正拼接项目定稿镜头前，Wanke 先确认每个采用视频的真实媒体规格，而不是假设所有模型输出都天然兼容。

检查内容包括：

- 视频编码；
- 分辨率；
- 像素格式；
- FPS；
- 时长；
- 是否存在音轨；
- 音频编码；
- 音频采样率；
- 音频声道数。

## 2. 工具边界

这一层使用服务器系统中的 `ffprobe`。

默认命令：

```text
ffprobe
```

也可以通过环境变量指定：

```text
FFPROBE_PATH=/path/to/ffprobe
```

单个视频默认超时 45 秒，可通过以下变量调整：

```text
WANKE_FFPROBE_TIMEOUT_MS=45000
```

Wanke 不会在运行时偷偷下载或安装 FFmpeg。

如果服务器没有 `ffprobe`：

- Project 正常；
- Shot 正常；
- 视频生成正常；
- 定稿正常；
- 只禁用“成片规格检查”，并明确提示原因。

## 3. 探测来源

如果定稿结果已经保存到本机：

```text
output.archivedFile
  ↓
WANKE_OUTPUT_DIR / data/outputs
  ↓
ffprobe 本机文件
```

这是首选方式。

如果尚未归档，则使用 Provider 返回的 `outputUrl` 远端探测。

远端 URL 过期时，该 Shot 会单独显示探测失败，不会把整个 Project 伪装成“规格一致”。

## 4. 并发边界

项目可能有很多 Shot。

媒体探测最多同时执行 3 个 `ffprobe`，并保持最终返回结果与 Shot 顺序一致。

这样避免：

- 串行探测造成超长等待；
- 无限制并发压垮机器或远端媒体服务。

## 5. 主要规格一致性

Wanke 当前使用以下字段形成媒体 profile：

```text
video codec
resolution
pixel format
frame rate
audio presence
audio codec
audio sample rate
audio channels
```

如果所有 Shot 都已定稿、全部探测成功，而且 profile 相同：

```text
profilesAligned = true
```

这表示**主要媒体规格一致**。

它不等于“可以无条件直接 concat”。真正装配时仍需考虑：

- container；
- time base；
- timestamp；
- GOP/keyframe；
- metadata；
- 音视频起始时间；
- 其他封装边界。

所以界面不会显示“保证可直接拼接”。

## 6. 页面使用方式

```text
作品项目
  ↓
所有需要的 Shot 选择采用版本
  ↓
定稿顺序预览
  ↓
点击“检查成片规格”
```

结果按 Shot 顺序显示，例如：

```text
01 · 产品特写
1920×1080 · h264 · 24fps · 5s
aac · 48000Hz · 2ch

02 · 模特佩戴
1920×1080 · h264 · 24fps · 10s
无音轨
```

第二个镜头虽然画面规格相同，但音轨结构不同，因此 profile 不一致，下一阶段应先统一音频结构再装配。

## 7. 为什么这一步在拼接之前

正确生产链是：

```text
Project
  ↓
Shot 顺序
  ↓
明确采用版本
  ↓
保存重要结果到本机
  ↓
媒体规格探测
  ↓
确定统一规格策略
  ↓
FFmpeg 装配 / 时间线
```

如果跳过规格探测直接做“一键拼接”，很容易出现：

- 画面尺寸跳变；
- FPS 不一致；
- 音轨突然消失；
- 声音采样率变化；
- concat 失败；
- 播放器兼容异常。

## 8. 当前明确不做

本阶段不做：

- 自动安装 FFmpeg；
- 自动下载远端视频到本机；
- 自动转码；
- 自动补静音音轨；
- 自动裁切/加黑边；
- 自动改变 FPS；
- 自动拼接成片。

这些属于下一阶段“媒体归一化 + 成片装配”。

## 9. 验收标准

- [x] ffprobe 是可选能力；
- [x] 支持 `FFPROBE_PATH`；
- [x] 优先探测本机归档文件；
- [x] 支持远端 HTTP/HTTPS 视频；
- [x] 单视频探测有超时；
- [x] 项目探测最多 3 路并发；
- [x] 保持 Shot 顺序返回；
- [x] 单个 Shot 失败不伪装整个项目成功；
- [x] 检查视频与音频主要规格；
- [x] 只报告“主要规格一致”，不承诺直接 concat；
- [x] 页面有一键检查入口；
- [x] 没有 ffprobe 时提供明确说明而不是报未知错误。
