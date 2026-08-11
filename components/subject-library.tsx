"use client";

import { useMemo, useState } from "react";
import { Box, Image as ImageIcon, Pencil, Plus, Save, Trash2, UserRound } from "lucide-react";
import type { StoredAsset } from "@/lib/types";

type SubjectType = "person" | "product";
type SubjectAsset = StoredAsset;
export type PublicSubjectCard = {
  id: string;
  name: string;
  subjectType: SubjectType;
  description: string;
  usageNotes: string;
  primaryAssetId: string;
  assetIds: string[];
  assets: SubjectAsset[];
  primaryAsset: SubjectAsset | null;
  missingAssetCount: number;
  createdAt: string;
  updatedAt: string;
};

export default function SubjectLibrary({ subjects, assets, onChanged }: {
  subjects: PublicSubjectCard[];
  assets: StoredAsset[];
  onChanged: () => Promise<void> | void;
}) {
  const images = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subjectType, setSubjectType] = useState<SubjectType>("person");
  const [description, setDescription] = useState("");
  const [usageNotes, setUsageNotes] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [primaryAssetId, setPrimaryAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setEditingId(null);
    setName("");
    setSubjectType("person");
    setDescription("");
    setUsageNotes("");
    setAssetIds([]);
    setPrimaryAssetId("");
    setError("");
  }

  function edit(card: PublicSubjectCard) {
    setEditingId(card.id);
    setName(card.name);
    setSubjectType(card.subjectType);
    setDescription(card.description || "");
    setUsageNotes(card.usageNotes || "");
    setAssetIds(card.assetIds.filter(id => images.some(asset => asset.id === id)));
    setPrimaryAssetId(images.some(asset => asset.id === card.primaryAssetId) ? card.primaryAssetId : card.assetIds[0] || "");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleAsset(id: string) {
    setAssetIds(current => {
      if (current.includes(id)) {
        const next = current.filter(item => item !== id);
        if (primaryAssetId === id) setPrimaryAssetId(next[0] || "");
        return next;
      }
      if (current.length >= 5) return current;
      const next = [...current, id];
      if (!primaryAssetId) setPrimaryAssetId(id);
      return next;
    });
  }

  async function save() {
    if (!name.trim() || !assetIds.length || !primaryAssetId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/subjects", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, name: name.trim(), subjectType, description, usageNotes, primaryAssetId, assetIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存主体卡失败");
      reset();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function remove(card: PublicSubjectCard) {
    if (!confirm(`删除主体卡“${card.name}”？只删除身份卡，不会删除素材库中的图片。`)) return;
    const response = await fetch(`/api/subjects?id=${encodeURIComponent(card.id)}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "删除主体卡失败"); return; }
    if (editingId === card.id) reset();
    await onChanged();
  }

  const selectedAssets = assetIds.map(id => images.find(asset => asset.id === id)).filter(Boolean) as StoredAsset[];

  return <div className="content-stack">
    <div className="hero-card compact">
      <div>
        <div className="eyebrow">REUSABLE SUBJECT IDENTITY</div>
        <h2>主体库</h2>
        <p>把同一个人物或产品的参考图片固定成可复用身份。主体卡只负责“是谁 / 是什么”，不会替你决定视频怎么拍、提示词写什么或使用哪个 Provider。</p>
      </div>
      <div className="upload-box" style={{cursor:"default"}}>
        {subjectType === "person" ? <UserRound size={26}/> : <Box size={26}/>}<strong>人物 / 产品身份</strong><span>1 张主参考图 + 最多 4 张辅助参考图</span>
      </div>
    </div>

    {error && <div className="error-banner">{error}</div>}

    <section className="panel">
      <div className="panel-title"><Plus size={17}/><div><h3>{editingId ? "编辑主体卡" : "新建主体卡"}</h3><p>先把清晰参考图片加入素材库，再在这里组织身份。当前只接受图片，不把视频混入身份卡。</p></div></div>
      <div className="form-stack">
        <div className="form-grid two">
          <div className="field"><span className="field-label">主体名称</span><input value={name} onChange={e=>setName(e.target.value)} placeholder={subjectType === "person" ? "例如：品牌女主角 A" : "例如：黑色智能手环"}/></div>
          <div className="field"><span className="field-label">主体类型</span><select value={subjectType} onChange={e=>setSubjectType(e.target.value as SubjectType)}><option value="person">人物</option><option value="product">产品</option></select></div>
        </div>
        <div className="form-grid two">
          <div className="field"><span className="field-label">身份描述<small>告诉自己这张卡代表什么，不直接发给模型</small></span><textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="例如：30 岁左右女性，短发，品牌系列视频固定主角。"/></div>
          <div className="field"><span className="field-label">使用说明<small>记录人工约束，不替代 Recipe</small></span><textarea value={usageNotes} onChange={e=>setUsageNotes(e.target.value)} placeholder="例如：优先使用正脸 + 侧脸；不要使用戴墨镜的旧图。"/></div>
        </div>

        <div className="field">
          <span className="field-label">参考图片<small>选择 1–5 张；同一主体，不要混入其他人物或其他型号产品</small></span>
          {images.length ? <div className="asset-chips">{images.map(asset=><button type="button" key={asset.id} className={assetIds.includes(asset.id)?"selected":""} onClick={()=>toggleAsset(asset.id)} disabled={!assetIds.includes(asset.id)&&assetIds.length>=5}>🖼️ {asset.name}</button>)}</div> : <div className="empty-inline">素材库里还没有图片。先到“素材库”添加公网图片，或配置扩展上传后上传图片。</div>}
        </div>

        {selectedAssets.length > 0 && <div className="field">
          <span className="field-label">主参考图<small>它代表这张主体卡的默认身份封面和第一参考</small></span>
          <select value={primaryAssetId} onChange={e=>setPrimaryAssetId(e.target.value)}>{selectedAssets.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
        </div>}

        <details className="advanced">
          <summary>主体卡怎么用？</summary>
          <div className="advanced-body">
            <div className="muted mini"><strong>人物演示：</strong>素材库先放“正脸、侧脸、全身” → 新建人物卡“品牌女主角 A” → AI 视频选择“保持人物 / 产品一致” → 勾选这张主体卡 → 再选择“人物一致”Recipe。</div>
            <div className="muted mini"><strong>产品演示：</strong>素材库先放“正面、侧面、佩戴图” → 新建产品卡“黑色智能手环” → AI 视频多参考模式引用主体卡 → 根据创作目标选择“产品广告”Recipe。</div>
            <div className="muted mini"><strong>边界：</strong>主体卡是参考素材集合，不是 Recipe。人物卡不会自动强制“人物一致”，产品卡也不会自动强制“产品广告”；这样身份和创作策略保持独立。</div>
          </div>
        </details>

        <div className="stage-run">
          <button className="secondary" disabled={busy} onClick={reset}>{editingId ? "取消编辑" : "清空"}</button>
          <button className="primary" disabled={busy || !name.trim() || !assetIds.length || !primaryAssetId} onClick={save}><Save size={15}/>{busy?"保存中…":editingId?"保存修改":"创建主体卡"}</button>
        </div>
      </div>
    </section>

    <section className="panel">
      <div className="panel-title"><ImageIcon size={17}/><div><h3>已有主体</h3><p>主体卡删除不会删除原素材；原素材删除时会自动同步清理主体卡引用。</p></div></div>
      <div className="asset-grid" style={{marginTop:14}}>
        {subjects.map(card=><article className="asset-card" key={card.id}>
          <div className="asset-preview">{card.primaryAsset?.sourceUrl?<img src={card.primaryAsset.sourceUrl} alt={card.name}/>:card.subjectType==="person"?<UserRound size={32}/>:<Box size={32}/>}</div>
          <div className="asset-meta"><strong>{card.name}</strong><span>{card.subjectType==="person"?"人物":"产品"} · {card.assets.length} 张参考图</span></div>
          <div className="media-id">{card.description || (card.subjectType==="person"?"可复用人物身份":"可复用产品身份")}</div>
          {card.usageNotes&&<div className="muted mini" style={{padding:"8px 12px 0"}}>使用：{card.usageNotes}</div>}
          {card.missingAssetCount>0&&<div className="mini error-text" style={{padding:"8px 12px 0"}}>有 {card.missingAssetCount} 张旧素材已不存在</div>}
          <div className="card-actions"><button className="secondary" onClick={()=>edit(card)}><Pencil size={14}/>编辑</button><button className="icon-button danger" onClick={()=>remove(card)}><Trash2 size={15}/></button></div>
        </article>)}
        {!subjects.length&&<div className="empty-state"><UserRound size={30}/><strong>还没有主体卡</strong><span>先把同一个人物或产品的 1–5 张图片组织成身份。</span></div>}
      </div>
    </section>
  </div>;
}
