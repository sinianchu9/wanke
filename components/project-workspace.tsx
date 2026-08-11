"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Clapperboard, FolderKanban, Plus, Sparkles, Trash2, Unlink } from "lucide-react";
import ProjectMediaReadiness from "@/components/project-media-readiness";
import type { PublicSubjectCard } from "@/components/subject-library";
import type { ProductionProject, ProjectShot } from "@/lib/project-types";
import { JOB_KIND_LABELS, type ResultMedia, type StoredJob } from "@/lib/types";

export default function ProjectWorkspace({ projects, jobs, subjects, onChanged, onCreateInShot }: {
  projects: ProductionProject[];
  jobs: StoredJob[];
  subjects: PublicSubjectCard[];
  onChanged: () => Promise<void> | void;
  onCreateInShot: (shotId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id || "");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [shotName, setShotName] = useState("");
  const [shotBrief, setShotBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projects.length) setSelectedId("");
    else if (!projects.some(project => project.id === selectedId)) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const current = projects.find(project => project.id === selectedId) || projects[0] || null;
  const jobMap = useMemo(() => new Map(jobs.map(job => [job.id, job])), [jobs]);
  const assignedJobIds = useMemo(() => new Set(projects.flatMap(project => project.shots.flatMap(shot => shot.jobIds))), [projects]);
  const unassignedJobs = jobs.filter(job => !assignedJobIds.has(job.id));

  async function mutate(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "项目操作失败");
      await onChanged();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally { setBusy(false); }
  }

  async function createNewProject() {
    if (!projectName.trim()) return;
    try {
      const data = await mutate({ action: "create_project", name: projectName.trim(), description: projectDescription.trim() });
      const created = data.result as ProductionProject | undefined;
      setProjectName(""); setProjectDescription("");
      if (created?.id) setSelectedId(created.id);
    } catch { /* message already visible */ }
  }

  async function addShot() {
    if (!current || !shotName.trim()) return;
    try {
      await mutate({ action: "create_shot", projectId: current.id, name: shotName.trim(), brief: shotBrief.trim() });
      setShotName(""); setShotBrief("");
    } catch { /* message already visible */ }
  }

  async function moveShot(shotId: string, delta: -1 | 1) {
    if (!current) return;
    const index = current.shots.findIndex(shot => shot.id === shotId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.shots.length) return;
    const shotIds = current.shots.map(shot => shot.id);
    [shotIds[index], shotIds[target]] = [shotIds[target], shotIds[index]];
    try { await mutate({ action: "reorder_shots", projectId: current.id, shotIds }); } catch { /* visible */ }
  }

  async function remove(type: "project" | "shot", id: string) {
    const label = type === "project" ? "这个项目" : "这个镜头";
    if (!confirm(`删除${label}的组织关系？生成任务和结果不会被删除。`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects?type=${type}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除失败");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function toggleSubject(subjectId: string) {
    if (!current) return;
    const next = current.subjectIds.includes(subjectId)
      ? current.subjectIds.filter(id => id !== subjectId)
      : [...current.subjectIds, subjectId];
    try { await mutate({ action: "set_subjects", projectId: current.id, subjectIds: next }); } catch { /* visible */ }
  }

  return <div className="jobs-layout">
    <section className="job-list-panel">
      <div className="panel-head"><div><div className="eyebrow">PRODUCTION PROJECTS</div><h2>作品项目</h2></div></div>
      <div className="job-list">
        {projects.map(project => {
          const adopted = project.shots.filter(shot => shot.selectedJobId).length;
          return <button key={project.id} className={`job-row ${current?.id === project.id ? "active" : ""}`} onClick={() => setSelectedId(project.id)}>
            <span className="status-icon queued"><FolderKanban size={14}/></span>
            <div className="job-row-main"><strong>{project.name}</strong><span>{project.shots.length} 个镜头 · {adopted} 个已定稿</span></div>
          </button>;
        })}
        {!projects.length && <div className="empty-list">还没有项目</div>}
      </div>

      <div className="panel" style={{margin:12}}>
        <div className="field"><span className="field-label">新项目</span><input value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="例如：智能手环夏季广告"/></div>
        <div className="field"><span className="field-label">项目说明<small>可选</small></span><textarea value={projectDescription} onChange={event => setProjectDescription(event.target.value)} placeholder="目标、平台、风格、交付要求等"/></div>
        <button className="primary" disabled={busy || !projectName.trim()} onClick={createNewProject}><Plus size={15}/>创建项目</button>
      </div>
    </section>

    <section className="job-detail-panel">
      {!current ? <div className="empty-state"><FolderKanban size={34}/><strong>先创建一个作品项目</strong><span>项目用来组织镜头、候选版本和最终采用结果，不会改变已有生成能力。</span></div> : <>
        <div className="detail-head">
          <div><div className="kind-pill">作品项目</div><h2>{current.name}</h2><div className="detail-meta"><span>{current.description || "还没有项目说明"}</span></div></div>
          <button className="icon-button danger" disabled={busy} onClick={() => remove("project", current.id)} title="删除项目组织关系"><Trash2 size={15}/></button>
        </div>

        <div className="panel" style={{marginBottom:18}}>
          <div className="panel-title"><Sparkles size={17}/><div><h3>项目主体</h3><p>记录这个作品会用到的人物 / 产品。这里只做组织，不会自动把主体塞进每个镜头。</p></div></div>
          {subjects.length ? <div className="asset-chips" style={{marginTop:12}}>{subjects.map(subject => <button type="button" key={subject.id} className={current.subjectIds.includes(subject.id) ? "selected" : ""} disabled={busy} onClick={() => toggleSubject(subject.id)}>{subject.subjectType === "person" ? "👤" : "📦"} {subject.name}</button>)}</div> : <div className="muted mini" style={{marginTop:10}}>主体库还没有人物或产品卡，可以先去“主体库”创建。</div>}
        </div>

        <FinalCutReview project={current} jobMap={jobMap}/>
        <ProjectMediaReadiness projectId={current.id}/>

        <div className="panel" style={{marginBottom:18}}>
          <div className="panel-title"><Clapperboard size={17}/><div><h3>新增镜头</h3><p>一个 Shot 表示一个明确镜头目标；它可以有很多候选任务，但只采用一个版本。</p></div></div>
          <div className="form-grid two" style={{marginTop:12}}>
            <div className="field"><span className="field-label">镜头名称</span><input value={shotName} onChange={event => setShotName(event.target.value)} placeholder={`例如：Shot ${String(current.shots.length + 1).padStart(2, "0")} · 产品特写`}/></div>
            <div className="field"><span className="field-label">镜头目标<small>可选</small></span><input value={shotBrief} onChange={event => setShotBrief(event.target.value)} placeholder="例如：手环置于深色桌面，镜头缓慢环绕"/></div>
          </div>
          <button className="secondary" disabled={busy || !shotName.trim()} onClick={addShot}><Plus size={15}/>添加镜头</button>
        </div>

        <div className="content-stack">
          {current.shots.map((shot, index) => <ShotCard
            key={shot.id}
            shot={shot}
            index={index}
            jobMap={jobMap}
            unassignedJobs={unassignedJobs}
            busy={busy}
            canMoveUp={index > 0}
            canMoveDown={index < current.shots.length - 1}
            onMoveUp={() => moveShot(shot.id, -1)}
            onMoveDown={() => moveShot(shot.id, 1)}
            onCreate={() => onCreateInShot(shot.id)}
            onAssign={jobId => mutate({ action: "assign_job", shotId: shot.id, jobId })}
            onUnassign={jobId => mutate({ action: "unassign_job", shotId: shot.id, jobId })}
            onSelect={jobId => mutate({ action: "select_job", shotId: shot.id, jobId })}
            onDelete={() => remove("shot", shot.id)}
          />)}
          {!current.shots.length && <div className="empty-state"><Clapperboard size={30}/><strong>这个项目还没有镜头</strong><span>先建立 Shot，再从 Shot 进入 AI 视频生成，后续版本、延长和编辑都会留在同一个镜头里。</span></div>}
        </div>

        <details className="advanced" style={{marginTop:18}}>
          <summary>项目 / Shot 怎么用？</summary>
          <div className="advanced-body">
            <div className="muted mini"><strong>推荐流程：</strong>创建项目 → 建 Shot → 调整镜头顺序 → 绑定常用主体 → 点击“在此镜头创作” → 生成 1–4 个候选 → 在项目里选择采用版本。</div>
            <div className="muted mini"><strong>成片准备：</strong>上方“定稿顺序预览”严格按 Shot 顺序展示每个采用视频；没有定稿的镜头会明确显示缺口。全部定稿后可用“成片规格检查”验证媒体参数。</div>
            <div className="muted mini"><strong>自动继承：</strong>某个候选的失败重试、类似版本、继续创作、视频延长、视频编辑都会自动留在同一个 Shot，不用再次归类。</div>
            <div className="muted mini"><strong>删除边界：</strong>删除 Project 或 Shot 只删除组织关系，不删除任务和视频结果；删除任务则会自动从 Shot 候选中移除。</div>
          </div>
        </details>

        {error && <div className="error-banner" style={{marginTop:16}}>{error}</div>}
      </>}
    </section>
  </div>;
}

function FinalCutReview({ project, jobMap }: { project: ProductionProject; jobMap: Map<string, StoredJob> }) {
  const adopted = project.shots.filter(shot => shot.selectedJobId).length;
  const missing = project.shots.length - adopted;
  return <section className="panel" style={{marginBottom:18}}>
    <div className="panel-title"><Check size={17}/><div><h3>定稿顺序预览</h3><p>{project.shots.length ? `已定稿 ${adopted}/${project.shots.length}${missing ? `，还缺 ${missing} 个镜头` : "，全部镜头已具备成片输入"}` : "先添加镜头，再逐个选择采用版本。"}</p></div></div>
    {project.shots.length > 0 && <div className={`result-grid ${project.shots.length === 1 ? "single" : ""}`} style={{marginTop:14}}>
      {project.shots.map((shot, index) => {
        const job = shot.selectedJobId ? jobMap.get(shot.selectedJobId) : null;
        const output = job ? firstVideoOutput(job) : null;
        const url = output ? outputUrl(output) : "";
        return <article className="result-card" key={shot.id}>
          {url ? <video src={url} controls preload="metadata"/> : <div className="no-preview">未定稿</div>}
          <div className="result-info"><div><strong>{String(index + 1).padStart(2, "0")} · {shot.name}</strong><span>{job ? job.title : "尚未选择采用视频"}</span>{shot.brief && <span>{shot.brief}</span>}</div></div>
        </article>;
      })}
    </div>}
    <div className="muted mini" style={{marginTop:10}}>这里是“成片输入清单”，不是时间线。顺序来自 Shot；视频来自每个 Shot 的采用版本。后续拼接只应消费这份已经定稿的顺序，不重新猜候选。</div>
  </section>;
}

function ShotCard({ shot, index, jobMap, unassignedJobs, busy, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onCreate, onAssign, onUnassign, onSelect, onDelete }: {
  shot: ProjectShot;
  index: number;
  jobMap: Map<string, StoredJob>;
  unassignedJobs: StoredJob[];
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCreate: () => void;
  onAssign: (jobId: string) => Promise<unknown> | unknown;
  onUnassign: (jobId: string) => Promise<unknown> | unknown;
  onSelect: (jobId: string | null) => Promise<unknown> | unknown;
  onDelete: () => void;
}) {
  const [existingJobId, setExistingJobId] = useState("");
  const candidates = shot.jobIds.map(id => jobMap.get(id)).filter(Boolean) as StoredJob[];
  const selected = shot.selectedJobId ? jobMap.get(shot.selectedJobId) : null;

  return <section className="panel">
    <div className="panel-head">
      <div><div className="eyebrow">SHOT {String(index + 1).padStart(2, "0")}</div><h3>{shot.name}</h3><div className="muted mini">{shot.brief || "未填写镜头目标"}</div></div>
      <div className="inline-actions">
        <button className="icon-button" disabled={busy || !canMoveUp} onClick={onMoveUp} title="镜头上移"><ArrowUp size={15}/></button>
        <button className="icon-button" disabled={busy || !canMoveDown} onClick={onMoveDown} title="镜头下移"><ArrowDown size={15}/></button>
        <button className="secondary" disabled={busy} onClick={onCreate}><Sparkles size={15}/>在此镜头创作</button>
        <button className="icon-button danger" disabled={busy} onClick={onDelete}><Trash2 size={15}/></button>
      </div>
    </div>

    {selected && <div className="notice" style={{marginTop:10}}><Check size={15}/><span>采用版本：<strong>{selected.title}</strong></span><button className="link-button" disabled={busy} onClick={async () => { try { await onSelect(null); } catch { /* parent surfaces the error */ } }}>取消采用</button></div>}

    <div className="subhead" style={{marginTop:14}}><h3>候选版本</h3><span>{candidates.length} 个任务</span></div>
    <div className="job-list">
      {candidates.map(job => <div className="job-row" key={job.id} style={{cursor:"default"}}>
        <span className={`status-icon ${job.status === "succeeded" ? "success" : job.status === "failed" ? "fail" : "queued"}`}>{job.status === "succeeded" ? <Check size={14}/> : <Clapperboard size={14}/>}</span>
        <div className="job-row-main"><strong>{job.title}</strong><span>{JOB_KIND_LABELS[job.kind]} · {statusLabel(job.status)}{job.outputs.length ? ` · ${job.outputs.length} 个结果` : ""}</span></div>
        <div className="inline-actions">
          {job.status === "succeeded" && hasVideoResult(job) && <button className={shot.selectedJobId === job.id ? "primary" : "secondary"} disabled={busy} onClick={async () => { try { await onSelect(job.id); } catch { /* parent surfaces the error */ } }}>{shot.selectedJobId === job.id ? <><Check size={14}/>已采用</> : "采用"}</button>}
          <button className="icon-button" disabled={busy} title="从这个镜头移除，但不删除任务" onClick={async () => { try { await onUnassign(job.id); } catch { /* parent surfaces the error */ } }}><Unlink size={14}/></button>
        </div>
      </div>)}
      {!candidates.length && <div className="empty-list">还没有候选任务</div>}
    </div>

    {unassignedJobs.length > 0 && <div className="form-grid two" style={{marginTop:12}}>
      <div className="field"><span className="field-label">加入已有任务<small>用于整理之前已经生成的结果</small></span><select value={existingJobId} onChange={event => setExistingJobId(event.target.value)}><option value="">— 选择未归类任务 —</option>{unassignedJobs.slice(0,100).map(job => <option key={job.id} value={job.id}>{job.title} · {statusLabel(job.status)}</option>)}</select></div>
      <div className="stage-run" style={{margin:0,alignSelf:"end"}}><button className="secondary" disabled={busy || !existingJobId} onClick={async () => { if (!existingJobId) return; try { await onAssign(existingJobId); setExistingJobId(""); } catch { /* parent surfaces the error */ } }}>加入这个 Shot</button></div>
    </div>}
  </section>;
}

function firstVideoOutput(job: StoredJob) {
  return job.outputs.find(output => output.kind === "video") || job.outputs.find(output => /\.(mp4|mov|webm)(\?|$)/i.test(String(output.outputUrl || ""))) || null;
}

function outputUrl(output: ResultMedia) {
  return output.archivedFile ? `/api/archive/${encodeURIComponent(output.archivedFile)}` : (output.outputUrl || "");
}

function hasVideoResult(job: StoredJob) {
  return Boolean(firstVideoOutput(job));
}

function statusLabel(status: string) {
  return status === "succeeded" ? "已完成" : status === "failed" ? "失败" : status === "running" ? "生成中" : status === "queued" ? "排队中" : "待确认";
}
