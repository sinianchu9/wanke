"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Download, Film, FolderKanban, LoaderCircle, Settings2, Sparkles } from "lucide-react";
import type { ProductionProject } from "@/lib/project-types";
import type { ResultMedia, StoredJob } from "@/lib/types";

export default function SimpleProjectView({ projects, jobs, onChanged, onAdvanced }: {
  projects: ProductionProject[];
  jobs: StoredJob[];
  onChanged: () => Promise<void> | void;
  onAdvanced: () => void;
}) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finalUrl, setFinalUrl] = useState("");

  useEffect(() => {
    if (!projects.length) setSelectedId("");
    else if (!projects.some(project => project.id === selectedId)) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const current = projects.find(project => project.id === selectedId) || projects[0] || null;
  const jobMap = useMemo(() => new Map(jobs.map(job => [job.id, job])), [jobs]);
  const progress = current ? projectProgress(current, jobMap) : null;

  async function finalize() {
    if (!current) return;
    setBusy(true); setError(""); setFinalUrl("");
    try {
      const response = await fetch("/api/projects/simple-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: current.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "生成最终视频失败");
      setFinalUrl(body.url || "");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!current) return <div className="empty-state"><FolderKanban size={34}/><strong>还没有作品</strong><span>先去“快速创作”，一句话创建第一个视频作品。</span></div>;

  return <div className="jobs-layout">
    <section className="job-list-panel">
      <div className="panel-head"><div><div className="eyebrow">MY VIDEOS</div><h2>我的作品</h2></div></div>
      <div className="job-list">
        {projects.map(project => {
          const state = projectProgress(project, jobMap);
          return <button key={project.id} className={`job-row ${current.id === project.id ? "active" : ""}`} onClick={() => { setSelectedId(project.id); setFinalUrl(""); setError(""); }}>
            <span className="status-icon queued"><Film size={14}/></span>
            <div className="job-row-main"><strong>{project.name}</strong><span>{state.done}/{state.total} 个镜头完成</span></div>
          </button>;
        })}
      </div>
    </section>

    <section className="job-detail-panel">
      <div className="detail-head">
        <div>
          <div className="kind-pill">作品</div>
          <h2>{current.name}</h2>
          <div className="detail-meta"><span>{progress!.done}/{progress!.total} 个镜头完成</span><span>{progress!.waiting ? `${progress!.waiting} 个生成中` : ""}</span></div>
        </div>
        <button className="secondary" onClick={onAdvanced}><Settings2 size={15}/>高级编辑</button>
      </div>

      <div className="notice"><Sparkles size={16}/><span>这里先只看作品进度和结果。需要换版本、调声音、字幕、转场或处理失败镜头时，再进入高级编辑。</span></div>

      <div className={`result-grid ${current.shots.length === 1 ? "single" : ""}`} style={{marginTop:16}}>
        {current.shots.map((shot, index) => {
          const state = shotState(shot, jobMap);
          return <article className="result-card" key={shot.id}>
            {state.url ? <video src={state.url} controls preload="metadata"/> : <div className="no-preview">{state.label}</div>}
            <div className="result-info">
              <div>
                <strong>{String(index + 1).padStart(2, "0")} · {friendlyShotName(shot.name)}</strong>
                <span>{shot.brief || state.label}</span>
                <span>{state.detail}</span>
              </div>
              {state.status === "done" && <Check size={16}/>} 
              {state.status === "waiting" && <LoaderCircle className="spin" size={16}/>} 
            </div>
          </article>;
        })}
      </div>

      <section className="panel" style={{marginTop:18}}>
        <div className="panel-title"><Film size={17}/><div><h3>最终视频</h3><p>所有镜头完成后，系统会自动准备唯一确定的版本并生成最终成片；有多个候选时会先让你选择，不替你猜。</p></div></div>
        <div className="asset-chips" style={{marginTop:12}}>
          <span className="chip selected">声音：自动处理 / 项目设置</span>
          <span className="chip selected">转场：自然 / 项目设置</span>
          <span className="chip selected">字幕：按项目设置</span>
        </div>
        <div className="inline-actions" style={{marginTop:14}}>
          <button className="primary" disabled={busy || !progress!.canFinalize} onClick={finalize}><Film size={15}/>{busy ? "正在准备并生成…" : "生成最终视频"}</button>
          {!progress!.canFinalize && <span className="muted mini">等所有镜头生成完成即可；如果某个镜头有多个候选，需要先在高级编辑里选一个。</span>}
        </div>
        {error && <div className="error-banner" style={{marginTop:12}}>{error}</div>}
        {finalUrl && <div className="notice" style={{marginTop:12}}><Check size={16}/><span>最终视频已生成。</span><a className="secondary" href={finalUrl} target="_blank" rel="noreferrer"><Download size={14}/>打开视频</a></div>}
      </section>
    </section>
  </div>;
}

function projectProgress(project: ProductionProject, jobMap: Map<string, StoredJob>) {
  const states = project.shots.map(shot => shotState(shot, jobMap));
  return {
    total: states.length,
    done: states.filter(state => state.status === "done").length,
    waiting: states.filter(state => state.status === "waiting").length,
    canFinalize: states.length > 0 && states.every(state => state.status === "done" && !state.needsChoice),
  };
}

function shotState(shot: ProductionProject["shots"][number], jobMap: Map<string, StoredJob>) {
  const jobs = shot.jobIds.map(id => jobMap.get(id)).filter(Boolean) as StoredJob[];
  const successful = jobs.filter(job => job.status === "succeeded" && firstVideoOutput(job.outputs));
  const selected = shot.selectedJobId ? jobMap.get(shot.selectedJobId) : null;
  const chosen = selected && selected.status === "succeeded" && firstVideoOutput(selected.outputs) ? selected : successful.length === 1 ? successful[0] : null;
  const output = chosen ? firstVideoOutput(chosen.outputs) : null;
  if (successful.length > 1 && !shot.selectedJobId) return { status: "done", label: "多个版本", detail: "有多个可用版本，请选择喜欢的版本", url: "", needsChoice: true } as const;
  if (chosen && output) return { status: "done", label: "已完成", detail: shot.selectedJobId ? "已选择采用版本" : "唯一成功版本，成片时会自动采用", url: mediaUrl(output), needsChoice: false } as const;
  if (jobs.some(job => job.status === "running" || job.status === "queued")) return { status: "waiting", label: "生成中", detail: "系统正在生成这个镜头", url: "", needsChoice: false } as const;
  if (jobs.some(job => job.status === "failed")) return { status: "failed", label: "需要处理", detail: "这个镜头生成失败，可进入高级编辑或任务中心重试", url: "", needsChoice: false } as const;
  return { status: "empty", label: "未开始", detail: "这个镜头还没有生成任务", url: "", needsChoice: false } as const;
}

function firstVideoOutput(outputs: ResultMedia[]) {
  return outputs.find(output => output.kind === "video") || outputs.find(output => /\.(mp4|mov|webm)(\?|$)/i.test(String(output.outputUrl || ""))) || null;
}

function mediaUrl(output: ResultMedia) {
  return output.archivedFile ? `/api/archive/${encodeURIComponent(output.archivedFile)}` : output.outputUrl || "";
}

function friendlyShotName(name: string) {
  return name.replace(/^Shot\s+\d+\s*·\s*/i, "");
}
