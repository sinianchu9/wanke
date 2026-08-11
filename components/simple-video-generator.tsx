"use client";

import { useMemo, useState } from "react";
import { HelpCircle, Image as ImageIcon, Images, Send, Sparkles, WandSparkles, Waypoints } from "lucide-react";
import type { StoredAsset } from "@/lib/types";
import { VIDEO_RECIPES, getVideoRecipe, recipeSupportsMode, type VideoRecipeId } from "@/lib/video/recipes";

type Mode = "text_to_video" | "image_to_video" | "first_last_frame" | "reference_to_video";
type LocalInput = { ref: string; name: string; size: number };
type Props = {
  assets: StoredAsset[];
  onSubmit: (kind: string, input: Record<string, unknown>, title?: string, parentJobId?: string) => Promise<any>;
  onSubmitBatch: (input: Record<string, unknown>, count: number, title?: string) => Promise<any>;
  submitting: boolean;
  directAvailable: boolean;
};

const modeOptions: { id: Mode; label: string; desc: string; icon: any }[] = [
  { id: "text_to_video", label: "描述生成", desc: "只说你想看到什么，系统直接生成视频", icon: Sparkles },
  { id: "image_to_video", label: "让图片动起来", desc: "选择一张图片，自动保持主体并生成动作", icon: ImageIcon },
  { id: "first_last_frame", label: "首尾画面过渡", desc: "给开始和结束画面，自动生成中间过程", icon: Waypoints },
  { id: "reference_to_video", label: "保持人物 / 产品一致", desc: "给人物、产品或场景参考，自动保持一致性", icon: Images },
];

