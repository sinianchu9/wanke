"use client";

import OSS from "ali-oss";
import { useMemo, useState } from "react";
import { Box, Image as ImageIcon, Play, Sparkles, UserRound, WandSparkles } from "lucide-react";
import type { PublicSubjectCard } from "@/components/subject-library";
import type { StoredAsset } from "@/lib/types";

type CreationType = "text_video" | "product_ad" | "person_short" | "image_video";
type Platform = "douyin" | "xiaohongshu" | "youtube" | "landscape" | "square";
type LocalInput = { ref: string; name: string; size: number };

type Props = {
  assets: StoredAsset[];
  subjects: PublicSubjectCard[];
  onCreated: (projectId: string) => Promise<void> | void;
  onAdvanced: () => void;
  onSettings: () => void;
  onAssetsChanged: () => Promise<void> | void;
  generationReady: boolean | null;
  directAvailable: boolean;
  extendedUploadAvailable: boolean;
};

const templates: Array<{ id: CreationType; label: string; desc: string; icon: any; demo: string }> = [
  { id: "text_video", label: "文字生视频", desc: "只写描述，无需素材，2–30 秒单次原生直出。", icon: Sparkles, demo: "东京雨夜，一辆黑色跑车穿过霓虹街道，低机位跟拍，电影感光影，镜头自然推进。" },
  { id: "product_ad", label: "产品广告", desc: "产品 + 卖点，2–30 秒单次原生直出。", icon: Box, demo: "为这款智能手环做一条广告，突出循环震动提醒，画面简洁、有科技感。" },
  { id: "person_short", label: "人物短片", desc: "人物 + 动作，2–30 秒单次原生直出，优先保持人物一致。", icon: UserRound, demo: "让这个女孩走进咖啡店，在门口回头看镜头，动作自然，镜头轻微跟随。" },
  { id: "image_video", label: "图片动起来", desc: "图片 + 运动描述，2–30 秒单次原生直出，不改变主体结构。", icon: ImageIcon, demo: "主体保持不变，加入轻微风吹效果，镜头缓慢推近，整体自然真实。" },
];

