"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Download, Film, FolderKanban, LoaderCircle, RefreshCw, Repeat2, Settings2, Sparkles } from "lucide-react";
import type { ProductionProject } from "@/lib/project-types";
import type { ResultMedia, StoredJob } from "@/lib/types";

type ProjectShot = ProductionProject["shots"][number];

export default function SimpleProjectView({ projects, jobs, onChanged, onAdvanced }: {
  projects: ProductionProject[];
  jobs: StoredJob[];
  onChanged: () => Promise<void> | void;
  onAdvanced: () => void;
}) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [finalUrl, setFinalUrl] = useState("");

  useEffect(() => {
    if (!projects.length) setSelectedId("");
    else if (!projects.some(project => project.id === selectedId)) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const current = projects.find(project => project.id === selectedId) || projects[0] || null;
  const jobMap = useMemo(() => new Map(jobs.map(job => [job.id, job])), [jobs]);
  const progress = current ? projectProgress(current, jobMap) : null;

  useEffect(() => {
    let cancelled = false;
    setFinalUrl("");
    if (!current?.id) return () => { cancelled = true; };
    fetch(`/api/projects/assembly?projectId=${encodeURIComponent(current.id)}`, { cache: "no-store" })
      .then(response => response.json())
      .then(body => {
        if (cancelled) return;
        const fileName = body?.assemblies?.[0]?.fileName;
        if (fileName) setFinalUrl(`/api/archive/${encodeURIComponent(fileName)}`);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [current?.id]);

  async function finalize() {
    if (!current) return;
    setBusy("finalize"); setError("");
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
    } finally { setBusy(""); }
  }

  async function retryShot(shot: ProjectShot) {
    const failed = shot.jobIds.map(id => jobMap.get(id)).filter((job): job is StoredJob => Boolean(job?.status === "failed"));
    const source = failed.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!source) return;
    await runJobAction(source.id, "retry", `retry:${shot.id}`);
  }

  async function regenerateShot(shot: ProjectShot) {
    const state = shotState(shot, jobMap);
    const source = state.chosen;
    if (!source || source.kind !== "video_generation") return;
    await runJobAction(source.id, "similar", `similar:${shot.id}`);
  }

  async function runJobAction(jobId: string, action: "retry" | "similar", key: string) {
    setBusy(key); setError("");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作失败");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(""); }
  }

  async function chooseCandidate(shotId: string, jobId: string) {
    setBusy(`choose:${shotId}`); setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select_job", shotId, jobId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "选择版本失败");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(""); }
  }

  if (!current) return <div className="empty-state"><FolderKanban size={34}/><strong>还没有作品</strong><span>先去“快速创作”，一句话创建第一个视频作品。</span></div>;

  return <div className="jobs-layout">
    <section className="job-list-panel">
      <div className="panel-head"><div><div className="eyebrow">MY VIDEOS</div><h2>我的作品</h2></div></div>
      <div className="job-list">
        {projects.map(project => {
          const state = projectProgress(project, jobMap);
          return <button key={project.id} className={`job-row ${current.id === project.id ? "active" : ""}`} onClick={() => { setSelectedId(project.id); setError(""); }}>
            <span className="status-icon queued"><Film size={14}/></span>
            <div className="job-row-main">
              <strong>{project.name}</strong>
              <span>{state.done}/{state.total} 个镜头完成{state.waiting ? ` · ${state.waiting} 个生成中` : state.failed ? ` · ${state.failed} 个需处理` : state.choices ? ` · ${state.choices} 个待选版本` : state.empty ? ` · ${state.empty} 个未开始` : ""}</span>
            </div>
          </button>;
        })}
      </div>
    </section>

    <section className="job-detail-panel">
      <div className="detail-head">
        <div>
          <div className="kind-pill">作品</div>
          <h2>{current.name}</h2>
          <div className="detail-meta">
            <span>{progress!.done}/{progress!.total} 个镜头完成</span>
            {progress!.waiting > 0 && <span>{progress!.waiting} 个生成中</span>}
            {progress!.failed > 0 && <span>{progress!.failed} 个需要重试</span>}
            {progress!.choices > 0 && <span>{progress!.choices} 个需要选版本</span>}
            {progress!.empty > 0 && <span>{progress!.empty} 个还未开始</span>}
          </div>
        </div>
        <button className="secondary" onClick={onAdvanced}><Settings2 size={15}/>高级编辑</button>
      </div>

      <div className="notice"><Sparkles size={16}/><span>简单页已经可以完成日常闭环：看结果、重试失败镜头、再生成一个版本、选择或更换喜欢的版本、生成最终视频。只有要改专业参数时才需要高级编辑。</span></div>

      <div className="content-stack" style={{marginTop:16}}>
        {current.shots.map((shot, index) => {
          const state = shotState(shot, jobMap);
          const actionLocked = busy !== "";
          return <section className="panel" key={shot.id}>
            <div className="panel-head">
              <div className="panel-title"><Film size={16}/><div><h3>{String(index + 1).padStart(2, "0")} · {friendlyShotName(shot.name)}</h3><p>{shot.brief || state.detail}</p></div></div>
              <span className={`kind-pill ${state.status}`}>{state.label}</span>
            </div>

            {state.chosenOutput && <div className="result-grid single" style={{marginTop:12}}><article className="result-card"><video src={mediaUrl(state.chosenOutput)} controls preload="metadata"/><div className="result-info"><div><strong>当前版本</strong><span>{state.detail}</span></div>{state.status === "done" && !state.needsChoice && <Check size={16}/>}</div></article></div>}

            {state.successful.length > 1 && state.status !== "waiting" && <div style={{marginTop:12}}>
              <div className="subhead"><h3>{state.needsChoice ? "选择你喜欢的版本" : "可随时更换版本"}</h3><span>{state.successful.length} 个可用候选</span></div>
              <div className="result-grid">
                {state.successful.map((job, candidateIndex) => {
                  const output = firstVideoOutput(job.outputs)!;
                  const selected = shot.selectedJobId === job.id;
                  return <article className="result-card" key={job.id}>
                    <video src={mediaUrl(output)} controls preload="metadata"/>
                    <div className="result-info">
                      <div><strong>版本 {candidateIndex + 1}</strong><span>{selected ? "当前已采用" : "预览后可以切换"}</span></div>
                      <button className={selected ? "secondary" : "primary"} disabled={actionLocked || selected} onClick={() => chooseCandidate(shot.id, job.id)}>{selected ? <><Check size={14}/>已选择</> : "选这个"}</button>
                    </div>
                  </article>;
                })}
              </div>
            </div>}

            {!state.chosenOutput && !state.needsChoice && <div className="pending-card" style={{marginTop:12}}>
              {state.status === "waiting" ? <LoaderCircle className="spin" size={22}/> : <Repeat2 size={22}/>}<div><strong>{state.label}</strong><span>{state.detail}</span></div>
            </div>}

            <div className="inline-actions" style={{marginTop:12}}>
              {state.status === "failed" && <button className="secondary" disabled={actionLocked} onClick={() => retryShot(shot)}><RefreshCw size={14}/>{busy === `retry:${shot.id}` ? "正在重试…" : "重试这个镜头"}</button>}
              {state.status === "done" && !state.needsChoice && state.chosen?.kind === "video_generation" && <button className="secondary" disabled={actionLocked} onClick={() => regenerateShot(shot)}><Repeat2 size={14}/>{busy === `similar:${shot.id}` ? "正在提交…" : "再生成一个版本"}</button>}
              {state.status === "done" && !state.needsChoice && state.chosen && state.chosen.kind !== "video_generation" && <span className="muted mini">这个版本来自延长/编辑等后续处理；需要继续加工时进入高级编辑。</span>}
              {state.status === "waiting" && state.successful.length > 0 && <span className="muted mini">已有可用版本，但新的候选仍在生成；完成后会在这里一起比较。</span>}
              {state.status === "empty" && <button className="secondary" onClick={onAdvanced}><Settings2 size={14}/>去高级编辑补充这个镜头</button>}
            </div>
          </section>;
        })}
      </div>

      <section className="panel" style={{marginTop:18}}>
        <div className="panel-title"><Film size={17}/><div><h3>最终视频</h3><p>所有镜头确定后，一键完成定稿保存、媒体统一、项目转场、声音、字幕和最终 MP4。</p></div></div>
        <div className="asset-chips" style={{marginTop:12}}>
          <span className="chip selected">声音：按项目设置</span>
          <span className="chip selected">转场：按项目设置</span>
          <span className="chip selected">字幕：按项目设置</span>
        </div>
        <div className="inline-actions" style={{marginTop:14}}>
          <button className="primary" disabled={busy !== "" || !progress!.canFinalize} onClick={finalize}><Film size={15}/>{busy === "finalize" ? "正在准备并生成…" : "生成最终视频"}</button>
          {!progress!.canFinalize && <span className="muted mini">{finalizeHint(progress!)}</span>}
        </div>
        {error && <div className="error-banner" style={{marginTop:12}}>{error}</div>}
        {finalUrl && <div style={{marginTop:12}}>
          <div className="notice"><Check size={16}/><span>这个作品已有可播放的最终视频。</span><a className="secondary" href={finalUrl} target="_blank" rel="noreferrer"><Download size={14}/>打开视频</a></div>
          <video src={finalUrl} controls preload="metadata" style={{width:"100%",marginTop:10,borderRadius:12}}/>
        </div>}
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
    failed: states.filter(state => state.status === "failed").length,
    empty: states.filter(state => state.status === "empty").length,
    choices: states.filter(state => state.needsChoice).length,
    canFinalize: states.length > 0 && states.every(state => state.status === "done" && !state.needsChoice),
  };
}

function shotState(shot: ProjectShot, jobMap: Map<string, StoredJob>) {
  const shotJobs = shot.jobIds.map(id => jobMap.get(id)).filter(Boolean) as StoredJob[];
  const successful = shotJobs.filter(job => job.status === "succeeded" && firstVideoOutput(job.outputs)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const active = shotJobs.filter(job => job.status === "running" || job.status === "queued");
  const selected = shot.selectedJobId ? jobMap.get(shot.selectedJobId) : null;
  const selectedValid = selected && selected.status === "succeeded" && firstVideoOutput(selected.outputs) ? selected : null;
  const needsChoice = successful.length > 1 && !selectedValid;
  const chosen = selectedValid || (!needsChoice && successful.length === 1 ? successful[0] : null);
  const chosenOutput = chosen ? firstVideoOutput(chosen.outputs) : null;

  if (active.length > 0) {
    return {
      status: "waiting" as const,
      label: successful.length ? "新版本生成中" : "生成中",
      detail: successful.length ? "已有可用版本，新的候选完成后再一起比较" : "系统正在生成这个镜头",
      successful,
      chosen,
      chosenOutput,
      needsChoice: false,
    };
  }
  if (needsChoice) return { status: "done" as const, label: "请选择版本", detail: "有多个可用版本，预览后选一个即可", successful, chosen: null, chosenOutput: null, needsChoice: true };
  if (chosen && chosenOutput) return { status: "done" as const, label: "已完成", detail: selectedValid ? "已经确定采用版本" : "只有一个成功版本，成片时会自动采用", successful, chosen, chosenOutput, needsChoice: false };
  if (shotJobs.some(job => job.status === "failed")) return { status: "failed" as const, label: "需要重试", detail: "这个镜头没有可用结果，直接点击重试即可", successful, chosen: null, chosenOutput: null, needsChoice: false };
  return { status: "empty" as const, label: "未开始", detail: "这个镜头还没有生成任务", successful, chosen: null, chosenOutput: null, needsChoice: false };
}

function finalizeHint(progress: ReturnType<typeof projectProgress>) {
  if (progress.waiting) return `还有 ${progress.waiting} 个镜头正在生成，完成后即可继续。`;
  if (progress.failed) return `还有 ${progress.failed} 个镜头没有可用结果，请先在上方重试。`;
  if (progress.choices) return `还有 ${progress.choices} 个镜头有多个版本，请先在上方选一个喜欢的。`;
  if (progress.empty) return `还有 ${progress.empty} 个镜头尚未开始，需要先补充生成任务。`;
  return "镜头尚未全部准备好。";
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
