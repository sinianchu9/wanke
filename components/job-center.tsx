"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Clock3, Copy, Download, ExternalLink, Film, GitBranch, LoaderCircle, RefreshCw, Repeat2, RotateCcw, Trash2 } from "lucide-react";
import { JOB_KIND_LABELS, type ResultMedia, type StoredJob } from "@/lib/types";

const kindName: Record<string,string> = JOB_KIND_LABELS;

export default function JobCenter({ jobs, onChanged, onGoAssets: _onGoAssets }: { jobs: StoredJob[]; onChanged: () => Promise<void> | void; onGoAssets: () => void }) {
  const [selected, setSelected] = useState<string | null>(jobs[0]?.id || null);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const current = jobs.find(j=>j.id===selected) || jobs[0];
  useEffect(()=>{ if (!selected && jobs[0]) setSelected(jobs[0].id); },[jobs,selected]);
  const shown = useMemo(()=>filter==="all"?jobs:jobs.filter(j=>j.status===filter),[jobs,filter]);

  async function action(job: StoredJob, action: "refresh"|"retry"|"resume") {
    setBusy(`${job.id}:${action}`);
    try {
      const res=await fetch(`/api/jobs/${job.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action})});
      const data=await res.json(); if(!res.ok) throw new Error(data.error||"操作失败");
      await onChanged(); if(data.job?.id) setSelected(data.job.id);
    } catch(e){ alert(e instanceof Error?e.message:String(e)); }
    finally{setBusy("")}
  }
  async function archive(job:StoredJob,index:number){setBusy(`${job.id}:archive:${index}`);try{const res=await fetch(`/api/jobs/${job.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"archive",index})});const data=await res.json();if(!res.ok)throw new Error(data.error||"归档失败");await onChanged()}catch(e){alert(e instanceof Error?e.message:String(e))}finally{setBusy("")}}
  async function remove(job:StoredJob){if(!confirm("删除这条任务记录及其本机归档文件？云端任务和云端媒资不会被删除。"))return;await fetch(`/api/jobs/${job.id}`,{method:"DELETE"});setSelected(null);await onChanged()}

  return <div className="jobs-layout">
    <section className="job-list-panel">
      <div className="panel-head"><div><div className="eyebrow">PRODUCTION QUEUE</div><h2>任务中心</h2></div><button className="icon-button" onClick={()=>onChanged()}><RefreshCw size={16}/></button></div>
      <div className="filter-tabs">{[["all","全部"],["running","进行中"],["queued","排队"],["succeeded","完成"],["failed","失败"],["unknown","待确认"]].map(([id,label])=><button className={filter===id?"active":""} key={id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
      <div className="job-list">{shown.map(job=><button key={job.id} className={`job-row ${current?.id===job.id?"active":""}`} onClick={()=>setSelected(job.id)}><StatusIcon status={job.status}/><div className="job-row-main"><strong>{job.title}</strong><span>{kindName[job.kind]} · {ago(job.createdAt)}</span></div><ChevronRight size={15}/></button>)}{!shown.length&&<div className="empty-list">暂无任务</div>}</div>
    </section>

    <section className="job-detail-panel">
      {!current ? <div className="empty-state"><Film size={32}/><strong>还没有视频任务</strong><span>从左侧任一创作功能提交后，任务会出现在这里。</span></div> : <>
        <div className="detail-head"><div><div className="kind-pill">{kindName[current.kind]}</div><h2>{current.title}</h2><div className="detail-meta"><StatusLabel status={current.status}/><span>{new Date(current.createdAt).toLocaleString()}</span>{current.providerJobId&&<button className="text-copy" onClick={()=>navigator.clipboard.writeText(current.providerJobId!)}><code>{short(current.providerJobId)}</code><Copy size={12}/></button>}</div></div><div className="detail-actions"><button className="secondary" disabled={busy!=="" || current.details?.pollable===false} onClick={()=>action(current,"refresh")} title={current.details?.pollable===false?String(current.details?.note||"该类型当前没有查询接口"):"刷新远端状态"}><RefreshCw size={15}/>{current.details?.pollable===false?"无查询接口":"刷新"}</button>{current.kind==="storyboard"&&current.providerJobId&&<button className="secondary" disabled={busy!==""} onClick={()=>action(current,"resume")}><RotateCcw size={15}/>续跑故事板</button>}<button className="secondary" disabled={busy!==""} onClick={()=>action(current,"retry")}><Repeat2 size={15}/>复制参数重跑</button><button className="icon-button danger" onClick={()=>remove(current)}><Trash2 size={15}/></button></div></div>

        {current.parentJobId&&<div className="lineage"><GitBranch size={15}/>上游 / 父任务 <button onClick={()=>setSelected(current.parentJobId!)}>{jobs.find(j=>j.id===current.parentJobId)?.title||short(current.parentJobId)}</button></div>}
        {jobs.some(j=>j.parentJobId===current.id)&&<div className="lineage"><GitBranch size={15}/>下游任务 {jobs.filter(j=>j.parentJobId===current.id).slice(0,6).map(j=><button key={j.id} onClick={()=>setSelected(j.id)}>{j.title}</button>)}</div>}
        {current.error&&<div className={`error-banner ${current.status!=="failed"?"warning":""}`}><AlertTriangle size={16}/>{current.error}</div>}

        {current.outputs.length>0 ? <div><div className="subhead"><h3>生成结果</h3><span>{current.outputs.length} 个输出 · 可直接并排比较</span></div><div className={`result-grid ${current.outputs.length===1?"single":""}`}>{current.outputs.map((o,i)=><ResultCard output={o} key={`${o.outputUrl}-${i}`} index={i} onArchive={()=>archive(current,i)} busy={busy!==""}/>)}</div></div> : <div className="pending-card"><LoaderCircle className={current.status==="running"||current.status==="queued"?"spin":""} size={24}/><div><strong>{current.status==="failed"?"没有可用输出":"等待生成结果"}</strong><span>{current.status==="running"?"万镜一刻正在执行，Wanke 会按任务年龄自适应续查。":current.status==="queued"?"任务已进入远端队列。":current.details?.pollable===false?String(current.details?.note||"任务已提交，但当前没有可轮询的查询接口。") : "刷新任务查看最新状态。"}</span></div></div>}

        {current.kind==="storyboard"&&<StoryboardDetails job={current}/>} 

        <details className="raw-detail"><summary>请求参数与原始响应</summary><div className="raw-columns"><JsonBlock title="Wanke 请求" value={current.request}/><JsonBlock title="Yike 原始响应" value={current.provider}/></div></details>
      </>}
    </section>
  </div>;
}

function ResultCard({output,index,onArchive,busy}:{output:ResultMedia;index:number;onArchive:()=>void;busy:boolean}){const remote=output.outputUrl||"";const url=output.archivedFile?`/api/archive/${encodeURIComponent(output.archivedFile)}`:remote;const subtitle=output.kind==="subtitle"||/\.srt(\?|$)/i.test(url);const json=output.kind==="json"||/\.json(\?|$)/i.test(url);return <article className="result-card">{subtitle?<div className="subtitle-result"><strong>SRT</strong><span>{output.label||"字幕文件"}</span></div>:json?<div className="subtitle-result json-result"><strong>JSON</strong><span>{output.label||"结构化生产文件"}</span></div>:output.kind==="other"?<div className="subtitle-result"><strong>FILE</strong><span>{output.label||"结果文件"}</span></div>:url?<video src={url} controls preload="metadata"/>:<div className="no-preview">无预览 URL</div>}<div className="result-info"><div><strong>{output.label||`版本 ${index+1}`}{output.outputLanguage?` · ${output.outputLanguage}`:""}</strong>{output.archivedFile&&<span className="archive-ok">已归档到本机 · {output.archivedFile}</span>}{output.mediaId&&<span>MediaId: {short(output.mediaId)}</span>}{output.editingProjectId&&<span>剪辑工程: {short(output.editingProjectId)}</span>}</div><div className="result-actions">{remote&&!output.archivedFile&&<button className="icon-button" disabled={busy} title="保存到 data/outputs，避免签名 URL 过期" onClick={onArchive}><Download size={15}/></button>}{url&&<a className="icon-button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a>}</div></div></article>}
function StoryboardDetails({job}:{job:StoredJob}){const d:any=job.details||{};const failed=Array.isArray(d.failedShots)?d.failedShots:[];const info=Array.isArray(d.storyboardInfo)?d.storyboardInfo:[];return <div className="storyboard-detail"><div className="subhead"><h3>镜头执行情况</h3><span>{info.length?`${info.length} 个故事板`:"等待明细"}</span></div>{failed.length>0&&<div className="shot-failures">{failed.map((f:any,i:number)=><div key={i}><AlertTriangle size={14}/><span>Storyboard {f.storyboardId||"-"} · Shot {f.shotId||"-"}</span><code>{f.errorCode||"Unknown"}</code></div>)}</div>}{info.length>0&&<div className="shot-table">{info.map((s:any,i:number)=><div key={i}><span>{s.title||s.storyboardId||`#${i+1}`}</span><b>{s.status||"-"}</b><small>{s.subStatus||""}</small></div>)}</div>}</div>}
function JsonBlock({title,value}:any){return <div><b>{title}</b><pre>{JSON.stringify(value,null,2)}</pre></div>}
function StatusIcon({status}:{status:string}){if(status==="succeeded")return <span className="status-icon success"><Check size={14}/></span>;if(status==="failed")return <span className="status-icon fail"><AlertTriangle size={14}/></span>;if(status==="running")return <span className="status-icon running"><LoaderCircle className="spin" size={14}/></span>;return <span className="status-icon queued"><Clock3 size={14}/></span>}
function StatusLabel({status}:{status:string}){const map:any={succeeded:"已完成",failed:"失败",running:"生成中",queued:"排队中",unknown:"待确认"};return <span className={`status-label ${status}`}>{map[status]||status}</span>}
function short(v:string){return v.length>18?`${v.slice(0,8)}…${v.slice(-6)}`:v}
function ago(date:string){const s=Math.max(0,Math.floor((Date.now()-new Date(date).getTime())/1000));if(s<60)return `${s} 秒前`;if(s<3600)return `${Math.floor(s/60)} 分钟前`;if(s<86400)return `${Math.floor(s/3600)} 小时前`;return new Date(date).toLocaleDateString()}
