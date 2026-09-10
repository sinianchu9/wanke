"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileUp, Image as ImageIcon, Link2, Music, Trash2, Video } from "lucide-react";
import type { StoredAsset } from "@/lib/types";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB

export default function AssetLibrary({
  assets,
  onChanged,
  extendedUploadAvailable,
}: {
  assets: StoredAsset[];
  onChanged: () => Promise<void> | void;
  extendedUploadAvailable?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [mediaType, setMediaType] = useState("video");
  const [filter, setFilter] = useState("all");

  const shown = useMemo(
    () => (filter === "all" ? assets : assets.filter((a) => a.mediaType === filter)),
    [assets, filter]
  );

  async function upload(file: File) {
    if (file.size <= 0) {
      setError("所选文件为空，请选择有效的文件。");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`文件过大（${(file.size / (1024 * 1024)).toFixed(1)}MB），单个素材上传上限为 100MB，请压缩后再试。`);
      return;
    }

    setUploading(true);
    setError("");
    setSuccessNotice("");
    setProgress(0);

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append("file", file);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.min(99, Math.round((e.loaded / e.total) * 100));
            setProgress(percent);
          }
        };

        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const res = JSON.parse(xhr.responseText);
              setProgress(100);
              setSuccessNotice(res.message || `素材「${file.name}」已成功上传到服务器。`);
              resolve();
            } catch {
              reject(new Error("服务器响应解析失败，请刷新后重试。"));
            }
          } else {
            let errorMsg = "上传失败，请稍后重试。";
            try {
              const res = JSON.parse(xhr.responseText);
              if (res.error) errorMsg = res.error;
            } catch {
              if (xhr.status === 413) errorMsg = "文件大小超出服务器限制（100MB）。";
            }
            reject(new Error(errorMsg));
          }
        };

        xhr.onerror = () => {
          reject(new Error("网络连接失败，无法连接到服务器，请检查网络后重试。"));
        };

        xhr.open("POST", "/api/assets/upload", true);
        xhr.send(formData);
      });

      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function registerUrl() {
    if (!url.trim()) return;
    setError("");
    setSuccessNotice("");
    setUploading(true);
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || url.split("/").pop() || "外部素材",
          sourceUrl: url.trim(),
          mediaType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "添加素材失败");
      setUrl("");
      setName("");
      setSuccessNotice(`公网素材「${data.asset?.name || name || "素材"}」已保存成功。`);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("确定从素材库移除这条素材？已上传的本地文件也会同步清理。")) return;
    setError("");
    setSuccessNotice("");
    try {
      const res = await fetch(`/api/assets?id=${encodeURIComponent(id)}&cloud=1`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "删除失败");
        return;
      }
      setSuccessNotice("素材已成功删除。");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="content-stack">
      <div className="hero-card compact">
        <div>
          <div className="eyebrow">ASSET LIBRARY</div>
          <h2>素材库</h2>
          <p>
            支持上传图片、视频、音频到当前服务器本地存储，也可直接保存公网素材直链。做基础 AI 视频时，本地图片亦可在“AI 视频”页面直接选取。
          </p>
        </div>

        <div className="upload-box" onClick={() => !uploading && inputRef.current?.click()}>
          <FileUp size={24} />
          <strong>{uploading ? `上传中 ${progress}%` : "上传素材到服务器"}</strong>
          <span>视频 / 图片 / 音频 / .txt / .doc（100MB 以内）</span>
          {uploading && (
            <div className="progress">
              <i style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          hidden
          type="file"
          accept="video/*,image/*,audio/*,.txt,.doc,.docx"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>

      {successNotice && (
        <div className="success-banner" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px", borderRadius: "8px", background: "rgba(34, 197, 94, 0.12)", color: "#16a34a", fontSize: "14px", border: "1px solid rgba(34, 197, 94, 0.25)" }}>
          <CheckCircle2 size={16} />
          <span>{successNotice}</span>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <div className="panel-title">
          <Link2 size={17} />
          <div>
            <h3>添加公网素材</h3>
            <p>已有可公网访问的图片或视频直链地址时直接保存，云端视频模型可直接读取。</p>
          </div>
        </div>
        <div className="register-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="素材名称（可选）"
          />
          <select value={mediaType} onChange={(e) => setMediaType(e.target.value)}>
            <option value="video">视频</option>
            <option value="image">图片</option>
            <option value="audio">音频</option>
          </select>
          <input
            className="grow"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
          />
          <button className="primary" disabled={uploading || !url.trim()} onClick={registerUrl}>
            添加
          </button>
        </div>
      </div>

      <div className="asset-toolbar">
        <div className="chip-row">
          {[
            ["all", "全部"],
            ["video", "视频"],
            ["image", "图片"],
            ["audio", "音频"],
            ["document", "脚本"],
          ].map(([id, label]) => (
            <button
              className={`chip ${filter === id ? "selected" : ""}`}
              key={id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted mini">共 {shown.length} 项</span>
      </div>

      <div className="asset-grid">
        {shown.map((a) => (
          <article className="asset-card" key={a.id}>
            <div className={`asset-preview ${a.mediaType}`}>
              {a.mediaType === "video" && (
                <video src={a.sourceUrl} muted preload="metadata" />
              )}
              {a.mediaType === "image" && <img src={a.sourceUrl} alt="" />}
              {a.mediaType === "audio" && <Music size={30} />}
              {a.mediaType === "document" && <FileUp size={30} />}
              {!["video", "image", "audio", "document"].includes(a.mediaType) && (
                <Video size={30} />
              )}
            </div>
            <div className="asset-meta">
              <strong title={a.name}>{a.name}</strong>
              <span>
                {friendlyType(a.mediaType)} · {new Date(a.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="media-id">
              {a.provider?.storage === "local-server" ? "本地服务器存储" : a.providerMediaId ? "云端扩展工作流" : "公网直接引用"}
            </div>
            <div className="card-actions">
              <a className="secondary" href={a.sourceUrl} target="_blank" rel="noreferrer">
                打开
              </a>
              <button className="icon-button danger" onClick={() => remove(a.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
        {!shown.length && (
          <div className="empty-state">
            <ImageIcon size={30} />
            <strong>还没有素材</strong>
            <span>可以点击上方直接上传本地素材，或添加公网素材直链。</span>
          </div>
        )}
      </div>
    </div>
  );
}

function friendlyType(value: string) {
  return value === "video"
    ? "视频"
    : value === "image"
    ? "图片"
    : value === "audio"
    ? "音频"
    : value === "document"
    ? "脚本"
    : "素材";
}
