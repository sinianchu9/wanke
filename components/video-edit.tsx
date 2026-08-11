"use client";

import { useEffect, useMemo, useState } from "react";
import { PencilLine, Send } from "lucide-react";
import type { StoredJob } from "@/lib/types";

type LocalInput = { ref: string; name: string; size: number };

export default function VideoEdit({ job, modelStudioAvailable, onCreated }: {
  job: StoredJob;
  modelStudioAvailable: boolean;
  onCreated: (jobId: string) => Promise<void> | void;
}) {
  const usableOutputs = useMemo(() => job.outputs.map((output, index) => ({ output, index })).filter(item => Boolean(item.output.outputUrl)), [job.outputs]);
  const sourceDuration = resolveSourceDuration(job);
  const [outputIndex, setOutputIndex] = useState(usableOutputs[0]?.index ?? 0);
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<"720P" | "1080P">(sourceResolution(job));
  const [audioSetting, setAudioSetting] = useState<"origin" | "auto">("origin");
  const [localImages, setLocalImages] = useState<LocalInput[]>([]);
  const [referenceUrls, setReferenceUrls] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setOutputIndex(usableOutputs[0]?.index ?? 0);
    setPrompt("");
    setResolution(sourceResolution(job));
    setAudioSetting("origin");
    setLocalImages([]);
    setReferenceUrls("");
    setError("");
  }, [job.id]);

  if (!["video_generation", "video_extension", "video_editing"].includes(job.kind) || job.status !== "succeeded" || !usableOutputs.length) return null;

  const publicRefs = referenceUrls.split(/\n/).map(value => value.trim()).filter(Boolean);
  const referenceCount = localImages.length + publicRefs.length;
  const sourceSupported = Number.isInteger(sourceDuration) && sourceDuration >= 2 && sourceDuration <= 10;
  const canSubmit = modelStudioAvailable && sourceSupported && referenceCount <= 4 && Boolean(prompt.trim()) && !uploading && !busy;

  async function addLocalImages(files: FileList | null) {
    if (!files?.length) return;
    const remaining = Math.max(0, 4 - referenceCount);
    if (!remaining) return;
    setUploading(true); setError("");
    try {
      const selected = Array.from(files).slice(0, remaining);
      const uploaded: LocalInput[] = [];
      for (const file of selected) uploaded.push(await uploadLocalImage(file));
      setLocalImages(current => [...current, ...uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setUploading(false); }
  }

  function removeLocalImage(item: LocalInput) {
    setLocalImages(current => current.filter(input => input.ref !== item.ref));
    discardLocalImage(item.ref);
  }

  async function submit() {
    if (!canSubmit) return;
    const selected = usableOutputs.find(item => item.index === outputIndex);
    const sourceUrl = selected?.output.outputUrl?.trim() || "";
    if (!sourceUrl) { setError("请选择一个仍有云端 URL 的视频结果"); return; }

    setBusy(true); setError("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video_editing",
          title: `${job.title} · 视频编辑`,
          parentJobId: job.id,
          input: {
            sourceUrl,
            prompt: prompt.trim(),
            sourceDuration,
            referenceImages: [...localImages.map(item => item.ref), ...publicRefs],
            resolution,
            audioSetting,
            sourceJobId: job.id,
            sourceOutputIndex: outputIndex,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "视频编辑提交失败");
      if (!body.job?.id) throw new Error("视频编辑已提交，但没有返回新任务编号");
      setLocalImages([]);
      await onCreated(body.job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <section className="panel" style={{marginTop:18}}>
    <div className="panel-title">
      <PencilLine size={17}/>
      <div>
        <h3>编辑这个视频</h3>
        <p>对整条输入视频执行文字指令编辑；可以追加参考图片用于服装、道具、商品或视觉元素替换。</p>
      </div>
    </div>

    <div className="form-stack" style={{marginTop:16}}>
      <div className="muted mini"><strong>边界：</strong>当前 Wan 2.7 Video Editing 没有时间段或 mask 参数，所以这里不是“第 3–5 秒局部重做”。编辑指令会作用于整条输入视频。</div>
      {!modelStudioAvailable && <div className="error-banner">视频编辑当前只接入已核实的百炼 Wan 2.7 Video Editing。请先到“设置”配置百炼 API Key。</div>}
      {!sourceSupported && <div className="error-banner">当前原片时长为 {sourceDuration || "未知"} 秒。此编辑路线当前只接受 2–10 秒输入视频。</div>}

      {usableOutputs.length > 1 && <div className="field">
        <span className="field-label">选择要编辑的结果</span>
        <select value={outputIndex} onChange={event => setOutputIndex(Number(event.target.value))}>{usableOutputs.map(({ output, index }) => <option key={index} value={index}>{output.label || `结果 ${index + 1}`}</option>)}</select>
      </div>}

      <div className="field">
        <span className="field-label">你想怎么改？<small>描述修改后的结果，不要写时间段伪指令</small></span>
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：把人物的黑色外套改成参考图里的米白色针织衫，保持人物身份、动作、背景和镜头运动尽量不变。"/>
      </div>

      <div className="field">
        <span className="field-label">参考图片<small>可选 0–4 张；用于告诉模型衣服、商品、道具或视觉元素应该变成什么</small></span>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={uploading || referenceCount >= 4} onChange={event => { addLocalImages(event.target.files); event.currentTarget.value = ""; }}/>
        {localImages.length > 0 && <div className="asset-chips">{localImages.map(item => <button type="button" className="selected" key={item.ref} onClick={() => removeLocalImage(item)}>🖼️ {item.name} ×</button>)}</div>}
        <textarea value={referenceUrls} onChange={event => setReferenceUrls(event.target.value)} placeholder="也可以粘贴公网 JPG / PNG / WEBP URL，每行一个"/>
        <div className="muted mini">已使用 {referenceCount} / 4 张参考图。没有参考图时也可以只用文字编辑。</div>
        {referenceCount > 4 && <div className="mini error-text">参考图片最多 4 张，请删除多余 URL。</div>}
      </div>

      <div className="form-grid two">
        <div className="field"><span className="field-label">输出清晰度</span><select value={resolution} onChange={event => setResolution(event.target.value as "720P" | "1080P")}><option value="1080P">1080P</option><option value="720P">720P</option></select></div>
        <div className="field"><span className="field-label">声音</span><select value={audioSetting} onChange={event => setAudioSetting(event.target.value as "origin" | "auto")}><option value="origin">尽量保留原声音</option><option value="auto">交给模型自动处理</option></select></div>
      </div>

      <details className="advanced">
        <summary>视频编辑怎么用？</summary>
        <div className="advanced-body">
          <div className="muted mini"><strong>适合：</strong>换服装 / 商品 / 道具、改背景、改整体视觉风格、调整人物动作或镜头运动。</div>
          <div className="muted mini"><strong>演示 A：</strong>原视频人物穿黑外套 → 上传米白针织衫参考图 → 输入“把人物外套替换成参考图里的针织衫，其余内容尽量保持” → 得到整条编辑后视频。</div>
          <div className="muted mini"><strong>演示 B：</strong>不上传参考图 → 输入“把整体画面改成雨夜霓虹风格，保持人物和主要动作” → 使用纯文字指令编辑。</div>
          <div className="muted mini"><strong>不适合：</strong>只重做某几秒、只涂抹一个 mask 区域、精确 NLE 剪辑；当前 API 没有这些控制参数。</div>
          <div className="muted mini"><strong>和高级复刻的关系：</strong>这里针对一个已有视频做直接编辑；高级复刻是“拆解 → 脚本 → 渲染”的生产流程，两者不要合并。</div>
        </div>
      </details>

      {error && <div className="error-banner">{error}</div>}
      <div className="stage-run" style={{margin:"4px 0 0",borderRadius:10}}>
        <span className="muted mini">当前固定使用百炼 Wan 2.7 Video Editing；不会把没有时间段能力的编辑接口包装成 Retake。</span>
        <button className="primary" disabled={!canSubmit} onClick={submit}><Send size={15}/>{busy ? "正在提交…" : "开始视频编辑"}</button>
      </div>
    </div>
  </section>;
}

async function uploadLocalImage(file: File): Promise<LocalInput> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/video-inputs", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "参考图片准备失败");
  return body.input as LocalInput;
}

function discardLocalImage(ref: string) {
  fetch(`/api/video-inputs?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }).catch(() => undefined);
}

function resolveSourceDuration(job: StoredJob) {
  const usage = job.details?.usage as Record<string, unknown> | undefined;
  const candidates = [usage?.output_video_duration, job.details?.targetDuration, job.details?.effectiveDuration, job.request.targetDuration, job.request.sourceDuration, job.request.duration];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.round(number);
  }
  return 0;
}

function sourceResolution(job: StoredJob): "720P" | "1080P" {
  const value = String(job.request.resolution || "1080P").toUpperCase();
  return value === "720P" ? "720P" : "1080P";
}
