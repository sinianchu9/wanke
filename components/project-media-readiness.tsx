"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleX, ScanSearch } from "lucide-react";
import ProjectFinalAssembly from "@/components/project-final-assembly";
import ProjectSubtitleSettings from "@/components/project-subtitle-settings";
import ProjectTransitionSettings from "@/components/project-transition-settings";

type Probe = {
  source: "archive" | "remote";
  duration: number | null;
  formatName: string;
  videoCodec: string;
  width: number;
  height: number;
  pixelFormat: string;
  frameRate: number | null;
  hasAudio: boolean;
  audioCodec: string;
  audioSampleRate: number | null;
  audioChannels: number | null;
};

type ShotReadiness = {
  shotId: string;
  shotName: string;
  index: number;
  ready: boolean;
  reason?: string;
  jobTitle?: string;
  probe?: Probe;
};

type ReadinessResponse = {
  available: boolean;
  message?: string;
  complete?: boolean;
  profilesAligned?: boolean;
  normalizationRequired?: boolean;
  readyCount?: number;
  totalCount?: number;
  profileCount?: number;
  note?: string;
  shots?: ShotReadiness[];
};

export default function ProjectMediaReadiness({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setData(null); setError(""); }, [projectId]);

  async function check() {
    setBusy(true); setError(""); setData(null);
    try {
      const response = await fetch("/api/projects/media-readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "媒体规格检查失败");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <>
    <section className="panel" style={{marginBottom:18}}>
      <div className="panel-head">
        <div className="panel-title"><ScanSearch size={17}/><div><h3>成片规格检查</h3><p>检查所有定稿视频的编码、分辨率、FPS 和音频规格；不会修改、转码或拼接文件。</p></div></div>
        <button className="secondary" disabled={busy} onClick={check}><ScanSearch size={15}/>{busy ? "正在检查…" : "检查成片规格"}</button>
      </div>

      {!data && !error && <div className="muted mini" style={{marginTop:10}}>这一步只做诊断。服务器没有 ffprobe 时会明确提示，不影响项目、生成和定稿功能。</div>}
      {error && <div className="error-banner" style={{marginTop:10}}>{error}</div>}

      {data && !data.available && <div className="error-banner warning" style={{marginTop:10}}>{data.message}</div>}

      {data?.available && <div style={{marginTop:12}}>
        <div className="notice">
          {data.complete && data.profilesAligned ? <CircleCheck size={16}/> : <CircleX size={16}/>} 
          <span>{data.complete && data.profilesAligned
            ? `已检查 ${data.readyCount}/${data.totalCount} 个定稿镜头，主要媒体规格一致。`
            : `已检查 ${data.readyCount}/${data.totalCount} 个镜头，进入拼接前仍需补齐或统一规格。`}</span>
        </div>
        <div className="shot-table" style={{marginTop:10}}>
          {(data.shots || []).map(shot => <div key={shot.shotId}>
            <span>{String(shot.index).padStart(2, "0")} · {shot.shotName}</span>
            <b>{shot.ready && shot.probe ? profileLabel(shot.probe) : "未就绪"}</b>
            <small>{shot.ready && shot.probe ? audioLabel(shot.probe) : shot.reason || "无法探测"}</small>
          </div>)}
        </div>
        {data.note && <div className="muted mini" style={{marginTop:10}}>{data.note}</div>}
      </div>}

      <details className="advanced" style={{marginTop:10}}>
        <summary>这个检查有什么用？</summary>
        <div className="advanced-body">
          <div className="muted mini"><strong>检查：</strong>时长、画面尺寸、视频编码、像素格式、FPS、是否有音频、音频编码、采样率和声道。</div>
          <div className="muted mini"><strong>不做：</strong>不会转码、不会补音轨、不会改变画幅、不会拼接视频。</div>
          <div className="muted mini"><strong>工具：</strong>使用服务器系统中的 ffprobe。没有安装时，可以之后安装 FFmpeg/ffprobe，或通过 <code>FFPROBE_PATH</code> 指定可执行文件。</div>
          <div className="muted mini"><strong>下一步：</strong>如果要生成项目成片，下面的装配层会对本机归档的定稿视频做统一转码后，再按 Shot 顺序、转场、声音和字幕设置完成项目成片。</div>
        </div>
      </details>
    </section>
    <ProjectTransitionSettings projectId={projectId}/>
    <ProjectSubtitleSettings projectId={projectId}/>
    <ProjectFinalAssembly projectId={projectId}/>
  </>;
}

function profileLabel(probe: Probe) {
  const fps = probe.frameRate === null ? "?fps" : `${trim(probe.frameRate)}fps`;
  const duration = probe.duration === null ? "" : ` · ${trim(probe.duration)}s`;
  return `${probe.width}×${probe.height} · ${probe.videoCodec || "codec?"} · ${fps}${duration}`;
}

function audioLabel(probe: Probe) {
  const source = probe.source === "archive" ? "本机归档" : "云端 URL";
  if (!probe.hasAudio) return `${source} · 无音轨`;
  const rate = probe.audioSampleRate ? ` · ${probe.audioSampleRate}Hz` : "";
  const channels = probe.audioChannels ? ` · ${probe.audioChannels}ch` : "";
  return `${source} · ${probe.audioCodec || "audio"}${rate}${channels}`;
}

function trim(value: number) {
  return Number(value.toFixed(2));
}