export default function QuickCreationWizard({ assets, subjects, onCreated, onAdvanced, onSettings, onAssetsChanged, generationReady, directAvailable, extendedUploadAvailable }: Props) {
  const [type, setType] = useState<CreationType>("text_video");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [platform, setPlatform] = useState<Platform>("douyin");
  const [duration, setDuration] = useState<number>(5);
  const [preferredModel, setPreferredModel] = useState<"auto" | "wan3.0" | "happyhorse-1.1">("auto");
  const [subjectId, setSubjectId] = useState("");
  const [imageAssetId, setImageAssetId] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [localInput, setLocalInput] = useState<LocalInput | null>(null);
  const [localUploading, setLocalUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  const availableSubjects = useMemo(() => subjects.filter(subject => type === "product_ad" ? subject.subjectType === "product" : subject.subjectType === "person"), [subjects, type]);
  const images = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const selectedTemplate = templates.find(item => item.id === type)!;
  const directReferenceReady = Boolean(localInput || imageAssetId || referenceUrl.trim());
  const referenceReady = type === "text_video" ? true : type === "image_video" ? directReferenceReady : Boolean(subjectId) || directReferenceReady;
  const interactionLocked = busy || localUploading;
  const ready = generationReady === true && Boolean(goal.trim()) && referenceReady && !interactionLocked;
  const canChooseComputerImage = directAvailable || extendedUploadAvailable;

  function clearLocal() {
    if (localInput) discardLocalImage(localInput.ref);
    setLocalInput(null);
  }

  function chooseType(next: CreationType) {
    if (interactionLocked) return;
    clearLocal();
    setType(next);
    setSubjectId("");
    setImageAssetId("");
    setReferenceUrl("");
    setError("");
    setResult(null);
  }

  function chooseSubject(value: string) {
    if (interactionLocked) return;
    if (value) {
      clearLocal();
      setImageAssetId("");
      setReferenceUrl("");
    }
    setSubjectId(value);
  }

  function chooseAsset(value: string) {
    if (interactionLocked) return;
    if (value) {
      clearLocal();
      setSubjectId("");
      setReferenceUrl("");
    }
    setImageAssetId(value);
  }

  function changeReferenceUrl(value: string) {
    if (interactionLocked) return;
    if (value.trim()) {
      clearLocal();
      setSubjectId("");
      setImageAssetId("");
    }
    setReferenceUrl(value);
  }

  async function chooseLocal(file: File | undefined) {
    if (!file || !canChooseComputerImage || interactionLocked) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError("请选择 JPG、PNG 或 WEBP 图片");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("图片不能超过 10 MB");
      return;
    }

    setLocalUploading(true); setError("");
    try {
      if (directAvailable) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/video-inputs", { method: "POST", body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "图片准备失败");
        if (localInput) discardLocalImage(localInput.ref);
        setLocalInput(body.input as LocalInput);
        setSubjectId(""); setImageAssetId(""); setReferenceUrl("");
        return;
      }

      const asset = await uploadImageToExtendedLibrary(file);
      clearLocal();
      setSubjectId(""); setReferenceUrl("");
      setImageAssetId(asset.id);
      await onAssetsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLocalUploading(false); }
  }

  async function uploadImageToExtendedLibrary(file: File) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const credentialResponse = await fetch("/api/assets/upload-credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileExt: ext }),
    });
    const credential = await credentialResponse.json();
    if (!credentialResponse.ok) throw new Error(credential.error || "图片上传准备失败");

    const address = decodeJson(credential.uploadAddress);
    const auth = decodeJson(credential.uploadAuth);
    if (!address.Bucket || !address.FileName || !address.Endpoint || !auth.AccessKeyId || !auth.AccessKeySecret || !auth.SecurityToken) {
      throw new Error("图片上传凭证不完整，请检查视频服务设置");
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
      parallel: 3,
      partSize: Math.max(1024 * 1024, Math.min(5 * 1024 * 1024, Math.ceil(file.size / 50))),
    });

    const registerResponse = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, sourceUrl: credential.fileURL, mediaType: "image" }),
    });
    const registered = await registerResponse.json();
    if (!registerResponse.ok || !registered.asset?.id) throw new Error(registered.error || "图片保存失败");
    return registered.asset as StoredAsset;
  }

  async function create() {
    if (generationReady !== true) {
      setError(generationReady === null ? "正在检查视频服务状态，请稍后再点击开始创作。" : "视频服务还没有配置好。完成一次设置后，就可以从这里直接开始做视频。");
      return;
    }
    if (!ready) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/projects/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name: name.trim(),
          goal: goal.trim(),
          platform,
          totalDuration: duration,
          preferredModel,
          subjectId: type === "text_video" || type === "image_video" ? null : (subjectId || null),
          imageAssetId: type === "text_video" ? null : (imageAssetId || null),
          referenceUrl: type === "text_video" ? "" : referenceUrl.trim(),
          localInputRef: type === "text_video" ? "" : (localInput?.ref || ""),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "创建视频失败");
      setResult(body);
      if (localInput) discardLocalImage(localInput.ref);
      setLocalInput(null);
      await onCreated(body.projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <div className="content-stack">
    <div className="hero-card">
      <div>
        <div className="eyebrow">SIMPLE CREATION</div>
        <h2>一句话开始做视频</h2>
        <p>不用先整理素材库，也不用选模型。给 Wanke 一个主体或一张图片，再说一句想表达什么，系统会自动建立作品、规划镜头并开始生成。</p>
      </div>
      <button className="secondary" disabled={interactionLocked} onClick={onAdvanced}><WandSparkles size={15}/>高级创作</button>
    </div>

    {generationReady === null && <div className="notice"><span>正在检查视频服务状态…</span></div>}
    {generationReady === false && <div className="error-banner warning">
      <span>第一次使用只差一步：先配置一个视频生成服务。配置完成后，这个页面就是日常创作入口。</span>
      <button className="secondary" onClick={onSettings}>去配置</button>
    </div>}

    <section className="panel">
      <div className="field">
        <span className="field-label">1. 你想做什么？</span>
        <div className="asset-chips">
          {templates.map(item => {
            const Icon = item.icon;
            return <button type="button" disabled={interactionLocked} key={item.id} className={type === item.id ? "selected" : ""} onClick={() => chooseType(item.id)}><Icon size={15}/>{item.label}</button>;
          })}
        </div>
        <div className="muted mini">{selectedTemplate.desc}</div>
      </div>

      {type === "text_video" ? (
        <div className="field" style={{marginTop:16}}>
          <span className="field-label">2. 素材准备<small>纯文字生成无需素材</small></span>
          <div className="notice" style={{marginTop:8}}>
            <Sparkles size={16}/>
            <span>纯文字生成不依赖任何参考素材，直接在第 3 步用一句话描述画面即可，系统将 2–30 秒单次原生直出。</span>
          </div>
        </div>
      ) : (
        <div className="field" style={{marginTop:16}}>
          <span className="field-label">2. 主体是什么？<small>{type === "image_video" ? "给一张图片即可" : "可选常用主体，也可本次直接给一张图片"}</small></span>

          {type !== "image_video" && availableSubjects.length > 0 && <div style={{marginBottom:10}}>
            <select disabled={interactionLocked} value={subjectId} onChange={event => chooseSubject(event.target.value)}>
              <option value="">— 选择保存过的{type === "product_ad" ? "产品" : "人物"}（可选）—</option>
              {availableSubjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
            <div className="muted mini">保存过的主体适合反复创作；第一次使用不需要先建立主体卡。</div>
          </div>}

          {!subjectId && <div className="panel" style={{marginTop:8}}>
            <div className="muted mini"><strong>本次直接使用一张图片</strong></div>
            <div className="form-grid two" style={{marginTop:8}}>
              <div className="field">
                <span className="field-label">从已有图片选择</span>
                <select disabled={interactionLocked} value={imageAssetId} onChange={event => chooseAsset(event.target.value)}>
                  <option value="">— 可选 —</option>
                  {images.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                </select>
              </div>
              <div className="field">
                <span className="field-label">或粘贴图片直链</span>
                <input disabled={interactionLocked} value={referenceUrl} onChange={event => changeReferenceUrl(event.target.value)} placeholder="https://...jpg / png / webp"/>
              </div>
            </div>

            {canChooseComputerImage && <div className="field" style={{marginTop:10}}>
              <span className="field-label">或直接选择电脑里的图片<small>JPG / PNG / WEBP，10MB 内</small></span>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={interactionLocked} onChange={event => { chooseLocal(event.target.files?.[0]); event.currentTarget.value = ""; }}/>
              {localUploading && <div className="muted mini">正在准备图片…</div>}
              {localInput && <div className="asset-chips"><button type="button" disabled={interactionLocked} className="selected" onClick={clearLocal}>🖼️ {localInput.name} ×</button></div>}
              {!directAvailable && extendedUploadAvailable && imageAssetId && <div className="muted mini">电脑图片会自动准备到素材库，可以直接开始创作，以后也能继续复用。</div>}
            </div>}

            {!canChooseComputerImage && <div className="muted mini" style={{marginTop:8}}>当前视频服务不能直接准备电脑里的图片；可以从已有图片选择，或粘贴一条公网图片直链。</div>}
            {!images.length && !canChooseComputerImage && <div className="muted mini">素材库为空也不影响开始，只要粘贴一张公网图片直链即可。</div>}
          </div>}
        </div>
      )}

      <div className="form-grid two" style={{marginTop:16}}>
        <div className="field">
          <span className="field-label">作品名称<small>可选</small></span>
          <input disabled={interactionLocked} value={name} onChange={event => setName(event.target.value)} placeholder={type === "text_video" ? "例如：雨夜霓虹街道微电影" : type === "product_ad" ? "例如：黑色手环夏季广告" : type === "person_short" ? "例如：咖啡店人物短片" : "例如：产品图动态展示"}/>
        </div>
        <div className="field">
          <span className="field-label">3. 你想表达什么？<small>一句话就够</small></span>
          <textarea disabled={interactionLocked} value={goal} onChange={event => setGoal(event.target.value)} placeholder={selectedTemplate.demo}/>
          <button type="button" disabled={interactionLocked} className="link-button" onClick={() => setGoal(selectedTemplate.demo)}>填入演示内容</button>
        </div>
      </div>

      <div className="form-grid two" style={{marginTop:16}}>
        <div className="field">
          <span className="field-label">4. 发到哪里？（画幅适配）</span>
          <select disabled={interactionLocked} value={platform} onChange={event => setPlatform(event.target.value as Platform)}>
            <option value="douyin">抖音竖屏 (9:16)</option>
            <option value="xiaohongshu">小红书 (3:4)</option>
            <option value="youtube">YouTube (16:9)</option>
            <option value="landscape">通用横屏 (16:9)</option>
            <option value="square">方形画幅 (1:1)</option>
          </select>
        </div>
        <div className="field">
          <span className="field-label">5. 偏好模型</span>
          <select disabled={interactionLocked} value={preferredModel} onChange={event => setPreferredModel(event.target.value as any)}>
            <option value="auto">智能推荐（按时长智能调度）</option>
            <option value="wan3.0">Wan 3.0（原生单镜头 2–30 秒直出）</option>
            <option value="happyhorse-1.1">HappyHorse 1.1（运镜质感 / &gt;15秒多镜头切分）</option>
          </select>
        </div>
      </div>

      <div className="field" style={{marginTop:16}}>
        <span className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>6. 视频时长（滑动调节）</span>
          <b style={{ color: "#4F46E5" }}>{duration} 秒</b>
        </span>
        <input
          type="range"
          min={2}
          max={30}
          step={1}
          disabled={interactionLocked}
          value={duration}
          onChange={event => setDuration(Number(event.target.value))}
          style={{ width: "100%", accentColor: "#4F46E5", marginTop: "6px" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#888", marginTop: "2px" }}>
          <span>2秒</span>
          <span>5秒</span>
          <span>10秒</span>
          <span>15秒</span>
          <span>20秒</span>
          <span>25秒</span>
          <span>30秒</span>
        </div>
      </div>

      <div className="notice" style={{marginTop:16}}>
        <Sparkles size={16}/>
        <span>
          {preferredModel === "wan3.0" ? (
            `已指定 Wan 3.0 视频大模型：当前 ${duration} 秒将以单镜头原生直出完整超长视频。`
          ) : preferredModel === "happyhorse-1.1" ? (
            duration <= 15
              ? `已指定 HappyHorse 1.1 质感模型：当前 ${duration} 秒将以单镜头高动态自然运镜直出。`
              : `已指定 HappyHorse 1.1 质感模型：总时长 ${duration} 秒超过模型单次上限 (15s)，将自动规划多镜头智能分段生成与淡入淡出转场衔接（不能单镜头直出）。`
          ) : (
            duration > 15 || duration < 3
              ? `当前 ${duration} 秒将自动调度 Wan 3.0 超长大模型单次原生生成。`
              : `当前 ${duration} 秒将智能协同 HappyHorse 1.1 质感模型与 Wan 3.0 大模型。`
          )}
        </span>
      </div>

      <div className="inline-actions" style={{marginTop:16}}>
        <button className="primary" disabled={!ready} onClick={create}><Play size={15}/>{busy ? "正在建立作品并提交…" : localUploading ? "正在准备图片…" : generationReady === null ? "正在检查服务…" : "开始创作"}</button>
        <span className="muted mini">常用设置已经自动处理，需要更细控制时再进入高级创作。</span>
      </div>
      {!referenceReady && <div className="muted mini" style={{marginTop:8}}>先选择一个主体，或直接提供一张图片。</div>}
      {error && <div className="error-banner" style={{marginTop:12}}>{error}</div>}
      {result && <div className="notice" style={{marginTop:12}}><Sparkles size={16}/><span>已创建「{result.projectName}」：已提交生成{result.failed ? `，${result.failed} 个提交失败，可以在“我的作品”里直接重试` : ""}。</span></div>}
    </section>

    <details className="advanced">
      <summary>简单模式替我做了哪些事？</summary>
      <div className="advanced-body">
        <div className="muted mini"><strong>文字生视频：</strong>只需一句话画面描述，2–30 秒单次原生直出完整视频。</div>
        <div className="muted mini"><strong>产品广告：</strong>以产品为核心视觉，清晰展示外观、材质与核心卖点，2–30 秒原生直出。</div>
        <div className="muted mini"><strong>人物短片：</strong>人物出镜并完成指定动作，优先保持人物身份一致，2–30 秒原生直出。</div>
        <div className="muted mini"><strong>图片动起来：</strong>以原图为基础规划自然运动，不改变主体结构，2–30 秒原生直出。</div>
        <div className="muted mini"><strong>单次原生直出：</strong>充分发挥 Wan 3.0 (2–30秒) 与 HappyHorse 1.1 (3–15秒) 模型能力，单次直接出片，不拆分多镜头。</div>
        <div className="muted mini"><strong>主体库不是前置条件：</strong>保存过的主体用于长期复用；第一次做视频可以直接提供一张图片。</div>
        <div className="muted mini"><strong>电脑图片自动适配：</strong>系统会根据当前视频服务选择临时直传或自动上传素材，用户不需要理解底层区别。</div>
      </div>
    </details>
  </div>;
}

function discardLocalImage(ref: string) {
  fetch(`/api/video-inputs?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }).catch(() => undefined);
}

function decodeJson(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
