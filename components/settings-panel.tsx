"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, RefreshCw, Save, ShieldCheck, Sparkles } from "lucide-react";

type ProviderMode = "auto" | "modelstudio" | "yike";
type Source = "ui" | "environment" | "inherited_ui" | "inherited_env" | "default";

type ChannelSettings = {
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  apiKeySource: Source;
  workspaceId: string;
  workspaceIdSource: Source;
  baseUrl: string;
  baseUrlSource: Source;
  blockedReason: string;
  isOverridden?: { apiKey: boolean; workspaceId: boolean; baseUrl: boolean };
};

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
  happyhorse?: ChannelSettings;
  wan?: ChannelSettings;
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
  const [channelTab, setChannelTab] = useState<"common" | "happyhorse" | "wan">("common");

  // Universal Model Studio
  const [modelStudioApiKey, setModelStudioApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [modelStudioBaseUrl, setModelStudioBaseUrl] = useState("");
  const [clearModelStudioApiKey, setClearModelStudioApiKey] = useState(false);

  // HappyHorse dedicated
  const [happyhorseApiKey, setHappyhorseApiKey] = useState("");
  const [happyhorseWorkspaceId, setHappyhorseWorkspaceId] = useState("");
  const [happyhorseBaseUrl, setHappyhorseBaseUrl] = useState("");
  const [clearHappyhorseApiKey, setClearHappyhorseApiKey] = useState(false);

  // Wan dedicated
  const [wanApiKey, setWanApiKey] = useState("");
  const [wanWorkspaceId, setWanWorkspaceId] = useState("");
  const [wanBaseUrl, setWanBaseUrl] = useState("");
  const [clearWanApiKey, setClearWanApiKey] = useState(false);

  // Yike
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

    setHappyhorseWorkspaceId(next.happyhorse?.isOverridden?.workspaceId ? next.happyhorse.workspaceId : "");
    setHappyhorseBaseUrl(next.happyhorse?.isOverridden?.baseUrl ? next.happyhorse.baseUrl : "");

    setWanWorkspaceId(next.wan?.isOverridden?.workspaceId ? next.wan.workspaceId : "");
    setWanBaseUrl(next.wan?.isOverridden?.baseUrl ? next.wan.baseUrl : "");

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
          happyhorseApiKey,
          happyhorseWorkspaceId,
          happyhorseBaseUrl,
          clearHappyhorseApiKey,
          wanApiKey,
          wanWorkspaceId,
          wanBaseUrl,
          clearWanApiKey,
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
      setHappyhorseApiKey("");
      setWanApiKey("");
      setYikeAccessKeyId("");
      setYikeAccessKeySecret("");
      setClearModelStudioApiKey(false);
      setClearHappyhorseApiKey(false);
      setClearWanApiKey(false);
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
      const response = await fetch("/api/admin/creation-service?probe=1", { cache: "no-store" });
      const body = await response.json();
      setStatus(body);
      if (!response.ok) throw new Error(body.error || "状态检查失败");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setChecking(false); }
  }

  if (!settings) return <div className="empty-state"><RefreshCw size={28}/><strong>正在读取设置</strong><span>凭证只在服务端读取，不会返回完整密钥。</span></div>;

  const typedModelStudioIssue = modelStudioInputIssue(modelStudioApiKey, modelStudioBaseUrl);
  const typedHhIssue = modelStudioInputIssue(happyhorseApiKey, happyhorseBaseUrl);
  const typedWanIssue = modelStudioInputIssue(wanApiKey, wanBaseUrl);

  return <div className="content-stack">
    <div className="hero-card compact">
      <div>
        <div className="eyebrow">PROVIDER SETTINGS</div>
        <h2>API 与视频引擎</h2>
        <p>在这里配置百炼和万镜一刻，支持 HappyHorse 与 Wan 独立通道配置，不需要再修改 .env.local。密钥保存在 Wanke 服务端数据库中，浏览器只能看到脱敏状态。</p>
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
        <div className="panel-title">
          <div>
            <h3>百炼 Model Studio（双通道独立支持）</h3>
            <p>支持通用默认配置与 HappyHorse、Wan 独立通道配置，例如 Wan 走北京专属空间，HappyHorse 走新加坡。</p>
          </div>
        </div>

        <div className="asset-chips" style={{marginTop:12,marginBottom:8}}>
          <button type="button" className={channelTab === "common" ? "selected" : ""} onClick={()=>setChannelTab("common")} style={{fontSize:13,padding:"4px 10px"}}>⚙️ 通用默认兜底</button>
          <button type="button" className={channelTab === "happyhorse" ? "selected" : ""} onClick={()=>setChannelTab("happyhorse")} style={{fontSize:13,padding:"4px 10px"}}>
            🐎 HappyHorse 专属 {settings.happyhorse?.isOverridden?.baseUrl || settings.happyhorse?.isOverridden?.apiKey ? "●" : ""}
          </button>
          <button type="button" className={channelTab === "wan" ? "selected" : ""} onClick={()=>setChannelTab("wan")} style={{fontSize:13,padding:"4px 10px"}}>
            🌊 Wan 专属 {settings.wan?.isOverridden?.baseUrl || settings.wan?.isOverridden?.apiKey ? "●" : ""}
          </button>
        </div>

        <div className="notice" style={{margin:"8px 0 0"}}>
          <AlertTriangle size={16}/>
          <span>Token Plan / Coding Plan 专属 Key 不能作为应用后端 API。这里不要填写 <code>sk-sp-...</code> 或 <code>token-plan.../compatible-mode/v1</code>。</span>
        </div>

        {channelTab === "common" && (
          <div className="form-stack" style={{marginTop:14}}>
            <div className="muted mini" style={{marginBottom:4,lineHeight:1.4}}>
              <strong>通用百炼配置：</strong>作为全站默认兜底。如果下方 HappyHorse 或 Wan 通道未单独配置，会自动继承这里的凭证和 Base URL。
            </div>
            {settings.modelStudio.blockedReason && <div className="error-banner">当前通用百炼配置已停止用于新任务：{settings.modelStudio.blockedReason}</div>}
            <div className="field">
              <span className="field-label">通用 Pay-As-You-Go API Key <small>{credentialHint(settings.modelStudio.apiKeyConfigured, settings.modelStudio.apiKeyMasked, settings.modelStudio.apiKeySource)}</small></span>
              <input type="password" autoComplete="new-password" value={modelStudioApiKey} onChange={e=>{setModelStudioApiKey(e.target.value);setClearModelStudioApiKey(false)}} placeholder={settings.modelStudio.apiKeyConfigured ? "留空保持现有 API Key" : "填写按量付费 Key，例如 sk-ws-..."}/>
              {modelStudioApiKey.trim().toLowerCase().startsWith("sk-sp-") && <span className="mini error-text">这是 Token Plan 专属 Key，Wanke 应用后端不会直接使用它。</span>}
              {settings.modelStudio.apiKeyConfigured && <button type="button" className="secondary" onClick={()=>setClearModelStudioApiKey(v=>!v)}>{clearModelStudioApiKey ? "取消清除" : "清除界面保存的通用 API Key"}</button>}
              {clearModelStudioApiKey && <span className="mini error-text">保存后会删除数据库中的通用 Key；如果服务器环境变量仍配置了 Key，会自动继续使用环境变量。</span>}
            </div>
            <div className="field">
              <span className="field-label">通用 Workspace ID <small>{sourceHint(settings.modelStudio.workspaceIdSource)}</small></span>
              <input value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)} placeholder="例如：ws_xxx；Pay-As-You-Go 推荐填写"/>
            </div>
            <div className="field">
              <span className="field-label">通用 原生视频 API Root <small>高级设置，可留空</small></span>
              <input value={modelStudioBaseUrl} onChange={e=>setModelStudioBaseUrl(e.target.value)} placeholder="例如：https://dashscope-intl.aliyuncs.com"/>
              <span className="muted mini">不要填 <code>/compatible-mode/v1</code>。留空时根据 Workspace ID 自动生成原生 API 地址。</span>
            </div>
            {typedModelStudioIssue && <div className="error-banner">{typedModelStudioIssue}</div>}
          </div>
        )}

        {channelTab === "happyhorse" && (
          <div className="form-stack" style={{marginTop:14}}>
            <div className="muted mini" style={{marginBottom:4,lineHeight:1.4}}>
              <strong>🐎 HappyHorse（1.1）专属通道：</strong>负责 3–15 秒文生视频、单图生视频、纯图片多参考及视频编辑，带原生音频，支持 720P/1080P，优先高画质与自然动态。留空项自动继承通用百炼配置。推荐新加坡地域。
            </div>
            {settings.happyhorse?.blockedReason && <div className="error-banner">HappyHorse 通道已停止用于新任务：{settings.happyhorse.blockedReason}</div>}
            <div className="field">
              <span className="field-label">HappyHorse 专属 API Key <small>{credentialHint(Boolean(settings.happyhorse?.apiKeyConfigured), settings.happyhorse?.apiKeyMasked || "", settings.happyhorse?.apiKeySource || "default")}</small></span>
              <input type="password" autoComplete="new-password" value={happyhorseApiKey} onChange={e=>{setHappyhorseApiKey(e.target.value);setClearHappyhorseApiKey(false)}} placeholder={settings.happyhorse?.isOverridden?.apiKey ? "留空保持现有专属 Key" : "留空则自动继承通用百炼 Key"}/>
              {happyhorseApiKey.trim().toLowerCase().startsWith("sk-sp-") && <span className="mini error-text">这是 Token Plan 专属 Key，不支持直连。</span>}
              {settings.happyhorse?.isOverridden?.apiKey && <button type="button" className="secondary" onClick={()=>setClearHappyhorseApiKey(v=>!v)}>{clearHappyhorseApiKey ? "取消清除" : "清除专属 Key（恢复继承通用）"}</button>}
              {clearHappyhorseApiKey && <span className="mini error-text">保存后将删除 HappyHorse 独立 Key 并恢复继承通用百炼 Key。</span>}
            </div>
            <div className="field">
              <span className="field-label">HappyHorse 专属 Workspace ID <small>{sourceHint(settings.happyhorse?.workspaceIdSource || "default")}</small></span>
              <input value={happyhorseWorkspaceId} onChange={e=>setHappyhorseWorkspaceId(e.target.value)} placeholder={settings.happyhorse?.workspaceId ? `当前生效：${settings.happyhorse.workspaceId}（留空继承通用）` : "留空继承通用百炼 Workspace ID"}/>
            </div>
            <div className="field">
              <span className="field-label">HappyHorse 原生视频 API Root <small>{sourceHint(settings.happyhorse?.baseUrlSource || "default")}</small></span>
              <input value={happyhorseBaseUrl} onChange={e=>setHappyhorseBaseUrl(e.target.value)} placeholder="例如：https://dashscope-intl.aliyuncs.com（留空继承通用）"/>
              <span className="muted mini">当前生效 Base URL：{settings.happyhorse?.baseUrl || "新加坡公共地址 dashscope-intl.aliyuncs.com"}</span>
            </div>
            {typedHhIssue && <div className="error-banner">{typedHhIssue}</div>}
          </div>
        )}

        {channelTab === "wan" && (
          <div className="form-stack" style={{marginTop:14}}>
            <div className="muted mini" style={{marginBottom:4,lineHeight:1.4}}>
              <strong>🌊 Wan（万相 3.0）专属通道：</strong>负责 2–30 秒超长原生生成、首尾画面过渡、视频多模态参考、原生视频延长（最长 30 秒）、整条视频指令编辑。支持 480P/720P/1080P、30fps、原生音频。推荐北京独享空间或新加坡地域。留空项自动继承通用百炼配置。
            </div>
            {settings.wan?.blockedReason && <div className="error-banner">Wan 通道已停止用于新任务：{settings.wan.blockedReason}</div>}
            <div className="field">
              <span className="field-label">Wan 专属 API Key <small>{credentialHint(Boolean(settings.wan?.apiKeyConfigured), settings.wan?.apiKeyMasked || "", settings.wan?.apiKeySource || "default")}</small></span>
              <input type="password" autoComplete="new-password" value={wanApiKey} onChange={e=>{setWanApiKey(e.target.value);setClearWanApiKey(false)}} placeholder={settings.wan?.isOverridden?.apiKey ? "留空保持现有专属 Key" : "留空则自动继承通用百炼 Key"}/>
              {wanApiKey.trim().toLowerCase().startsWith("sk-sp-") && <span className="mini error-text">这是 Token Plan 专属 Key，不支持直连。</span>}
              {settings.wan?.isOverridden?.apiKey && <button type="button" className="secondary" onClick={()=>setClearWanApiKey(v=>!v)}>{clearWanApiKey ? "取消清除" : "清除专属 Key（恢复继承通用）"}</button>}
              {clearWanApiKey && <span className="mini error-text">保存后将删除 Wan 独立 Key 并恢复继承通用百炼 Key。</span>}
            </div>
            <div className="field">
              <span className="field-label">Wan 专属 Workspace ID <small>{sourceHint(settings.wan?.workspaceIdSource || "default")}</small></span>
              <input value={wanWorkspaceId} onChange={e=>setWanWorkspaceId(e.target.value)} placeholder={settings.wan?.workspaceId ? `当前生效：${settings.wan.workspaceId}（留空继承通用）` : "例如：ws-z77q317bngeiixd0（留空继承通用）"}/>
            </div>
            <div className="field">
              <span className="field-label">Wan 原生视频 API Root <small>{sourceHint(settings.wan?.baseUrlSource || "default")}</small></span>
              <input value={wanBaseUrl} onChange={e=>setWanBaseUrl(e.target.value)} placeholder="例如：https://ws-z77q317bngeiixd0.cn-beijing.maas.aliyuncs.com（留空继承通用）"/>
              <span className="muted mini">当前生效 Base URL：{settings.wan?.baseUrl || "未单独配置（将根据 Workspace 或通用配置生成）"}</span>
            </div>
            {typedWanIssue && <div className="error-banner">{typedWanIssue}</div>}
          </div>
        )}
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
          <div className="muted mini" style={{marginTop:4}}>历史任务仍按提交时记录的 provider 与 endpoint 查询，不会因为切换引擎而串线。</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="secondary" disabled={checking} onClick={checkStatus}><RefreshCw size={15}/>{checking?"检查中…":"检查配置"}</button>
          <button className="primary" disabled={saving} onClick={save}><Save size={15}/>{saving?"保存中…":"保存设置"}</button>
        </div>
      </div>
      {status && <div className="muted mini" style={{marginTop:12}}>
        当前模式：{modeLabel(status.providerMode)} · 百炼总体：{status.modelStudio?.configured?"已配置":"未配置"}
        {status.modelStudio?.channels && `（HappyHorse：${status.modelStudio.channels.happyhorse?.configured?"已就绪":"未配置"} · Wan：${status.modelStudio.channels.wan?.configured?"已就绪":"未配置"}）`}
        · 万镜一刻：{status.yike?.configured?"已配置":"未配置"}
        {status.connected === true ? " · 万镜一刻连接正常" : status.connected === false ? ` · ${status.yikeError || status.error || "连接检查未通过"}` : status.note ? ` · ${status.note}` : ""}
      </div>}
    </section>
  </div>;
}

function sourceHint(source: Source) {
  if (source === "ui") return "专属设置（来自界面）";
  if (source === "environment") return "专属设置（来自环境变量）";
  if (source === "inherited_ui") return "继承自通用百炼设置";
  if (source === "inherited_env") return "继承自通用环境变量";
  return "未单独配置";
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
