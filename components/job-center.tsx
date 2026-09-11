"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookmarkPlus, Check, ChevronRight, Clock3, Cpu, Download, ExternalLink, Film, GitBranch, Layers3, LoaderCircle, RefreshCw, Repeat2, RotateCcw, ShieldCheck, Sparkles, Timer, Trash2 } from "lucide-react";
import ContinueCreation from "@/components/continue-creation";
import VideoExtend from "@/components/video-extend";
import VideoEdit from "@/components/video-edit";
import { JOB_KIND_LABELS, type JobStatus, type ResultMedia, type StoredJob } from "@/lib/types";
import { JOB_STATUS_COPY } from "@/lib/copy";

const kindName: Record<string, string> = JOB_KIND_LABELS;
type BatchMeta = { id: string; index: number; total: number };

export default function JobCenter({ jobs, modelStudioAvailable, onChanged, onGoAssets: _onGoAssets, onSaveWork }: {
  jobs: StoredJob[];
  modelStudioAvailable: boolean;
  onChanged: () => Promise<void> | void;
  onGoAssets: () => void;
  onSaveWork?: (job: StoredJob, outputIndex: number) => Promise<void> | void;
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
      {/* §20: the member must know the creation is not tied to this tab. */}
      <div className="muted mini" style={{ padding: "0 2px 8px" }}>
        创作在服务器后台继续进行，关闭页面或断网都不会中断；完成后会自动出现在这里，并在通知中心提醒你。
      </div>
      <div className="job-list">
        {shown.map(job => {
          const batch = batchMeta(job);
          const isActive = ["running", "queued", "unknown"].includes(job.status);
          return <button key={job.id} className={`job-row ${current?.id === job.id ? "active" : ""}`} onClick={() => setSelected(job.id)}>
            <StatusIcon status={job.status}/>
            <div className="job-row-main">
              <strong>{job.title}</strong>
              <span>{batch ? `批量版本 ${batch.index}/${batch.total} · ` : ""}{kindName[job.kind]} · {ago(job.createdAt)}</span>
              {isActive && <JobRowProgress job={job}/>}
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
            </div>
          </div>
          <div className="detail-actions">
            <button className="secondary" disabled={busy !== "" || current.details?.pollable === false} onClick={() => action(current, "refresh")} title={current.details?.pollable === false ? String(current.details?.note || "该类型当前没有查询接口") : "检查最新状态"}><RefreshCw size={15}/>{current.details?.pollable === false ? "无查询接口" : "刷新"}</button>
            {current.kind === "storyboard" && current.tracked && <button className="secondary" disabled={busy !== ""} onClick={() => action(current, "resume")}><RotateCcw size={15}/>续跑故事板</button>}
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
          <div className={`result-grid ${current.outputs.length === 1 ? "single" : ""}`}>{current.outputs.map((output, index) => <ResultCard output={output} job={current} key={`${output.outputUrl}-${index}`} index={index} onArchive={() => archive(current, index)} onSaveWork={current.status === "succeeded" && onSaveWork ? () => onSaveWork(current, index) : undefined} busy={busy !== ""}/>)}</div>
        </div> : <PendingState job={current} onRefresh={() => action(current, "refresh")} onRetry={() => action(current, "retry")} busy={busy !== ""}/>} 

        <ContinueCreation job={current} onCreated={selectCreated}/>
        <VideoExtend job={current} modelStudioAvailable={modelStudioAvailable} onCreated={selectCreated}/>
        <VideoEdit job={current} modelStudioAvailable={modelStudioAvailable} onCreated={selectCreated}/>
        {current.kind === "storyboard" && <StoryboardDetails job={current}/>} 

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
  if (action === "video_editing") return "视频编辑源自";
  return "上游 / 父任务";
}

function statusShort(status: string) {
  return JOB_STATUS_COPY[status as JobStatus] || "状态确认中";
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} 分 ${s} 秒`;
}

function PendingState({ job, onRefresh, onRetry, busy }: { job: StoredJob; onRefresh?: () => void; onRetry?: () => void; busy?: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = useMemo(() => {
    const start = new Date(job.createdAt).getTime();
    return Math.max(0, Math.floor((now - start) / 1000));
  }, [job.createdAt, now]);

  const targetDuration = Number(
    job.details?.effectiveDuration ||
    job.details?.targetDuration ||
    (job.request as any)?.duration ||
    5
  );

  const estimatedTotal = useMemo(() => {
    if (job.kind === "video_extension") return 75;
    if (job.kind === "video_editing") return 80;
    if (job.kind === "storyboard") {
      const shots = Array.isArray(job.details?.storyboardInfo) ? job.details.storyboardInfo.length : 4;
      return Math.max(90, shots * 22);
    }
    return Math.max(60, Math.round(48 + targetDuration * 3.6));
  }, [job.kind, targetDuration, job.details]);

  if (job.status === "failed") {
    return (
      <div className="job-progress-failed">
        <div className="job-progress-failed-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="job-progress-failed-content">
          <strong>任务没有生成可用结果</strong>
          <p>{job.error || "生成过程遇到云端异常或超时中断，本次生成的点数若已预扣除系统将自动退回。"}</p>
          {onRetry && (
            <button className="secondary" disabled={busy} onClick={onRetry}>
              <Repeat2 size={14} /> 重试失败任务
            </button>
          )}
        </div>
      </div>
    );
  }

  let step = 1;
  let statusTitle = "任务已提交";
  let statusDesc = "已完成任务参数校验与资源初始化。";
  let progress = 10;
  let etaLabel = `预计总需约 ${estimatedTotal} 秒`;

  if (job.status === "queued") {
    step = 2;
    statusTitle = "任务已进入云端生成队列";
    statusDesc = "已连接阿里云 GPU 算力集群，正在排队调度等待模型实例开始推理。";
    const queueClimb = Math.min(13, Math.floor((elapsed / 30) * 13));
    progress = 15 + queueClimb;
    const remaining = Math.max(10, estimatedTotal - elapsed);
    etaLabel = `算力排队中，预计排队约 ${remaining <= 15 ? "10~20" : remaining} 秒`;
  } else if (job.status === "running") {
    step = 3;
    statusTitle = job.kind === "video_extension"
      ? "正在沿原片时间轴延长视频"
      : job.kind === "video_editing"
        ? "正在根据指令逐帧编辑处理视频"
        : "AI 视频画面扩散推理中";
    const rawModel = String(job.details?.model || job.request?.model || "");
    const modelTag = rawModel.includes("happyhorse") ? "HappyHorse 1.1" : "Wan 3.0";
    statusDesc = job.kind === "video_extension"
      ? "正在保持主体与画风连续性，生成高质量延长动作与运镜。"
      : job.kind === "video_editing"
        ? "正在按编辑提示词逐帧优化主体结构、色彩与运动细节。"
        : `${modelTag} 视频大模型正在进行多步扩散推理与高精度画面合成。`;

    const storyboardShots = Array.isArray(job.details?.storyboardInfo) ? job.details.storyboardInfo : [];
    if (storyboardShots.length > 0) {
      const finished = storyboardShots.filter((s: any) => s.status === "succeeded" || s.status === "finished" || s.status === "done").length;
      progress = Math.min(95, Math.round(25 + (finished / storyboardShots.length) * 70));
      etaLabel = `分镜头执行进度：${finished}/${storyboardShots.length} 镜头完成`;
    } else {
      const ratio = Math.min(2.5, elapsed / estimatedTotal);
      const curve = 1 - Math.exp(-2.2 * ratio);
      progress = Math.min(92, Math.round(32 + curve * 58));
      if (elapsed < estimatedTotal) {
        const remain = Math.max(5, Math.round(estimatedTotal - elapsed));
        etaLabel = `预计还需约 ${remain} 秒完成`;
      } else {
        etaLabel = "正在进行最终画质优化与转码编码，即将完成";
      }
    }
  } else if (job.status === "unknown") {
    step = 2;
    statusTitle = "远端状态确认中";
    statusDesc = "任务已提交，系统正在自动同步最新生成进度，请稍候。";
    progress = 30;
    etaLabel = "状态确认中…";
  }

  if (job.details?.pollable === false) {
    statusDesc = String(job.details?.note || "任务已提交，但当前类型没有可查询的轮询接口。");
  }

  const isOvertime = elapsed > 240;

  return (
    <div className="job-progress-card">
      <div className="job-progress-header">
        <div className="job-progress-title-wrap">
          <div className="job-progress-icon">
            <Sparkles size={20} />
          </div>
          <div>
            <strong>{statusTitle}</strong>
            <span>{statusDesc}</span>
          </div>
        </div>
        <div className="job-progress-badge">
          <strong>{progress}</strong>
          <small>%</small>
        </div>
      </div>

      <div className="job-progress-track">
        <div className="job-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="job-progress-steps">
        <div className={`job-step ${step > 1 ? "done" : step === 1 ? "active" : "pending"}`}>
          <div className="job-step-dot">{step > 1 ? <Check size={12} /> : 1}</div>
          <span className="job-step-name">提交校验</span>
        </div>
        <div className={`job-step ${step > 2 ? "done" : step === 2 ? "active" : "pending"}`}>
          <div className="job-step-dot">{step > 2 ? <Check size={12} /> : step === 2 ? <LoaderCircle className="spin" size={12} /> : 2}</div>
          <span className="job-step-name">队列排队</span>
        </div>
        <div className={`job-step ${step > 3 ? "done" : step === 3 ? "active" : "pending"}`}>
          <div className="job-step-dot">{step > 3 ? <Check size={12} /> : step === 3 ? <LoaderCircle className="spin" size={12} /> : 3}</div>
          <span className="job-step-name">AI 渲染</span>
        </div>
        <div className={`job-step ${step >= 4 ? "done" : "pending"}`}>
          <div className="job-step-dot">{step >= 4 ? <Check size={12} /> : 4}</div>
          <span className="job-step-name">完成交付</span>
        </div>
      </div>

      <div className="job-progress-metrics">
        <div className="time-stat">
          <Timer size={14} />
          <span>已耗时 <b className="highlight">{formatDuration(elapsed)}</b></span>
        </div>
        <div className="eta-stat">
          <Clock3 size={14} />
          <span>{etaLabel}</span>
        </div>
      </div>

      {isOvertime && (
        <div className="job-progress-warning">
          <span>当前排队或渲染时间较长（可能正值云端算力高峰），后台仍在正常计算中。</span>
          {onRefresh && (
            <button onClick={onRefresh} disabled={busy}>
              <RefreshCw size={12} className={busy ? "spin" : ""} />
              {busy ? "正在同步…" : "手动检查状态"}
            </button>
          )}
        </div>
      )}

      <div className="job-progress-footer">
        <div className="job-progress-reassure">
          <ShieldCheck size={14} />
          <span>后台自动同步 · 关闭标签页或断网都不会中断生成任务</span>
        </div>
        {onRefresh && (
          <button className="link-button" onClick={onRefresh} disabled={busy} style={{ padding: 0 }}>
            <RefreshCw size={12} className={busy ? "spin" : ""} /> 同步进度
          </button>
        )}
      </div>
    </div>
  );
}

function ResultCard({ output, job, index, onArchive, onSaveWork, busy }: { output: ResultMedia; job?: StoredJob; index: number; onArchive: () => void; onSaveWork?: () => void; busy: boolean }) {
  const [videoMeta, setVideoMeta] = useState<{ width: number; height: number; duration: number } | null>(null);
  const remote = output.outputUrl || "";
  const url = output.archivedFile ? `/api/archive/${encodeURIComponent(output.archivedFile)}` : remote;
  const subtitle = output.kind === "subtitle" || /\.srt(\?|$)/i.test(url);
  const json = output.kind === "json" || /\.json(\?|$)/i.test(url);
  const isVideo = !subtitle && !json && output.kind !== "other" && Boolean(url);

  // 提取结构化视频参数
  const req: any = job?.request || {};
  const details: any = job?.details || {};

  // 1. 清晰度
  let resolution = String(details.resolution || req.resolution || "").toUpperCase();
  if (!resolution || resolution === "UNDEFINED") {
    if (videoMeta?.height) {
      const minDim = Math.min(videoMeta.width, videoMeta.height);
      if (minDim >= 1080) resolution = "1080P";
      else if (minDim >= 720) resolution = "720P";
      else if (minDim >= 480) resolution = "480P";
      else resolution = `${minDim}P`;
    } else {
      resolution = "1080P";
    }
  }

  // 2. 模型标识
  const rawModel = String(details.model || req.model || details.route || "");
  const modelLabel = rawModel.toLowerCase().includes("happyhorse") ? "HappyHorse 1.1" : "Wan 3.0";

  // 3. 视频时长
  const durationSec = videoMeta?.duration
    ? Math.round(videoMeta.duration)
    : Number(details.effectiveDuration || details.duration || req.duration || 5);

  // 4. 画幅比例
  let ratio = String(details.ratio || details.aspectRatio || req.aspectRatio || "");
  if (!ratio && videoMeta?.width && videoMeta?.height) {
    const r = videoMeta.width / videoMeta.height;
    if (Math.abs(r - 9 / 16) < 0.08) ratio = "9:16";
    else if (Math.abs(r - 16 / 9) < 0.08) ratio = "16:9";
    else if (Math.abs(r - 3 / 4) < 0.08) ratio = "3:4";
    else if (Math.abs(r - 4 / 3) < 0.08) ratio = "4:3";
    else if (Math.abs(r - 1) < 0.08) ratio = "1:1";
  }
  if (!ratio) ratio = "16:9";

  // 5. 任务模式
  let modeLabel = "AI 视频生成";
  if (job?.kind === "video_extension") modeLabel = "原生延长";
  else if (job?.kind === "video_editing") modeLabel = "指令编辑";
  else if (job?.kind === "storyboard") modeLabel = "故事板";
  else if (req._quickCreation?.type === "person_short") modeLabel = "人物短片";
  else if (req._quickCreation?.type === "product_ad") modeLabel = "产品广告";
  else if (req._quickCreation?.type === "text_video") modeLabel = "文字生视频";
  else if (req._quickCreation?.type === "image_video") modeLabel = "图片动起来";
  else if (req.jobType === "image_to_video") modeLabel = "图生视频";
  else if (req.jobType === "reference_to_video") modeLabel = "多参考生视频";
  else if (req.jobType === "first_last_frame") modeLabel = "首尾帧";
  else if (req.jobType === "text_to_video") modeLabel = "文生视频";

  const dimensionText = videoMeta?.width && videoMeta?.height ? `${videoMeta.width}×${videoMeta.height}` : "";

  return <article className="result-card">
    <div className="result-media-wrap">
      {subtitle ? <div className="subtitle-result"><strong>SRT</strong><span>{output.label || "字幕文件"}</span></div>
        : json ? <div className="subtitle-result json-result"><strong>JSON</strong><span>{output.label || "结构化生产文件"}</span></div>
          : output.kind === "other" ? <div className="subtitle-result"><strong>FILE</strong><span>{output.label || "结果文件"}</span></div>
            : url ? (
              <>
                <video
                  src={url}
                  controls
                  preload="metadata"
                  onLoadedMetadata={e => {
                    setVideoMeta({
                      width: e.currentTarget.videoWidth,
                      height: e.currentTarget.videoHeight,
                      duration: e.currentTarget.duration,
                    });
                  }}
                />
                {isVideo && (
                  <div className="video-badge-overlay">
                    <span className={`res-pill res-${resolution.toLowerCase()}`}>
                      {resolution}
                    </span>
                    {dimensionText && <span className="dim-pill">{dimensionText}</span>}
                  </div>
                )}
              </>
            ) : <div className="no-preview">无预览 URL</div>}
    </div>

    <div className="result-info">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
          <strong style={{ fontSize: "13px" }}>{output.label || `版本 ${index + 1}`}{output.outputLanguage ? ` · ${output.outputLanguage}` : ""}</strong>
          {isVideo && (
            <span className={`badge-res badge-res-${resolution.toLowerCase()}`}>
              {resolution} 高清
            </span>
          )}
        </div>

        {isVideo && (
          <div className="video-specs-row">
            <span className="spec-tag" title="清晰度与实际分辨率像素">
              <Layers3 size={11} />
              <b>{resolution}</b>
              {dimensionText ? <small>({dimensionText})</small> : null}
            </span>
            <span className="spec-tag" title="生成模型">
              <Cpu size={11} />
              <b>{modelLabel}</b>
            </span>
            <span className="spec-tag" title="视频时长">
              <Clock3 size={11} />
              <b>{durationSec} 秒</b>
            </span>
            <span className="spec-tag" title="画幅比例">
              <Film size={11} />
              <b>{ratio}</b>
            </span>
            <span className="spec-tag" title="生成类型">
              <Sparkles size={11} />
              <b>{modeLabel}</b>
            </span>
            <span className="spec-tag" title="帧率与原生音频">
              <b>30fps · 原生音频</b>
            </span>
          </div>
        )}

        <div style={{ marginTop: "6px" }}>
          {output.archivedFile ? (
            <span className="archive-ok" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <Check size={13} /> 已保存到本机 · {output.archivedFile}
            </span>
          ) : remote && (
            <span className="archive-warning-text">
              <Clock3 size={12} /> 云端结果链接会过期，满意后建议点击右侧保存到本机。
            </span>
          )}
        </div>
      </div>

      <div className="result-actions" style={{ alignSelf: "flex-start", flexShrink: 0 }}>
        {isVideo && onSaveWork && <button className="icon-button" disabled={busy} title="保存到「我的作品」，长期管理" onClick={onSaveWork}><BookmarkPlus size={16}/></button>}
        {remote && !output.archivedFile && <button className="icon-button" disabled={busy} title="保存到本机（推荐），避免云端结果链接过期" onClick={onArchive}><Download size={16}/></button>}
        {url && <a className="icon-button" href={url} target="_blank" rel="noreferrer" title="新标签页打开结果"><ExternalLink size={16}/></a>}
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

function StatusIcon({ status }: { status: string }) {
  if (status === "succeeded") return <span className="status-icon success"><Check size={14}/></span>;
  if (status === "failed") return <span className="status-icon fail"><AlertTriangle size={14}/></span>;
  if (status === "running") return <span className="status-icon running"><LoaderCircle className="spin" size={14}/></span>;
  return <span className="status-icon queued"><Clock3 size={14}/></span>;
}

function StatusLabel({ status }: { status: string }) {
  return <span className={`status-label ${status}`}>{JOB_STATUS_COPY[status as JobStatus] || "状态确认中"}</span>;
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

function JobRowProgress({ job }: { job: StoredJob }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - new Date(job.createdAt).getTime()) / 1000));
  let progress = 15;
  if (job.status === "queued") {
    progress = Math.min(28, Math.round(15 + (elapsed / 30) * 13));
  } else if (job.status === "running") {
    const ratio = Math.min(2.5, elapsed / 70);
    const curve = 1 - Math.exp(-2.2 * ratio);
    progress = Math.min(92, Math.round(32 + curve * 58));
  } else if (job.status === "unknown") {
    progress = 30;
  }

  return (
    <div className="job-row-progress">
      <div className="job-row-progress-track">
        <div className="job-row-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="job-row-progress-pct">{progress}%</span>
    </div>
  );
}
