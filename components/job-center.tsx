"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Clock3, Copy, Download, ExternalLink, Film, GitBranch, Layers3, LoaderCircle, RefreshCw, Repeat2, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import ContinueCreation from "@/components/continue-creation";
import VideoExtend from "@/components/video-extend";
import { JOB_KIND_LABELS, type ResultMedia, type StoredJob } from "@/lib/types";

const kindName: Record<string, string> = JOB_KIND_LABELS;
type BatchMeta = { id: string; index: number; total: number };

export default function JobCenter({ jobs, modelStudioAvailable, onChanged, onGoAssets: _onGoAssets }: {
  jobs: StoredJob[];
  modelStudioAvailable: boolean;
  onChanged: () => Promise<void> | void;
  onGoAssets: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(jobs[0]?.id || null);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const current = jobs.find(job => job.id === selected) || jobs[0];

  useEffect(() => {
    if (!selected && jobs[0]) setSelected(jobs[0].id);
  }, [jobs, selected]);

  const shown = useMemo(() => filter === "all" ? jobs : jobs.filter(job => job.status === filter), [jobs, filter]);

  async function action(job: StoredJob, action: "refresh" | "retry" | "resume" | "similar") {
    setBusy(`${job.id}:${action}`);
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作失败");
      await onChanged();
      if (body.job?.id) setSelected(body.job.id);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function archive(job: StoredJob, index: number) {
    setBusy(`${job.id}:archive:${index}`);
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", index }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      await onChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function remove(job: StoredJob) {
    if (!confirm("删除这条任务记录及其本机保存文件？云端任务和云端素材不会被删除。")) return;
    await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    setSelected(null);
    await onChanged();
  }

  const currentBatch = current ? batchMeta(current) : null;
  const batchJobs = currentBatch
    ? jobs.filter(job => batchMeta(job)?.id === currentBatch.id).sort((a, b) => (batchMeta(a)?.index || 0) - (batchMeta(b)?.index || 0))
    : [];
  const selectCreated = async (jobId: string) => {
    await onChanged();
    setSelected(jobId);
  };

  return <div className="jobs-layout">
    <section className="job-list-panel">
      <div className="panel-head">
        <div><div className="eyebrow">PRODUCTION QUEUE</div><h2>任务中心</h2></div>
        <button className="icon-button" onClick={() => onChanged()}><RefreshCw size={16}/></button>
      </div>
      <div className="filter-tabs">
        {[["all", "全部"], ["running", "进行中"], ["queued", "排队"], ["succeeded", "完成"], ["failed", "失败"], ["unknown", "待确认"]].map(([id, label]) =>
          <button className={filter === id ? "active" : ""} key={id} onClick={() => setFilter(id)}>{label}</button>
        )}
      </div>
      <div className="job-list">
        {shown.map(job => {
          const batch = batchMeta(job);
          return <button key={job.id} className={`job-row ${current?.id === job.id ? "active" : ""}`} onClick={() => setSelected(job.id)}>
            <StatusIcon status={job.status}/>
            <div className="job-row-main">
              <strong>{job.title}</strong>
              <span>{batch ? `批量版本 ${batch.index}/${batch.total} · ` : ""}{kindName[job.kind]} · {ago(job.createdAt)}</span>
            </div>
            <ChevronRight size={15}/>
          </button>;
        })}
        {!shown.length && <div className="empty-list">暂无任务</div>}
      </div>
    </section>

    <section className="job-detail-panel">
      {!current ? <div className="empty-state"><Film size={32}/><strong>还没有视频任务</strong><span>从左侧任一创作功能提交后，任务会出现在这里。</span></div> : <>
        <div className="detail-head">
          <div>
            <div className="kind-pill">{kindName[current.kind]}</div>
            <h2>{current.title}</h2>
            <div className="detail-meta">
              <StatusLabel status={current.status}/>
              <span>{new Date(current.createdAt).toLocaleString()}</span>
              {current.providerJobId && <button className="text-copy" onClick={() => navigator.clipboard.writeText(current.providerJobId!)} title="复制任务编号"><code>{short(current.providerJobId)}</code><Copy size={12}/></button>}
            </div>
          </div>
          <div className="detail-actions">
            <button className="secondary" disabled={busy !== "" || current.details?.pollable === false} onClick={() => action(current, "refresh")} title={current.details?.pollable === false ? String(current.details?.note || "该类型当前没有查询接口") : "检查最新状态"}><RefreshCw size={15}/>{current.details?.pollable === false ? "无查询接口" : "刷新"}</button>
            {current.kind === "storyboard" && current.providerJobId && <button className="secondary" disabled={busy !== ""} onClick={() => action(current, "resume")}><RotateCcw size={15}/>续跑故事板</button>}
            {current.status === "failed" && <button className="secondary" disabled={busy !== ""} onClick={() => action(current, "retry")}><Repeat2 size={15}/>重试失败任务</button>}
            {current.kind === "video_generation" && current.status === "succeeded" && <button className="secondary" disabled={busy !== ""} onClick={() => action(current, "similar")} title="使用原 Prompt、素材和 Recipe 创建新的独立候选"><Sparkles size={15}/>再来一个类似版本</button>}
            <button className="icon-button danger" onClick={() => remove(current)}><Trash2 size={15}/></button>
          </div>
        </div>

        {currentBatch && <div className="lineage"><Layers3 size={15}/><span>批量版本 {currentBatch.index}/{currentBatch.total}</span>{batchJobs.map(job => { const meta = batchMeta(job)!; return <button key={job.id} onClick={() => setSelected(job.id)}>{meta.index}/{meta.total} · {statusShort(job.status)}</button>; })}</div>}
        {current.parentJobId && <div className="lineage"><GitBranch size={15}/>{relationLabel(current)} <button onClick={() => setSelected(current.parentJobId!)}>{jobs.find(job => job.id === current.parentJobId)?.title || short(current.parentJobId)}</button></div>}
        {jobs.some(job => job.parentJobId === current.id) && <div className="lineage"><GitBranch size={15}/>下游任务 {jobs.filter(job => job.parentJobId === current.id).slice(0, 6).map(job => <button key={job.id} onClick={() => setSelected(job.id)}>{job.title}</button>)}</div>}
        {current.error && <div className={`error-banner ${current.status !== "failed" ? "warning" : ""}`}><AlertTriangle size={16}/>{current.error}</div>}

        {current.outputs.length > 0 ? <div>
          <div className="subhead"><h3>生成结果</h3><span>{current.outputs.length} 个输出 · 可直接查看和保存</span></div>
          <div className={`result-grid ${current.outputs.length === 1 ? "single" : ""}`}>{current.outputs.map((output, index) => <ResultCard output={output} key={`${output.outputUrl}-${index}`} index={index} onArchive={() => archive(current, index)} busy={busy !== ""}/>)}</div>
        </div> : <PendingState job={current}/>} 

        <ContinueCreation job={current} onCreated={selectCreated}/>
        <VideoExtend job={current} modelStudioAvailable={modelStudioAvailable} onCreated={selectCreated}/>
        {current.kind === "storyboard" && <StoryboardDetails job={current}/>} 

        <details className="raw-detail"><summary>技术详情</summary><div className="raw-columns"><JsonBlock title="提交参数" value={current.request}/><JsonBlock title="服务原始响应" value={current.provider}/></div></details>
      </>}
    </section>
  </div>;
}

function batchMeta(job: StoredJob): BatchMeta | null {
  const raw: any = (job.request as any)?._batch;
  const id = String(raw?.id || job.details?.batchId || "");
  const index = Number(raw?.index || job.details?.batchIndex || 0);
  const total = Number(raw?.total || job.details?.batchTotal || 0);
  return id && Number.isInteger(index) && index > 0 && Number.isInteger(total) && total > 1 ? { id, index, total } : null;
}

function relationLabel(job: StoredJob) {
  const action = String(job.details?.creationAction || "");
  if (action === "retry") return "失败重试自";
  if (action === "similar_variant") return "类似版本源自";
  if (action === "continue_from_result") return "继续创作源自";
  if (action === "video_extension") return "视频延长源自";
  return "上游 / 父任务";
}

function statusShort(status: string) {
  return status === "succeeded" ? "完成" : status === "failed" ? "失败" : status === "running" ? "生成中" : status === "queued" ? "排队" : "待确认";
}

function PendingState({ job }: { job: StoredJob }) {
  let title = "等待生成结果";
  let text = "刷新任务查看最新状态。";
  if (job.status === "failed") {
    title = "没有可用输出";
    text = "查看上方失败原因后，可以点击“重试失败任务”。";
  } else if (job.status === "running") {
    text = job.kind === "video_extension"
      ? "正在沿原视频时间轴生成连续内容，完成后会返回包含原片的完整延长视频。"
      : job.kind === "video_generation"
        ? "正在生成视频，完成后结果会自动出现。"
        : "任务正在执行，Wanke 会自动检查进度。";
  } else if (job.status === "queued") {
    text = job.kind === "video_extension" ? "视频延长任务已进入百炼队列。" : "任务已进入生成队列，Wanke 会自动检查进度。";
  } else if (job.details?.pollable === false) {
    text = String(job.details?.note || "任务已提交，但当前没有可查询的进度接口。");
  }
  return <div className="pending-card"><LoaderCircle className={job.status === "running" || job.status === "queued" ? "spin" : ""} size={24}/><div><strong>{title}</strong><span>{text}</span></div></div>;
}

function ResultCard({ output, index, onArchive, busy }: { output: ResultMedia; index: number; onArchive: () => void; busy: boolean }) {
  const remote = output.outputUrl || "";
  const url = output.archivedFile ? `/api/archive/${encodeURIComponent(output.archivedFile)}` : remote;
  const subtitle = output.kind === "subtitle" || /\.srt(\?|$)/i.test(url);
  const json = output.kind === "json" || /\.json(\?|$)/i.test(url);
  return <article className="result-card">
    {subtitle ? <div className="subtitle-result"><strong>SRT</strong><span>{output.label || "字幕文件"}</span></div>
      : json ? <div className="subtitle-result json-result"><strong>JSON</strong><span>{output.label || "结构化生产文件"}</span></div>
        : output.kind === "other" ? <div className="subtitle-result"><strong>FILE</strong><span>{output.label || "结果文件"}</span></div>
          : url ? <video src={url} controls preload="metadata"/> : <div className="no-preview">无预览 URL</div>}
    <div className="result-info">
      <div>
        <strong>{output.label || `版本 ${index + 1}`}{output.outputLanguage ? ` · ${output.outputLanguage}` : ""}</strong>
        {output.archivedFile ? <span className="archive-ok">已保存到本机 · {output.archivedFile}</span> : remote && <span>云端结果链接会过期，满意后建议保存到本机。</span>}
        {output.mediaId && <span>MediaId: {short(output.mediaId)}</span>}
        {output.editingProjectId && <span>剪辑工程: {short(output.editingProjectId)}</span>}
      </div>
      <div className="result-actions">
        {remote && !output.archivedFile && <button className="icon-button" disabled={busy} title="保存到本机（推荐），避免云端结果链接过期" onClick={onArchive}><Download size={15}/></button>}
        {url && <a className="icon-button" href={url} target="_blank" rel="noreferrer" title="打开结果"><ExternalLink size={15}/></a>}
      </div>
    </div>
  </article>;
}

function StoryboardDetails({ job }: { job: StoredJob }) {
  const details: any = job.details || {};
  const failed = Array.isArray(details.failedShots) ? details.failedShots : [];
  const info = Array.isArray(details.storyboardInfo) ? details.storyboardInfo : [];
  return <div className="storyboard-detail">
    <div className="subhead"><h3>镜头执行情况</h3><span>{info.length ? `${info.length} 个故事板` : "等待明细"}</span></div>
    {failed.length > 0 && <div className="shot-failures">{failed.map((item: any, index: number) => <div key={index}><AlertTriangle size={14}/><span>Storyboard {item.storyboardId || "-"} · Shot {item.shotId || "-"}</span><code>{item.errorCode || "Unknown"}</code></div>)}</div>}
    {info.length > 0 && <div className="shot-table">{info.map((item: any, index: number) => <div key={index}><span>{item.title || item.storyboardId || `#${index + 1}`}</span><b>{item.status || "-"}</b><small>{item.subStatus || ""}</small></div>)}</div>}
  </div>;
}

function JsonBlock({ title, value }: any) {
  return <div><b>{title}</b><pre>{JSON.stringify(value, null, 2)}</pre></div>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "succeeded") return <span className="status-icon success"><Check size={14}/></span>;
  if (status === "failed") return <span className="status-icon fail"><AlertTriangle size={14}/></span>;
  if (status === "running") return <span className="status-icon running"><LoaderCircle className="spin" size={14}/></span>;
  return <span className="status-icon queued"><Clock3 size={14}/></span>;
}

function StatusLabel({ status }: { status: string }) {
  const map: Record<string, string> = { succeeded: "已完成", failed: "失败", running: "生成中", queued: "排队中", unknown: "待确认" };
  return <span className={`status-label ${status}`}>{map[status] || status}</span>;
}

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function ago(date: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Date(date).toLocaleDateString();
}
