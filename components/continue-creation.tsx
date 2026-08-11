"use client";

import { useEffect, useState } from "react";
import { GitBranch, Send } from "lucide-react";
import type { StoredJob } from "@/lib/types";

export default function ContinueCreation({ job, onCreated }: { job: StoredJob; onCreated: (jobId: string) => Promise<void> | void }) {
  const usableOutputs = job.outputs.map((output, index) => ({ output, index })).filter(item => Boolean(item.output.outputUrl));
  const [outputIndex, setOutputIndex] = useState(usableOutputs[0]?.index ?? 0);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setOutputIndex(usableOutputs[0]?.index ?? 0);
    setPrompt("");
    setError("");
  }, [job.id]);

  if (job.kind !== "video_generation" || job.status !== "succeeded" || !usableOutputs.length) return null;

  async function submit() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "continue", outputIndex, prompt: prompt.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "继续创作失败");
      if (!body.job?.id) throw new Error("继续创作已提交，但没有返回新任务编号");
      await onCreated(body.job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <section className="panel" style={{marginTop:18}}>
    <div className="panel-title">
      <GitBranch size={17}/>
      <div>
        <h3>以这个结果继续创作</h3>
        <p>把已生成的视频作为新的参考视频，再输入新的创作要求。会创建一个新的子任务，不覆盖当前结果。</p>
      </div>
    </div>

    <div className="form-stack" style={{marginTop:16}}>
      {usableOutputs.length > 1 && <div className="field">
        <span className="field-label">选择哪个结果作为参考</span>
        <select value={outputIndex} onChange={event => setOutputIndex(Number(event.target.value))}>
          {usableOutputs.map(({ output, index }) => <option key={index} value={index}>{output.label || `结果 ${index + 1}`}</option>)}
        </select>
      </div>}

      <div className="field">
        <span className="field-label">新的创作要求<small>必须明确你希望下一条视频发生什么变化</small></span>
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：保持人物和整体风格一致，改成侧面跟拍，人物走出咖啡店后看向街道。" />
      </div>

      <div className="muted mini"><strong>边界：</strong>这里会把完整结果视频作为 reference video；不是视频延长、不是替换原视频某一段、也不是失败重试。</div>
      <div className="muted mini"><strong>演示：</strong>先生成“女孩走进咖啡店” → 选中满意结果 → 输入“保持人物一致，改成她从咖啡店走出并回头” → 创建新的“继续创作”子任务。</div>
      {error && <div className="error-banner">{error}</div>}
      <div className="stage-run" style={{margin:"4px 0 0",borderRadius:10}}>
        <span className="muted mini">新任务继续使用当前 Recipe；Provider 仍由系统设置和参考视频能力自动决定。</span>
        <button className="primary" disabled={busy || !prompt.trim()} onClick={submit}><Send size={15}/>{busy ? "正在提交…" : "继续创作"}</button>
      </div>
    </div>
  </section>;
}
