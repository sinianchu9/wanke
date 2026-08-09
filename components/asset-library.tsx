"use client";

import OSS from "ali-oss";
import { useMemo, useRef, useState } from "react";
import { Clipboard, FileUp, Image as ImageIcon, Link2, Music, Trash2, Video } from "lucide-react";
import type { StoredAsset } from "@/lib/types";

export default function AssetLibrary({ assets, onChanged }: { assets: StoredAsset[]; onChanged: () => Promise<void> | void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [mediaType, setMediaType] = useState("video");
  const [filter, setFilter] = useState("all");

  const shown = useMemo(() => filter === "all" ? assets : assets.filter(a => a.mediaType === filter), [assets, filter]);

  async function upload(file: File) {
    setUploading(true); setError(""); setProgress(0);
    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const isDoc = ["txt", "doc"].includes(ext);
      const credRes = await fetch("/api/assets/upload-credential", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileExt: ext, ...(isDoc ? { fileType: "StoryboardInput" } : {}) }),
      });
      const cred = await credRes.json();
      if (!credRes.ok) throw new Error(cred.error || "获取上传凭证失败");
      const address = decodeJson(cred.uploadAddress);
      const auth = decodeJson(cred.uploadAuth);
      if (!address.Bucket || !address.FileName || !address.Endpoint || !auth.AccessKeyId || !auth.AccessKeySecret || !auth.SecurityToken) {
        throw new Error("Yike 返回的 OSS 临时凭证结构不完整");
      }
      const client = new OSS({
        endpoint: address.Endpoint,
        bucket: address.Bucket,
        accessKeyId: auth.AccessKeyId,
        accessKeySecret: auth.AccessKeySecret,
        stsToken: auth.SecurityToken,
        secure: true,
      });
      await client.multipartUpload(address.FileName, file, {
        parallel: 4,
        partSize: Math.max(1024 * 1024, Math.min(8 * 1024 * 1024, Math.ceil(file.size / 100))),
        progress: async (p: number) => { setProgress(Math.round(p * 100)); },
      });
      const type = isDoc ? "document" : inferType(file);
      const registerRes = await fetch("/api/assets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, sourceUrl: cred.fileURL, mediaType: type, trackOnly: isDoc }),
      });
      const registered = await registerRes.json();
      if (!registerRes.ok) throw new Error(registered.error || "注册素材失败");
      await onChanged();
      setProgress(100);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function registerUrl() {
    if (!url.trim()) return;
    setError(""); setUploading(true);
    try {
      const res = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name || url.split("/").pop() || "外部素材", sourceUrl: url, mediaType }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "注册失败");
      setUrl(""); setName(""); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); }
  }

  async function remove(id: string) {
    if (!confirm("删除 Wanke 本地素材记录？")) return;
    const cloud = confirm(`是否同时从万镜一刻媒资库做逻辑删除？

确定：本地 + Core/Studio 云端登记一起清理（不强制删除底层物理文件）
取消：只删除 Wanke 本地记录`);
    const res = await fetch(`/api/assets?id=${encodeURIComponent(id)}${cloud?"&cloud=1":""}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "删除失败"); return; }
    await onChanged();
  }

  return <div className="content-stack">
    <div className="hero-card compact">
      <div><div className="eyebrow">ASSET PIPELINE</div><h2>素材库</h2><p>文件直接从浏览器上传到阿里 OSS，Wanke 服务端不承载大文件。视频、图片、音频注册为 MediaId；脚本文档保留 OSS URL 供故事板直接使用。</p></div>
      <div className="upload-box" onClick={() => inputRef.current?.click()}>
        <FileUp size={24}/><strong>{uploading ? `上传中 ${progress}%` : "上传本地素材"}</strong><span>视频 / 图片 / 音频 / .txt / .doc</span>
        {uploading && <div className="progress"><i style={{width:`${progress}%`}}/></div>}
      </div>
      <input ref={inputRef} hidden type="file" accept="video/*,image/*,audio/*,.txt,.doc" onChange={e => e.target.files?.[0] && upload(e.target.files[0])}/>
    </div>

    {error && <div className="error-banner">{error}</div>}

    <div className="panel">
      <div className="panel-title"><Link2 size={17}/><div><h3>注册公网素材</h3><p>已有可公网访问的 URL 时无需重新上传。</p></div></div>
      <div className="register-row">
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="素材名称（可选）"/>
        <select value={mediaType} onChange={e=>setMediaType(e.target.value)}><option value="video">视频</option><option value="image">图片</option><option value="audio">音频</option></select>
        <input className="grow" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..."/>
        <button className="primary" disabled={uploading || !url} onClick={registerUrl}>注册</button>
      </div>
    </div>

    <div className="asset-toolbar">
      <div className="chip-row">{[["all","全部"],["video","视频"],["image","图片"],["audio","音频"],["document","脚本"]].map(([id,label])=><button className={`chip ${filter===id?"selected":""}`} key={id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
      <span className="muted mini">共 {shown.length} 项</span>
    </div>

    <div className="asset-grid">
      {shown.map(a => <article className="asset-card" key={a.id}>
        <div className={`asset-preview ${a.mediaType}`}>
          {a.mediaType === "video" && <video src={a.sourceUrl} muted preload="metadata"/>}
          {a.mediaType === "image" && <img src={a.sourceUrl} alt=""/>}
          {a.mediaType === "audio" && <Music size={30}/>} {a.mediaType === "document" && <FileUp size={30}/>} 
          {!['video','image','audio','document'].includes(a.mediaType) && <Video size={30}/>} 
        </div>
        <div className="asset-meta"><strong title={a.name}>{a.name}</strong><span>{a.mediaType} · {new Date(a.createdAt).toLocaleString()}</span></div>
        {a.providerMediaId ? <code className="media-id" onClick={()=>navigator.clipboard.writeText(a.providerMediaId!)} title="点击复制 MediaId">{a.providerMediaId}<Clipboard size={12}/></code> : <code className="media-id">URL-only</code>}
        <div className="card-actions"><a className="secondary" href={a.sourceUrl} target="_blank" rel="noreferrer">打开</a><button className="icon-button danger" onClick={()=>remove(a.id)}><Trash2 size={15}/></button></div>
      </article>)}
      {!shown.length && <div className="empty-state"><ImageIcon size={30}/><strong>还没有素材</strong><span>上传一个视频、图片或脚本开始。</span></div>}
    </div>
  </div>;
}

function decodeJson(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
function inferType(file: File) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return "video";
}
