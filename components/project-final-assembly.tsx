"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Film, Trash2 } from "lucide-react";

type Assembly = {
  id: string;
  projectId: string;
  fileName: string;
  settings: Record<string, any>;
  sources: Array<Record<string, any>>;
  createdAt: string;
};

export default function ProjectFinalAssembly({ projectId }: { projectId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/assembly?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "读取成片记录失败");
    setAvailable(body.available === true);
    setAssemblies(body.assemblies || []);
  }, [projectId]);

  useEffect(() => {
    setError(""); setAssemblies([]); setAvailable(null);
    load().catch(error => setError(error instanceof Error ? error.message : String(error)));
  }, [load]);

  async function assemble() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/projects/assembly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "生成成片失败");
      setAssemblies(body.assemblies || []);
      setAvailable(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function remove(assembly: Assembly) {
    if (!confirm("删除这个本机成片文件和记录？原始 Shot、任务和定稿视频不会被删除。")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/assembly?projectId=${encodeURIComponent(projectId)}&assemblyId=${encodeURIComponent(assembly.id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "删除成片失败");
      setAssemblies(body.assemblies || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <section className="panel" style={{marginBottom:18}}>
    <div className="panel-head">
      <div className="panel-title"><Film size={17}/><div><h3>生成项目成片</h3><p>把每个 Shot 的采用视频统一规格后，按当前 Shot 顺序生成一个本机 MP4。</p></div></div>
      <button className="primary" disabled={busy || available !== true} onClick={assemble}><Film size={15}/>{busy ? "正在统一并生成…" : "生成成片"}</button>
    </div>

    {available === false && <div className="error-banner warning" style={{marginTop:10}}>服务器缺少 ffmpeg 或 ffprobe。安装 FFmpeg，或分别配置 <code>FFMPEG_PATH</code> / <code>FFPROBE_PATH</code> 后即可使用；其他视频功能不受影响。</div>}
    {available === null && !error && <div className="muted mini" style={{marginTop:10}}>正在检查本机 FFmpeg / ffprobe 能力…</div>}
    {error && <div className="error-banner" style={{marginTop:10}}>{error}</div>}

    <div className="muted mini" style={{marginTop:10}}><strong>提交前要求：</strong>所有 Shot 都已选择采用版本，并且每条采用视频都已经在任务中心“保存到本机”。系统不会在成片时依赖可能过期的云端 URL。</div>

    {assemblies.length > 0 && <div style={{marginTop:14}}>
      <div className="subhead"><h3>已生成成片</h3><span>显示最近 {assemblies.length} 条记录</span></div>
      <div className="result-grid">
        {assemblies.map(assembly => {
          const url = `/api/archive/${encodeURIComponent(assembly.fileName)}`;
          return <article className="result-card" key={assembly.id}>
            <video src={url} controls preload="metadata"/>
            <div className="result-info">
              <div>
                <strong>{new Date(assembly.createdAt).toLocaleString()}</strong>
                <span>{settingLabel(assembly.settings)}</span>
                <span>{assembly.sources.length} 个 Shot · 本机成片</span>
              </div>
              <div className="result-actions">
                <a className="icon-button" href={url} target="_blank" rel="noreferrer" title="打开/保存成片"><Download size={15}/></a>
                <button className="icon-button danger" disabled={busy} onClick={() => remove(assembly)} title="删除这个成片文件"><Trash2 size={15}/></button>
              </div>
            </div>
          </article>;
        })}
      </div>
    </div>}

    <details className="advanced" style={{marginTop:10}}>
      <summary>成片规则是什么？</summary>
      <div className="advanced-body">
        <div className="muted mini"><strong>画面：</strong>目标尺寸和 FPS 取第一个定稿 Shot；其他镜头保持比例缩放，空余区域补黑边，不拉伸主体。</div>
        <div className="muted mini"><strong>统一格式：</strong>H.264 / yuv420p；音频统一 AAC / 48kHz / 双声道。无音轨的镜头补静音，短音轨自动补静音到视频结束。</div>
        <div className="muted mini"><strong>顺序：</strong>严格使用当前 Project 的 Shot 顺序；只消费明确“采用”的版本，不自动猜候选。</div>
        <div className="muted mini"><strong>边界：</strong>这是稳定的单轨顺序成片，不是多轨 NLE。当前没有转场、字幕轨、BGM 轨或关键帧编辑。</div>
        <div className="muted mini"><strong>限制：</strong>单次最多 60 个 Shot、定稿总时长最多 15 分钟；长项目应先拆分章节。</div>
      </div>
    </details>
  </section>;
}

function settingLabel(settings: Record<string, any>) {
  const fps = settings.fps ? Number(settings.fps).toFixed(2).replace(/\.00$/, "") : "?";
  const durationValue = settings.finalDuration ?? settings.expectedDuration;
  const duration = durationValue ? Number(durationValue).toFixed(1) : "?";
  return `${settings.width || "?"}×${settings.height || "?"} · ${fps}fps · H.264/AAC · 约 ${duration}s`;
}