export default function SimpleVideoGenerator({ assets, onSubmit, onSubmitBatch, submitting, directAvailable }: Props) {
  const [mode, setMode] = useState<Mode>("text_to_video");
  const [recipeId, setRecipeId] = useState<VideoRecipeId>("general");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<"720P" | "1080P">("1080P");
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [versionCount, setVersionCount] = useState(1);
  const [firstAssetId, setFirstAssetId] = useState("");
  const [lastAssetId, setLastAssetId] = useState("");
  const [firstUrl, setFirstUrl] = useState("");
  const [lastUrl, setLastUrl] = useState("");
  const [firstLocal, setFirstLocal] = useState<LocalInput | null>(null);
  const [lastLocal, setLastLocal] = useState<LocalInput | null>(null);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [referenceUrls, setReferenceUrls] = useState("");
  const [referenceLocal, setReferenceLocal] = useState<LocalInput[]>([]);
  const [localUploading, setLocalUploading] = useState(false);
  const [localError, setLocalError] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceNote, setEnhanceNote] = useState("");
  const [enhanceError, setEnhanceError] = useState("");

  const recipe = useMemo(() => getVideoRecipe(recipeId), [recipeId]);
  const imageAssets = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const referenceAssets = useMemo(() => assets.filter(asset => asset.mediaType === "image" || asset.mediaType === "video"), [assets]);
  const manualReferenceCount = referenceUrls.split(/\n/).map(value => value.trim()).filter(Boolean).length;
  const referenceCount = referenceLocal.length + referenceIds.length + manualReferenceCount;

  function storedMedia(assetId: string) {
    const asset = assets.find(item => item.id === assetId);
    if (!asset) return null;
    return { type: asset.mediaType === "video" ? "video" : "image", url: asset.sourceUrl, mediaId: asset.providerMediaId || "" };
  }

  function manualMedia(url: string, forceImage = false) {
    const clean = url.trim();
    if (!clean) return null;
    let type: "image" | "video" = "image";
    if (!forceImage) {
      try {
        const pathname = new URL(clean).pathname.toLowerCase();
        if (pathname.endsWith(".mp4") || pathname.endsWith(".mov")) type = "video";
      } catch { /* schema will return a friendly URL error */ }
    }
    return { type, url: clean, mediaId: "" };
  }

  function localMedia(input: LocalInput | null) {
    return input ? { type: "image" as const, url: input.ref, mediaId: "" } : null;
  }

  function buildMedias() {
    if (mode === "text_to_video") return [];
    if (mode === "image_to_video") {
      const media = localMedia(firstLocal) || storedMedia(firstAssetId) || manualMedia(firstUrl, true);
      return media ? [media] : [];
    }
    if (mode === "first_last_frame") {
      const first = localMedia(firstLocal) || storedMedia(firstAssetId) || manualMedia(firstUrl, true);
      const last = localMedia(lastLocal) || storedMedia(lastAssetId) || manualMedia(lastUrl, true);
      return [first, last].filter(Boolean);
    }
    const local = referenceLocal.map(localMedia).filter(Boolean);
    const picked = referenceIds.map(storedMedia).filter(Boolean);
    const manual = referenceUrls.split(/\n/).map(value => manualMedia(value)).filter(Boolean);
    return [...local, ...picked, ...manual];
  }

  const medias = buildMedias();
  const hasVideoReference = mode === "reference_to_video" && medias.some((media: any) => media?.type === "video");
  const tooManyReferences = mode === "reference_to_video" && medias.length > 5;
  const durationOptions = hasVideoReference ? ["5", "10"] : ["5", "10", "15"];
  const effectiveDuration = hasVideoReference && duration > 10 ? 10 : duration;
  const ready = Boolean(prompt.trim()) && !localUploading && !tooManyReferences && (
    mode === "text_to_video" ||
    (mode === "image_to_video" && medias.length === 1) ||
    (mode === "first_last_frame" && medias.length === 2) ||
    (mode === "reference_to_video" && medias.length >= 1 && medias.length <= 5)
  );

  function changeMode(next: Mode) {
    if (referenceLocal.length) referenceLocal.forEach(item => discardLocalImage(item.ref));
    setMode(next); setReferenceIds([]); setReferenceUrls(""); setReferenceLocal([]); setLocalError(""); setEnhanceNote(""); setEnhanceError("");
    if (!recipeSupportsMode(recipeId, next)) setRecipeId("general");
  }

  function chooseRecipe(next: VideoRecipeId) {
    if (!recipeSupportsMode(next, mode)) return;
    const selected = getVideoRecipe(next);
    setRecipeId(next); setAspectRatio(selected.defaultAspectRatio); setDuration(selected.defaultDuration); setEnhanceNote(""); setEnhanceError("");
  }

  function toggleReference(id: string) {
    setReferenceIds(current => current.includes(id) ? current.filter(item => item !== id) : referenceCount >= 5 ? current : [...current, id]);
  }

  async function addReferenceFiles(files: FileList | null) {
    if (!files?.length || !directAvailable) return;
    const remaining = Math.max(0, 5 - referenceCount);
    if (!remaining) return;
    setLocalUploading(true); setLocalError("");
    try {
      const selected = Array.from(files).slice(0, remaining);
      const uploaded = [] as LocalInput[];
      for (const file of selected) uploaded.push(await uploadLocalImage(file));
      setReferenceLocal(current => [...current, ...uploaded]);
    } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)); }
    finally { setLocalUploading(false); }
  }

  function removeReferenceLocal(item: LocalInput) {
    setReferenceLocal(current => current.filter(x => x.ref !== item.ref));
    discardLocalImage(item.ref);
  }

  async function enhancePrompt() {
    if (!prompt.trim() || enhancing) return;
    setEnhancing(true); setEnhanceError(""); setEnhanceNote("");
    try {
      const response = await fetch("/api/video/prompt-enhance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), recipeId, jobType: mode, aspectRatio, duration: effectiveDuration, referenceCount: medias.length }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "提示词增强失败");
      setPrompt(body.prompt || prompt);
      setEnhanceNote(body.engine === "qwen-plus" ? "已使用百炼 Qwen 整理提示词。只修改文字表达，没有改素材、生成方式或视频引擎。" : body.note || "已按生成预设整理提示词。只修改文字表达。");
    } catch (error) { setEnhanceError(error instanceof Error ? error.message : String(error)); }
    finally { setEnhancing(false); }
  }

  function requestInput() {
    return { title, prompt: prompt.trim(), recipeId, jobType: mode, medias, aspectRatio, duration: effectiveDuration, resolution, model: "happyhorse-1.1", n: 1 };
  }

  async function run() {
    if (!ready) return;
    const input = requestInput();
    if (versionCount === 1) await onSubmit("video_generation", input, title || undefined);
    else await onSubmitBatch(input, versionCount, title || undefined);
  }

  return <div className="content-stack">
    <div className="hero-card"><div><div className="eyebrow">AUTO VIDEO GENERATION</div><h2>告诉我你要什么视频</h2><p>先选生成方式，再选创作预设。预设负责“怎么拍”，系统路由负责“用哪个 Provider / 模型执行”，两者互不混淆。</p></div></div>
    <section className="panel"><div className="form-stack">
      <div className="field"><span className="field-label">1. 你准备怎么生成？<small>这是素材边界：决定需要几张图、能不能用视频参考</small></span><div className="asset-chips">{modeOptions.map(item=>{const Icon=item.icon;return <button type="button" key={item.id} className={mode===item.id?"selected":""} onClick={()=>changeMode(item.id)} title={item.desc}><Icon size={15}/> {item.label}</button>})}</div><div className="muted mini">{modeOptions.find(item=>item.id===mode)?.desc}</div></div>
      <div className="field"><span className="field-label">2. 你更接近哪类视频？<small>生成预设只决定创作策略与默认参数，不负责切换百炼 / 万镜一刻</small></span><div className="asset-chips">{VIDEO_RECIPES.map(item=>{const supported=recipeSupportsMode(item.id,mode);return <button type="button" key={item.id} disabled={!supported} className={recipeId===item.id?"selected":""} onClick={()=>chooseRecipe(item.id)} title={supported?item.summary:`当前“${modeOptions.find(option=>option.id===mode)?.label}”不适用此预设`}>{item.label}</button>})}</div><div className="muted mini"><strong>{recipe.label}</strong>：{recipe.summary}</div><div className="muted mini">适合：{recipe.useWhen}</div><div className="muted mini">不适合：{recipe.notFor}</div></div>
      <div className="field"><span className="field-label">3. 你想看到什么？<small>先用大白话写；智能增强只整理提示词，不会改变素材和任务类型</small></span><textarea className="big-text" value={prompt} onChange={event=>{setPrompt(event.target.value);setEnhanceNote("");setEnhanceError("")}} placeholder="例如：一个穿黑色风衣的男人在东京雨夜街头向镜头走来，路面有霓虹倒影，镜头缓慢后退，电影感，人物动作自然。"/><div className="inline-actions"><button type="button" className="secondary" disabled={enhancing||!prompt.trim()} onClick={enhancePrompt}><WandSparkles size={15}/>{enhancing?"正在整理…":"智能增强提示词"}</button><span className="muted mini">有百炼 API Key + Workspace 时使用 Qwen；不可用时明确回退为本地预设整理。</span></div>{enhanceNote&&<div className="mini success-text">{enhanceNote}</div>}{enhanceError&&<div className="mini error-text">{enhanceError}</div>}</div>
      <details className="advanced"><summary><HelpCircle size={15}/> 生成预设与智能增强怎么用？</summary><div className="advanced-body"><div className="muted mini">① <strong>生成方式</strong>决定素材规则；② <strong>生成预设</strong>决定稳定的创作策略和默认画幅/时长；③ <strong>智能增强</strong>只是把你的文字整理得更适合视频模型；④ 最后由设置中的 <strong>自动 / 百炼 / 万镜一刻</strong>决定实际执行 Provider。</div><div className="field"><span className="field-label">当前预设演示</span><div className="muted mini">原始输入：{recipe.demoInput}</div><div className="muted mini">整理后的表达示例：{recipe.demoOutput}</div></div><div className="muted mini">边界规则：智能增强不会替你增加未提供的品牌、人物身份、型号或剧情；生成预设也不会绕过当前生成方式的素材限制。</div></div></details>

      {mode==="image_to_video"&&<ImagePicker label="选择要动起来的图片" assets={imageAssets} assetId={firstAssetId} setAssetId={setFirstAssetId} url={firstUrl} setUrl={setFirstUrl} local={firstLocal} setLocal={setFirstLocal} directAvailable={directAvailable}/>} 
      {mode==="first_last_frame"&&<div className="form-grid two"><ImagePicker label="开始画面" assets={imageAssets} assetId={firstAssetId} setAssetId={setFirstAssetId} url={firstUrl} setUrl={setFirstUrl} local={firstLocal} setLocal={setFirstLocal} directAvailable={directAvailable} compact/><ImagePicker label="结束画面" assets={imageAssets} assetId={lastAssetId} setAssetId={setLastAssetId} url={lastUrl} setUrl={setLastUrl} local={lastLocal} setLocal={setLastLocal} directAvailable={directAvailable} compact/></div>}
      {mode==="reference_to_video"&&<div className="field"><span className="field-label">选择参考素材<small>人物、产品、场景都可以；最多 5 个，系统自动判断图片或视频参考</small></span>{directAvailable&&<div><input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={localUploading||referenceCount>=5} onChange={event=>{addReferenceFiles(event.target.files);event.currentTarget.value=""}}/><div className="muted mini">{localUploading?"正在准备本地图片…":"可直接选择本地 JPG / PNG / WEBP，不需要先上传素材库"}</div></div>}{referenceLocal.length>0&&<div className="asset-chips">{referenceLocal.map(item=><button type="button" className="selected" key={item.ref} onClick={()=>removeReferenceLocal(item)}>🖼️ {item.name} ×</button>)}</div>}{referenceAssets.length>0&&<div className="asset-chips">{referenceAssets.map(asset=><button type="button" key={asset.id} className={referenceIds.includes(asset.id)?"selected":""} onClick={()=>toggleReference(asset.id)}>{asset.mediaType==="video"?"🎬":"🖼️"} {asset.name}</button>)}</div>}<textarea value={referenceUrls} onChange={event=>setReferenceUrls(event.target.value)} placeholder="也可以粘贴公网图片或 MP4/MOV 视频 URL，每行一个"/><div className="muted mini">已选择 {Math.min(referenceCount,99)} / 5 个参考素材</div>{tooManyReferences&&<div className="mini error-text">参考素材最多 5 个，请删除多余的素材或 URL 后再生成。</div>}{hasVideoReference&&<div className="muted mini">检测到视频参考：系统已自动使用支持视频参考的生成路线，并把最长时长限制为 10 秒。</div>}</div>}
      {localError&&<div className="error-banner">{localError}</div>}

      <details className="advanced"><summary>画面设置</summary><div className="advanced-body"><div className="form-grid four">{(mode==="text_to_video"||mode==="reference_to_video")&&<SimpleSelect label="画幅" value={aspectRatio} onChange={setAspectRatio} options={["16:9","9:16","1:1","4:3","3:4"]}/>}<SimpleSelect label="时长" value={String(effectiveDuration)} onChange={value=>setDuration(Number(value))} options={durationOptions} suffix="秒"/><SimpleSelect label="清晰度" value={resolution} onChange={value=>setResolution(value as "720P"|"1080P")} options={["1080P","720P"]}/><div className="field"><span className="field-label">任务名称<small>可不填</small></span><input value={title} onChange={event=>setTitle(event.target.value)} placeholder="例如：新品广告主镜头"/></div></div></div></details>

      <div className="field"><span className="field-label">4. 生成几个版本？<small>1 个是普通任务；2–4 个会创建同一批次的独立任务</small></span><div className="asset-chips">{[1,2,3,4].map(count=><button type="button" key={count} className={versionCount===count?"selected":""} onClick={()=>setVersionCount(count)}>{count} 个版本</button>)}</div><div className="muted mini">{versionCount===1?"只创建 1 个任务。":"Wanke 会按版本 1→N 顺序提交；每个版本都有独立任务编号、状态、失败原因、重试和删除。某一个失败不会取消其他版本。"}</div><details className="advanced" style={{marginTop:8}}><summary><HelpCircle size={15}/> 批量版本怎么用？</summary><div className="advanced-body"><div className="muted mini"><strong>适合：</strong>同一个创作意图想一次获得多个候选，例如产品广告同时出 3 个版本后挑最好的一条。</div><div className="muted mini"><strong>不适合：</strong>三个版本需要不同人物、不同产品或完全不同 Prompt；这种情况应分别创建任务。</div><div className="muted mini"><strong>演示：</strong>产品广告 Recipe + 同一张手环产品图 + “镜头缓慢环绕” + 3 个版本 → 任务中心出现“版本 1/3、2/3、3/3”，可以分别完成、失败或重试。</div><div className="muted mini"><strong>和 Recipe 的关系：</strong>同批次共享同一 Recipe 和输入条件；批量版本只负责产生独立候选，不改变 Recipe、Prompt、素材或 Provider 规则。</div></div></details></div>

      <div className="stage-run"><button className="primary" disabled={submitting||!ready} onClick={run}><Send size={16}/>{submitting?"正在提交…":localUploading?"正在准备图片…":versionCount>1?`生成 ${versionCount} 个版本`:"开始生成"}</button>{!ready&&<span className="muted mini">填写描述并补齐当前模式需要的素材后即可生成</span>}{ready&&<span className="muted mini">当前：{recipe.label} · {versionCount>1?`${versionCount} 个独立版本 · `:""}模型和 Provider 路由由系统设置决定</span>}</div>
    </div></section>
  </div>;
}

