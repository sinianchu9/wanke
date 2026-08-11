"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Film, Music2, Save, Trash2 } from "lucide-react";

type Assembly = {
  id: string;
  projectId: string;
  fileName: string;
  settings: Record<string, any>;
  sources: Array<Record<string, any>>;
  createdAt: string;
};

type AudioAsset = { id: string; name: string; sourceUrl: string; mediaType: string };
type AudioSettings = {
  projectId: string;
  bgmAssetId: string | null;
  targetLufs: number;
  originalGainDb: number;
  bgmGainDb: number;
};

const DEFAULT_AUDIO: AudioSettings = { projectId: "", bgmAssetId: null, targetLufs: -16, originalGainDb: 0, bgmGainDb: -12 };

export default function ProjectFinalAssembly({ projectId }: { projectId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [audioAssets, setAudioAssets] = useState<AudioAsset[]>([]);
  const [audio, setAudio] = useState<AudioSettings>({ ...DEFAULT_AUDIO, projectId });
  const [busy, setBusy] = useState(false);
  const [savingAudio, setSavingAudio] = useState(false);
  const [error, setError] = useState("");
  const [audioNotice, setAudioNotice] = useState("");

  const selectedBgm = useMemo(() => audioAssets.find(asset => asset.id === audio.bgmAssetId) || null, [audioAssets, audio.bgmAssetId]);

  const load = useCallback(async () => {
    const [assemblyResponse, audioResponse] = await Promise.all([
      fetch(`/api/projects/assembly?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
      fetch(`/api/projects/audio?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
    ]);
    const [assemblyBody, audioBody] = await Promise.all([assemblyResponse.json(), audioResponse.json()]);
    if (!assemblyResponse.ok) throw new Error(assemblyBody.error || "读取成片记录失败");
    if (!audioResponse.ok) throw new Error(audioBody.error || "读取项目音频设置失败");
    setAvailable(assemblyBody.available === true);
    setAssemblies(assemblyBody.assemblies || []);
    setAudioAssets(audioBody.audioAssets || []);
    setAudio({ ...DEFAULT_AUDIO, ...(audioBody.settings || {}), projectId });
  }, [projectId]);

  useEffect(() => {
    setError(""); setAudioNotice(""); setAssemblies([]); setAvailable(null);
    setAudio({ ...DEFAULT_AUDIO, projectId });
    load().catch(error => setError(error instanceof Error ? error.message : String(error)));
  }, [load, projectId]);

  async function saveAudio() {
    setSavingAudio(true); setError(""); setAudioNotice("");
    try {
      const response = await fetch("/api/projects/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(audio),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存音频设置失败");
      setAudio({ ...DEFAULT_AUDIO, ...body.settings, projectId });
      setAudioNotice("项目音频设置已保存；下一次生成成片时生效。历史成片不会被改写。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSavingAudio(false); }
  }

  async function assemble() {
    setBusy(true); setError(""); setAudioNotice("");
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
      <div className="panel-title"><Film size={17}/><div><h3>生成项目成片</h3><p>统一 Shot 画面与音频规格，应用项目 BGM / 响度设置后，按当前 Shot 顺序生成一个本机 MP4。</p></div></div>
      <button className="primary" disabled={busy || available !== true} onClick={assemble}><Film size={15}/>{busy ? "正在统一并生成…" : "生成成片"}</button>
    </div>

    {available === false && <div className="error-banner warning" style={{marginTop:10}}>服务器缺少 ffmpeg 或 ffprobe。安装 FFmpeg，或分别配置 <code>FFMPEG_PATH</code> / <code>FFPROBE_PATH</code> 后即可使用；其他视频功能不受影响。</div>}
    {available === null && !error && <div className="muted mini" style={{marginTop:10}}>正在检查本机 FFmpeg / ffprobe 能力…</div>}
    {error && <div className="error-banner" style={{marginTop:10}}>{error}</div>}

    <div className="panel" style={{marginTop:14}}>
      <div className="panel-title"><Music2 size={17}/><div><h3>项目声音</h3><p>保留镜头原声，并在最终成片阶段统一响度；可从素材库选择一条音乐作为全片 BGM。</p></div></div>
      <div className="form-grid two" style={{marginTop:12}}>
        <div className="field">
          <span className="field-label">背景音乐<small>可选</small></span>
          <select value={audio.bgmAssetId || ""} onChange={event => setAudio(current => ({ ...current, bgmAssetId: event.target.value || null }))}>
            <option value="">不使用 BGM</option>
            {audioAssets.map(asset => <option value={asset.id} key={asset.id}>{asset.name}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">成片目标响度<small>LUFS</small></span>
          <select value={audio.targetLufs} onChange={event => setAudio(current => ({ ...current, targetLufs: Number(event.target.value) }))}>
            <option value={-14}>-14 LUFS · 偏响 / 社媒</option>
            <option value={-16}>-16 LUFS · 通用推荐</option>
            <option value={-18}>-18 LUFS · 对白更舒适</option>
            <option value={-20}>-20 LUFS · 偏保守</option>
          </select>
        </div>
        <div className="field">
          <span className="field-label">镜头原声增益<small>{audio.originalGainDb} dB</small></span>
          <input type="range" min={-12} max={6} step={1} value={audio.originalGainDb} onChange={event => setAudio(current => ({ ...current, originalGainDb: Number(event.target.value) }))}/>
        </div>
        <div className="field">
          <span className="field-label">BGM 相对增益<small>{audio.bgmGainDb} dB</small></span>
          <input type="range" min={-30} max={0} step={1} value={audio.bgmGainDb} disabled={!audio.bgmAssetId} onChange={event => setAudio(current => ({ ...current, bgmGainDb: Number(event.target.value) }))}/>
        </div>
      </div>
      {selectedBgm && <div style={{marginTop:10}}><audio src={selectedBgm.sourceUrl} controls preload="metadata" style={{width:"100%"}}/></div>}
      {!audioAssets.length && <div className="muted mini" style={{marginTop:10}}>素材库还没有音频。可以先在“素材库”上传或添加公网音频；不选 BGM 也会正常做原声响度统一。</div>}
      <div className="inline-actions" style={{marginTop:10}}><button className="secondary" disabled={savingAudio} onClick={saveAudio}><Save size={15}/>{savingAudio ? "保存中…" : "保存声音设置"}</button></div>
      {audioNotice && <div className="notice" style={{marginTop:10}}>{audioNotice}</div>}
    </div>

    <div className="muted mini" style={{marginTop:10}}><strong>提交前要求：</strong>所有 Shot 都已选择采用版本，并且每条采用视频都已经在任务中心“保存到本机”。镜头视频不会在成片时依赖可能过期的云端 URL；若使用 BGM，系统会先把所选音频下载到本次临时目录再混音。</div>

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
                <span>{audioLabel(assembly.settings)}</span>
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
        <div className="muted mini"><strong>镜头音频：</strong>先统一 AAC / 48kHz / 双声道；无音轨镜头补静音、短音轨补静音到画面结束，再按项目目标 LUFS 做最终响度处理。</div>
        <div className="muted mini"><strong>BGM：</strong>从素材库选择一条音频；成片时临时下载、循环覆盖全片，首尾各淡入淡出约 1 秒，再按设置的相对增益与原声混合。</div>
        <div className="muted mini"><strong>历史可追溯：</strong>每次成片都记录当时使用的目标响度、原声增益、BGM 增益和 BGM 名称；之后改设置不会修改旧成片。</div>
        <div className="muted mini"><strong>边界：</strong>当前仍是单轨顺序成片；这一阶段不做自动对白 ducking、多轨关键帧或分镜级音乐剪辑。</div>
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

function audioLabel(settings: Record<string, any>) {
  const mix = settings.audioMix || {};
  const target = mix.targetLufs ?? -16;
  const bgm = mix.bgm?.name ? ` · BGM：${mix.bgm.name} ${mix.bgmGainDb ?? -12}dB` : " · 无 BGM";
  return `目标 ${target} LUFS · 原声 ${mix.originalGainDb ?? 0}dB${bgm}`;
}
