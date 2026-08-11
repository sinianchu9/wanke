"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, Send } from "lucide-react";
import type { StoredJob } from "@/lib/types";

export default function VideoExtend({ job, modelStudioAvailable, onCreated }: {
  job: StoredJob;
  modelStudioAvailable: boolean;
  onCreated: (jobId: string) => Promise<void> | void;
}) {
  const usableOutputs = useMemo(() => job.outputs.map((output, index) => ({ output, index })).filter(item => Boolean(item.output.outputUrl)), [job.outputs]);
  const sourceDuration = resolveSourceDuration(job);
  const [outputIndex, setOutputIndex] = useState(usableOutputs[0]?.index ?? 0);
  const [targetDuration, setTargetDuration] = useState(defaultTargetDuration(sourceDuration));
  const [resolution, setResolution] = useState<"720P" | "1080P">(sourceResolution(job));
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setOutputIndex(usableOutputs[0]?.index ?? 0);
    setTargetDuration(defaultTargetDuration(sourceDuration));
    setResolution(sourceResolution(job));
    setPrompt("");
    setError("");
  }, [job.id, sourceDuration]);

  if (!["video_generation", "video_extension", "video_editing"].includes(job.kind) || job.status !== "succeeded" || !usableOutputs.length) return null;

  const sourceSupported = Number.isInteger(sourceDuration) && sourceDuration >= 2 && sourceDuration <= 10;
  const canSubmit = modelStudioAvailable && sourceSupported && targetDuration > sourceDuration && targetDuration <= 15 && Boolean(prompt.trim()) && !busy;

  async function submit() {
    if (!canSubmit) return;
    const selected = usableOutputs.find(item => item.index === outputIndex);
    const sourceUrl = selected?.output.outputUrl?.trim() || "";
    if (!sourceUrl) { setError("请选择一个仍有云端 URL 的视频结果"); return; }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video_extension",
          title: `${job.title} · 延长至 ${targetDuration} 秒`,
          parentJobId: job.id,
          input: {
            sourceUrl,
            prompt: prompt.trim(),
            sourceDuration,
            targetDuration,
            resolution,
            sourceJobId: job.id,
            sourceOutputIndex: outputIndex,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "视频延长提交失败");
      if (!body.job?.id) throw new Error("视频延长已提交，但没有返回新任务编号");
      await onCreated(body.job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <section className="panel" style={{marginTop:18}}>
    <div className="panel-title">
      <Clock3 size={17}/>
      <div>
        <h3>延长这个视频</h3>
        <p>使用百炼 Wan 2.7 原生 video continuation，把当前视频作为 first clip 延续到更长的最终成片。</p>
      </div>
    </div>

    <div className="form-stack" style={{marginTop:16}}>
      <div className="muted mini"><strong>最重要的规则：</strong>“最终总时长”包含原视频。原视频 {sourceDuration || "未知"} 秒 → 设为 10 秒，表示输出总共 10 秒，不是再额外增加 10 秒。</div>

      {!modelStudioAvailable && <div className="error-banner">视频延长当前只接入已核实的百炼 Wan 2.7 原生能力。请先到“设置”配置百炼 API Key。</div>}
      {!sourceSupported && <div className="error-banner">当前原片时长为 {sourceDuration || "未知"} 秒。原生 continuation 当前只接受 2–10 秒输入片段；超过 10 秒的结果不能继续作为 first clip。</div>}

      {usableOutputs.length > 1 && <div className="field">
        <span className="field-label">选择要延长的结果</span>
        <select value={outputIndex} onChange={event=>setOutputIndex(Number(event.target.value))}>{usableOutputs.map(({output,index})=><option key={index} value={index}>{output.label || `结果 ${index+1}`}</option>)}</select>
      </div>}

      <div className="form-grid two">
        <div className="field">
          <span className="field-label">最终总时长<small>必须大于原视频，最大 15 秒</small></span>
          <input type="number" min={Math.min(15, Math.max(3, sourceDuration + 1))} max={15} step={1} value={targetDuration} disabled={!sourceSupported} onChange={event=>setTargetDuration(Number(event.target.value))}/>
          {sourceSupported && targetDuration > sourceDuration && targetDuration <= 15 && <div className="muted mini">预计在原 {sourceDuration} 秒基础上继续生成约 {targetDuration - sourceDuration} 秒，最终返回 {targetDuration} 秒完整视频。</div>}
        </div>
        <div className="field">
          <span className="field-label">输出清晰度</span>
          <select value={resolution} onChange={event=>setResolution(event.target.value as "720P"|"1080P")}><option value="1080P">1080P</option><option value="720P">720P</option></select>
        </div>
      </div>

      <div className="field">
        <span className="field-label">接下来发生什么？<small>只描述原视频结束之后的连续发展</small></span>
        <textarea value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="例如：女孩走出咖啡店后停在街边，回头看向店内，镜头继续平稳跟随，保持人物、光线和场景连续。"/>
      </div>

      <details className="advanced">
        <summary>视频延长怎么用？</summary>
        <div className="advanced-body">
          <div className="muted mini"><strong>适合：</strong>已有 5 秒或 10 秒视频，想让动作和场景沿时间轴继续发展；编辑后的 2–10 秒结果也可以继续延长。</div>
          <div className="muted mini"><strong>不适合：</strong>只想换背景、换人物或改变原视频内容；这些属于视频编辑，不是延长。</div>
          <div className="muted mini"><strong>演示：</strong>原视频 5 秒“女孩走进咖啡店” → 最终总时长 10 秒 → 新要求“她走到柜台并回头看镜头” → 输出是包含原片连续内容的 10 秒完整视频。</div>
          <div className="muted mini"><strong>与继续创作的区别：</strong>继续创作把旧视频当参考，生成另一条新视频；视频延长把旧视频当 first clip，明确要求时间轴接着往后延续。</div>
        </div>
      </details>

      {error && <div className="error-banner">{error}</div>}
      <div className="stage-run" style={{margin:"4px 0 0",borderRadius:10}}>
        <span className="muted mini">当前实现固定使用百炼 Wan 2.7 原生 continuation，不经过万镜一刻兼容回退。</span>
        <button className="primary" disabled={!canSubmit} onClick={submit}><Send size={15}/>{busy?"正在提交…":`延长到 ${targetDuration} 秒`}</button>
      </div>
    </div>
  </section>;
}

function resolveSourceDuration(job: StoredJob) {
  const usage = job.details?.usage as Record<string, unknown> | undefined;
  const candidates = [
    usage?.output_video_duration,
    job.details?.targetDuration,
    job.details?.effectiveDuration,
    job.request.targetDuration,
    job.request.duration,
    job.request.sourceDuration,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.round(number);
  }
  return 0;
}

function sourceResolution(job: StoredJob): "720P"|"1080P" {
  const value = String(job.request.resolution || "1080P").toUpperCase();
  return value === "720P" ? "720P" : "1080P";
}

function defaultTargetDuration(sourceDuration: number) {
  if (sourceDuration >= 10) return 15;
  if (sourceDuration >= 5) return 10;
  return 5;
}