function ImagePicker({ label, assets, assetId, setAssetId, url, setUrl, local, setLocal, directAvailable, compact = false }: { label:string; assets:StoredAsset[]; assetId:string; setAssetId:(value:string)=>void; url:string; setUrl:(value:string)=>void; local:LocalInput|null; setLocal:(value:LocalInput|null)=>void; directAvailable:boolean; compact?:boolean }) {
  const [uploading,setUploading]=useState(false); const [error,setError]=useState("");
  async function chooseLocal(file:File|undefined){if(!file)return;const previous=local;setUploading(true);setError("");setAssetId("");setUrl("");setLocal(null);try{const input=await uploadLocalImage(file);if(previous)discardLocalImage(previous.ref);setLocal(input)}catch(e){setLocal(previous);setError(e instanceof Error?e.message:String(e))}finally{setUploading(false)}}
  function removeLocal(){if(!local)return;const ref=local.ref;setLocal(null);discardLocalImage(ref)}
  return <div className="field"><span className="field-label">{label}<small>{directAvailable?"直接选本地图片，或使用素材库 / 公网 URL":compact?"素材库或公网 URL":"优先从素材库选，也可以粘贴公网图片 URL"}</small></span>{directAvailable&&<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={event=>{chooseLocal(event.target.files?.[0]);event.currentTarget.value=""}}/>}{local&&<div className="asset-chips"><button type="button" className="selected" onClick={removeLocal}>🖼️ {local.name} ×</button></div>}{!local&&<select value={assetId} onChange={event=>{setAssetId(event.target.value);if(event.target.value)setLocal(null)}}><option value="">— 从素材库选择 —</option>{assets.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>}{!local&&!assetId&&<input value={url} onChange={event=>{setUrl(event.target.value);setLocal(null)}} placeholder="https://...jpg / png / webp"/>}{uploading&&<div className="muted mini">正在准备本地图片…</div>}{error&&<div className="mini error-text">{error}</div>}</div>;
}

async function uploadLocalImage(file:File):Promise<LocalInput>{const form=new FormData();form.append("file",file);const response=await fetch("/api/video-inputs",{method:"POST",body:form});const body=await response.json();if(!response.ok)throw new Error(body.error||"本地图片准备失败");return body.input as LocalInput}
function discardLocalImage(ref:string){fetch(`/api/video-inputs?ref=${encodeURIComponent(ref)}`,{method:"DELETE"}).catch(()=>undefined)}
function SimpleSelect({label,value,onChange,options,suffix=""}:{label:string;value:string;onChange:(value:string)=>void;options:string[];suffix?:string}){return <div className="field"><span className="field-label">{label}</span><select value={value} onChange={event=>onChange(event.target.value)}>{options.map(option=><option key={option} value={option}>{option}{suffix}</option>)}</select></div>}
