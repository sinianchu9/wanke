"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Save, ShieldCheck } from "lucide-react";

type ProviderMode = "auto" | "modelstudio" | "yike";
type Source = "ui" | "environment" | "default";

type SettingsData = {
  videoProviderMode: ProviderMode;
  modelStudio: {
    apiKeyConfigured: boolean;
    apiKeyMasked: string;
    apiKeySource: Source;
    workspaceId: string;
    workspaceIdSource: Source;
    baseUrl: string;
    baseUrlSource: Source;
    blockedReason: string;
  };
  yike: {
    accessKeyIdConfigured: boolean;
    accessKeyIdMasked: string;
    accessKeyIdSource: Source;
    accessKeySecretConfigured: boolean;
    accessKeySecretMasked: string;
    accessKeySecretSource: Source;
    regionId: string;
    regionIdSource: Source;
    endpoint: string;
    endpointSource: Source;
  };
};

export default function SettingsPanel({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [mode, setMode] = useState<ProviderMode>("auto");
  const [modelStudioApiKey, setModelStudioApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [modelStudioBaseUrl, setModelStudioBaseUrl] = useState("");
  const [clearModelStudioApiKey, setClearModelStudioApiKey] = useState(false);
  const [yikeAccessKeyId, setYikeAccessKeyId] = useState("");
  const [yikeAccessKeySecret, setYikeAccessKeySecret] = useState("");
  const [yikeRegionId, setYikeRegionId] = useState<"ap-southeast-1" | "cn-shanghai">("ap-southeast-1");
  const [yikeEndpoint, setYikeEndpoint] = useState("");
  const [clearYikeAccessKeyId, setClearYikeAccessKeyId] = useState(false);
  const [clearYikeAccessKeySecret, setClearYikeAccessKeySecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<any>(null);

  async function load() {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "读取设置失败");
    const next = body.settings as SettingsData;
    setSettings(next);
    setMode(next.videoProviderMode);
    setWorkspaceId(next.modelStudio.workspaceId || "");
    setModelStudioBaseUrl(next.modelStudio.baseUrl || "");
    setYikeRegionId(next.yike.regionId === "cn-shanghai" ? "cn-shanghai" : "ap-southeast-1");
    setYikeEndpoint(next.yike.endpoint || "");
  }

  useEffect(() => {
    load().catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoProviderMode: mode,
          modelStudioApiKey,
          modelStudioWorkspaceId: workspaceId,
          modelStudioBaseUrl,
          clearModelStudioApiKey,
          yikeAccessKeyId,
          yikeAccessKeySecret,
          yikeRegionId,
          yikeEndpoint,
          clearYikeAccessKeyId,
          clearYikeAccessKeySecret,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存设置失败");
      setSettings(body.settings);
      setModelStudioApiKey("");
      setYikeAccessKeyId("");
      setYikeAccessKeySecret("");
      setClearModelStudioApiKey(false);
      setClearYikeAccessKeyId(false);
      setClearYikeAccessKeySecret(false);
      setNotice("设置已保存并立即生效，不需要重启 Wanke。");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  async function checkStatus() {
    setChecking(true); setError("");
    try {
      const response = await fetch("/api/status?probe=1", { cache: "no-store" });
      const body = await response.json();
      setStatus(body);
      if (!response.ok) throw new Error(body.error || "状态检查失败");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setChecking(false); }
  }

  if (!settings) return <div className="empty-state"><RefreshCw size={28}/><strong>正在读取设置</strong><span>凭证只在服务端读取，不会返回完整密钥。</span></div>;

  const typedModelStudioIssue = modelStudioInputIssue(modelStudioApiKey, modelStudioBaseUrl);

  return <div className="content-stack">
    <div className="hero-card compact">
      <div>
        <div className="eyebrow">PROVIDER SETTINGS</div>
        <h2>API 与视频引擎</h2>
        <p>在这里配置百炼和万镜一刻，不需要再修改 .env.local。密钥保存在 Wanke 服务端数据库中，浏览器只能看到脱敏状态。</p>
      </div>
      <div className="upload-box" style={{cursor:"default"}}>
        <ShieldCheck size={26}/><strong>服务端保存</strong><span>完整 Key 不会通过设置接口返回浏览器</span>
      </div>
    </div>

    {notice && <div className="notice" style={{margin:0}}><CheckCircle2 size={16}/>{notice}</div>}
    {error && <div className="error-banner">{error}</div>}

    <section className="panel">
      <div className="panel-title"><div><h3>基础 AI 视频使用哪个引擎</h3><p>高级复刻、数字人、故事板等扩展能力仍使用万镜一刻。</p></div></div>
      <div className="asset-chips" style={{marginTop:14}}>
        <button type="button" className={mode === "auto" ? "selected" : ""} onClick={()=>setMode("auto")}>自动推荐</button>
        <button type="button" className={mode === "modelstudio" ? "selected" : ""} onClick={()=>setMode("modelstudio")}>强制百炼</button>
        <button type="button" className={mode === "yike" ? "selected" : ""} onClick={()=>setMode("yike")}>强制万镜一刻</button>
      </div>
      <div className="muted mini" style={{marginTop:10}}>{mode === "auto" ? "优先百炼；百炼未配置或素材不适合直连时自动回退万镜一刻。" : mode === "modelstudio" ? "基础 AI 视频只走百炼；配置或参数不满足时直接报错，不静默回退。" : "基础 AI 视频也固定走万镜一刻；本地图片直传将不可用，请用素材库或公网 URL。"}</div>
    </section>

    <div className="form-grid two">
      <section className="panel">
        <div className="panel-title"><div><h3>百炼 Model Studio</h3><p>Wanke 服务端直连使用 Pay-As-You-Go；HappyHorse / Wan 基础视频生成默认走新加坡区域。</p></div></div>
        <div className="notice" style={{margin:"12px 0 0"}}>
          <AlertTriangle size={16}/>
          <span>Token Plan / Coding Plan 虽包含部分视频模型，但官方当前只允许在受支持的 AI 编程工具或 Agent 中交互式使用，不能作为自定义应用后端 API。这里不要填写 <code>sk-sp-...</code> 或 <code>token-plan.../compatible-mode/v1</code>。</span>
        </div>
        {settings.modelStudio.blockedReason && <div className="error-banner" style={{marginTop:12}}>当前百炼配置已停止用于新任务：{settings.modelStudio.blockedReason} 请清除对应 Key / Base URL 后保存。</div>}
        <div className="form-stack" style={{marginTop:14}}>
          <div className="field">
            <span className="field-label">Pay-As-You-Go API Key <small>{credentialHint(settings.modelStudio.apiKeyConfigured, settings.modelStudio.apiKeyMasked, settings.modelStudio.apiKeySource)}</small></span>
            <input type="password" autoComplete="new-password" value={modelStudioApiKey} onChange={e=>{setModelStudioApiKey(e.target.value);setClearModelStudioApiKey(false)}} placeholder={settings.modelStudio.apiKeyConfigured ? "留空保持现有 API Key" : "填写按量付费 Key，例如 sk-ws-..."}/>
            {modelStudioApiKey.trim().toLowerCase().startsWith("sk-sp-") && <span className="mini error-text">这是 Token Plan 专属 Key，Wanke 应用后端不会直接使用它。</span>}
            {settings.modelStudio.apiKeyConfigured && <button type="button" className="secondary" onClick={()=>setClearModelStudioApiKey(v=>!v)}>{clearModelStudioApiKey ? "取消清除" : "清除界面保存的 API Key"}</button>}
            {clearModelStudioApiKey && <span className="mini error-text">保存后会删除数据库中的 Key；如果服务器环境变量仍配置了 Key，会自动继续使用环境变量。</span>}
          </div>
          <div className="field">
            <span className="field-label">Workspace ID <small>{sourceHint(settings.modelStudio.workspaceIdSource)}</small></span>
            <input value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)} placeholder="例如：ws_xxx；Pay-As-You-Go 推荐填写"/>
          </div>
          <div className="field">
            <span className="field-label">原生视频 API Root <small>高级设置，可留空</small></span>
            <input value={modelStudioBaseUrl} onChange={e=>setModelStudioBaseUrl(e.target.value)} placeholder="例如：https://ws-xxx.ap-southeast-1.maas.aliyuncs.com"/>
            <span className="muted mini">不要填 <code>/compatible-mode/v1</code>。留空时根据 Workspace ID 自动生成新加坡原生 API 地址。</span>
          </div>
          {typedModelStudioIssue && <div className="error-banner">{typedModelStudioIssue}</div>}
          <div className="muted mini">没有 Workspace ID 和 Base URL 时会使用新加坡公共地址 dashscope-intl.aliyuncs.com。</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title"><div><h3>万镜一刻</h3><p>高级复刻、数字人、旁白、故事板、翻译及兼容生成链路。</p></div></div>
        <div className="form-stack">
          <div className="field">
            <span className="field-label">AccessKey ID <small>{credentialHint(settings.yike.accessKeyIdConfigured, settings.yike.accessKeyIdMasked, settings.yike.accessKeyIdSource)}</small></span>
            <input type="password" autoComplete="new-password" value={yikeAccessKeyId} onChange={e=>{setYikeAccessKeyId(e.target.value);setClearYikeAccessKeyId(false)}} placeholder={settings.yike.accessKeyIdConfigured ? "留空保持现有 AccessKey ID" : "填写 AccessKey ID"}/>
            {settings.yike.accessKeyIdConfigured && <button type="button" className="secondary" onClick={()=>setClearYikeAccessKeyId(v=>!v)}>{clearYikeAccessKeyId ? "取消清除" : "清除界面保存的 AccessKey ID"}</button>}
          </div>
          <div className="field">
            <span className="field-label">AccessKey Secret <small>{credentialHint(settings.yike.accessKeySecretConfigured, settings.yike.accessKeySecretMasked, settings.yike.accessKeySecretSource)}</small></span>
            <input type="password" autoComplete="new-password" value={yikeAccessKeySecret} onChange={e=>{setYikeAccessKeySecret(e.target.value);setClearYikeAccessKeySecret(false)}} placeholder={settings.yike.accessKeySecretConfigured ? "留空保持现有 Secret" : "填写 AccessKey Secret"}/>
            {settings.yike.accessKeySecretConfigured && <button type="button" className="secondary" onClick={()=>setClearYikeAccessKeySecret(v=>!v)}>{clearYikeAccessKeySecret ? "取消清除" : "清除界面保存的 Secret"}</button>}
          </div>
          <div className="field">
            <span className="field-label">地域</span>
            <select value={yikeRegionId} onChange={e=>setYikeRegionId(e.target.value as "ap-southeast-1" | "cn-shanghai")}>
              <option value="ap-southeast-1">新加坡（ap-southeast-1）</option>
              <option value="cn-shanghai">上海（cn-shanghai）</option>
            </select>
          </div>
          <div className="field">
            <span className="field-label">Endpoint <small>高级设置，可留空</small></span>
            <input value={yikeEndpoint} onChange={e=>setYikeEndpoint(e.target.value)} placeholder="留空时根据地域自动选择"/>
          </div>
        </div>
      </section>
    </div>

    <section className="panel">
      <div className="stage-run" style={{marginTop:0}}>
        <div>
          <strong>保存后立即用于新任务</strong>
          <div className="muted mini" style={{marginTop:4}}>历史任务仍按提交时记录的 provider 查询，不会因为切换引擎而串线。</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="secondary" disabled={checking} onClick={checkStatus}><RefreshCw size={15}/>{checking?"检查中…":"检查配置"}</button>
          <button className="primary" disabled={saving} onClick={save}><Save size={15}/>{saving?"保存中…":"保存设置"}</button>
        </div>
      </div>
      {status && <div className="muted mini" style={{marginTop:12}}>
        当前模式：{modeLabel(status.providerMode)} · 百炼：{status.modelStudio?.configured?"已配置":"未配置"} · 万镜一刻：{status.yike?.configured?"已配置":"未配置"}
        {status.connected === true ? " · 万镜一刻连接正常" : status.connected === false ? ` · ${status.yikeError || status.error || "连接检查未通过"}` : status.note ? ` · ${status.note}` : ""}
      </div>}
    </section>
  </div>;
}

function sourceHint(source: Source) {
  return source === "ui" ? "来自设置界面" : source === "environment" ? "来自环境变量" : "未单独配置";
}

function credentialHint(configured: boolean, masked: string, source: Source) {
  if (!configured) return "未配置";
  return `${masked || "已配置"} · ${sourceHint(source)}`;
}

function modeLabel(mode: ProviderMode) {
  return mode === "modelstudio" ? "百炼" : mode === "yike" ? "万镜一刻" : "自动";
}

function modelStudioInputIssue(apiKey: string, baseUrl: string) {
  if (apiKey.trim().toLowerCase().startsWith("sk-sp-")) return "检测到 Token Plan 专属 Key：Wanke 当前不会把它用于应用后端直连。";
  const value = baseUrl.trim().toLowerCase();
  if (!value) return "";
  if (value.includes("token-plan.") || value.includes("coding.dashscope")) return "检测到 Token Plan / Coding Plan 地址：该套餐不支持 Wanke 这类自定义应用后端直连。";
  if (value.includes("/compatible-mode/") || value.endsWith("/compatible-mode") || value.includes("/apps/anthropic")) return "检测到兼容模式地址：视频生成需要原生 API Root，不要填写 /compatible-mode/v1 或 /apps/anthropic。";
  return "";
}
