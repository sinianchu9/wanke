"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, LogOut, MailCheck, MonitorSmartphone, Save, ShieldAlert, UserRound } from "lucide-react";

type Preferences = {
  creation: {
    aspectRatio: string;
    resolution: string;
    subtitleEnabled: boolean;
    language: string;
    defaultDuration: number;
    favoriteTool: string;
  };
  notifications: Record<string, boolean>;
  options: { aspectRatios: string[]; resolutions: string[]; languages: Array<{ value: string; label: string }>; durations: number[] };
};

type SessionRow = { id: string; device: string; ip: string; current: boolean; lastActiveAt: string; createdAt: string };

const TOOL_OPTIONS = [
  { value: "", label: "不固定，每次自己选" },
  { value: "home", label: "对话式新建创作" },
  { value: "quick", label: "快速向导" },
  { value: "generate", label: "高级创作" },
  { value: "clone", label: "快速复刻" },
  { value: "avatar", label: "数字人口播" },
  { value: "voice", label: "旁白成片" },
  { value: "storyboard", label: "故事板" },
];

async function call(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "操作没有成功，请稍后再试");
  return body;
}

export default function UserSettingsPanel({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [profile, setProfile] = useState<any>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [site, setSite] = useState<{ requireEmailVerification?: boolean; emailEnabled?: boolean } | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [logoutOthers, setLogoutOthers] = useState(true);
  const [closePassword, setClosePassword] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [profileBody, preferenceBody, sessionBody] = await Promise.all([
      call("/api/account/profile"),
      call("/api/account/preferences"),
      call("/api/account/sessions"),
    ]);
    setProfile(profileBody.profile);
    setName(profileBody.profile.name);
    setAvatarUrl(profileBody.profile.avatarUrl || "");
    setPreferences(preferenceBody.preferences);
    setSessions(sessionBody.sessions || []);
    setSite(profileBody.site || null);
  }, []);

  useEffect(() => {
    load().catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setNotice("");
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function saveProfile() {
    await run("profile", async () => {
      const body = await call("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), avatarUrl: avatarUrl.trim() || null }),
      });
      setProfile(body.profile);
      setNotice("个人资料已保存。");
      await onChanged();
    });
  }

  async function savePreference(patch: Record<string, unknown>, group: "creation" | "notifications") {
    await run(group, async () => {
      const body = await call("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [group]: patch }),
      });
      setPreferences(body.preferences);
      setNotice(group === "creation" ? "创作偏好已保存，下次创作会自动使用。" : "通知设置已保存。");
    });
  }

  async function changePassword() {
    if (newPassword !== repeatPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    await run("password", async () => {
      const body = await call("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, logoutOthers }),
      });
      setCurrentPassword(""); setNewPassword(""); setRepeatPassword("");
      setNotice(`密码已修改${body.revokedSessions ? `，其他 ${body.revokedSessions} 个登录已退出。` : "。"}`);
      const sessionBody = await call("/api/account/sessions");
      setSessions(sessionBody.sessions || []);
    });
  }

  async function revoke(scope: "others" | "all") {
    await run(`revoke-${scope}`, async () => {
      await call("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (scope === "all") {
        window.location.href = "/login";
        return;
      }
      const sessionBody = await call("/api/account/sessions");
      setSessions(sessionBody.sessions || []);
      setNotice("其他设备的登录已经退出。");
    });
  }

  async function sendVerification() {
    await run("verify-email", async () => {
      const body = await call("/api/account/verify-email", { method: "POST" });
      setNotice(body.notice || "验证邮件已经发送，请到邮箱点击链接完成验证。");
    });
  }

  async function closeAccount() {
    if (!closePassword.trim()) {
      setError("注销账号需要输入登录密码确认");
      return;
    }
    if (!confirm("注销后你将无法登录该账号，作品与订单会按平台规则保留。确定继续吗？")) return;
    await run("close", async () => {
      await call("/api/account/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: closePassword, confirm: true }),
      });
      window.location.href = "/";
    });
  }

  if (!profile || !preferences) {
    return <div className="works-empty"><LoaderCircle className="spin" size={22} />正在加载设置…</div>;
  }

  const creation = preferences.creation;
  const notifications = preferences.notifications;

  return <div className="content-stack">
    <div className="hero-card compact">
      <div>
        <div className="eyebrow">账号设置</div>
        <h2>个人资料与创作偏好</h2>
        <p>这里只管理你自己的账号信息。创作服务的运行配置由平台统一维护，你不需要关心。</p>
      </div>
      <div className="upload-box" style={{ cursor: "default" }}>
        <UserRound size={26} />
        <strong>{profile.name}</strong>
        <span>{profile.email}</span>
      </div>
    </div>

    {notice && <div className="notice" style={{ margin: 0 }}><CheckCircle2 size={16} />{notice}</div>}
    {error && <div className="error-banner">{error}</div>}
    {!profile.emailVerified && site?.requireEmailVerification && (
      <div className="error-banner warning">
        <MailCheck size={16} />邮箱还没有验证，验证通过之前不能开始新的创作。发送验证邮件后点击邮件中的链接即可完成。
      </div>
    )}

    <section className="panel">
      <div className="panel-title"><div><h3>个人资料</h3><p>昵称和头像会显示在你的工作台里。</p></div></div>
      <div className="form-grid two" style={{ marginTop: 12 }}>
        <div className="field">
          <span className="field-label">昵称</span>
          <input value={name} maxLength={40} onChange={event => setName(event.target.value)} placeholder="你的昵称" />
        </div>
        <div className="field">
          <span className="field-label">头像图片地址 <small>可留空</small></span>
          <input value={avatarUrl} onChange={event => setAvatarUrl(event.target.value)} placeholder="https://" />
        </div>
        <div className="field">
          <span className="field-label">登录邮箱</span>
          <input value={profile.email} disabled />
          <span className="muted mini">{profile.emailVerified ? "邮箱已验证" : "邮箱尚未验证，验证后可以用于找回密码"}</span>
        </div>
        <div className="field">
          <span className="field-label">账号状态</span>
          <input value={profile.statusText} disabled />
          <span className="muted mini">注册时间 {new Date(profile.createdAt).toLocaleDateString("zh-CN")}</span>
        </div>
      </div>
      <div className="inline-actions" style={{ marginTop: 12 }}>
        <button className="primary" disabled={busy === "profile" || !name.trim()} onClick={saveProfile}>
          {busy === "profile" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}保存资料
        </button>
      </div>
    </section>

    <section className="panel">
      <div className="panel-title">
        <div>
          <h3><MailCheck size={15} style={{ verticalAlign: "-2px" }} /> 验证邮箱</h3>
          <p>验证后可以用于找回密码{site?.requireEmailVerification ? "，验证通过之前不能开始新的创作" : ""}。</p>
        </div>
        <div className="inline-actions">
          {profile.emailVerified
            ? <span className="stage-state succeeded">已验证</span>
            : <button className="primary" disabled={busy === "verify-email"} onClick={sendVerification}>
                {busy === "verify-email" ? <LoaderCircle className="spin" size={14} /> : <MailCheck size={14} />}发送验证邮件
              </button>}
        </div>
      </div>
      <p className="muted mini" style={{ margin: "10px 0 0" }}>
        {profile.emailVerified
          ? `验证邮箱 ${profile.email}${profile.emailVerifiedAt ? ` · 验证于 ${new Date(profile.emailVerifiedAt).toLocaleString("zh-CN")}` : ""}`
          : `验证邮件会发送到 ${profile.email}。没有收到时请先检查垃圾邮件箱，1 分钟后可以再发送一次。`}
      </p>
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3>创作偏好</h3><p>提交创作时会作为默认值，你仍然可以在每次创作时调整。</p></div></div>
      <div className="form-grid two" style={{ marginTop: 12 }}>
        <div className="field">
          <span className="field-label">默认画幅</span>
          <select value={creation.aspectRatio} disabled={busy === "creation"} onChange={event => savePreference({ aspectRatio: event.target.value }, "creation")}>
            {preferences.options.aspectRatios.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">默认清晰度</span>
          <select value={creation.resolution} disabled={busy === "creation"} onChange={event => savePreference({ resolution: event.target.value }, "creation")}>
            {preferences.options.resolutions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">默认字幕</span>
          <select value={creation.subtitleEnabled ? "on" : "off"} disabled={busy === "creation"} onChange={event => savePreference({ subtitleEnabled: event.target.value === "on" }, "creation")}>
            <option value="off">不加字幕</option>
            <option value="on">自动加字幕</option>
          </select>
        </div>
        <div className="field">
          <span className="field-label">默认语言</span>
          <select value={creation.language} disabled={busy === "creation"} onChange={event => savePreference({ language: event.target.value }, "creation")}>
            {preferences.options.languages.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">默认视频长度</span>
          <select value={creation.defaultDuration} disabled={busy === "creation"} onChange={event => savePreference({ defaultDuration: Number(event.target.value) }, "creation")}>
            {preferences.options.durations.map(option => <option key={option} value={option}>{option} 秒</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">常用创作方式</span>
          <select value={creation.favoriteTool} disabled={busy === "creation"} onChange={event => savePreference({ favoriteTool: event.target.value }, "creation")}>
            {TOOL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3>通知设置</h3><p>重要业务通知会同时出现在站内通知里，不会只依赖邮件。</p></div></div>
      <div className="form-stack" style={{ marginTop: 12 }}>
        {([
          ["job", "创作提醒", "视频生成完成或没有完成时通知我"],
          ["quota", "额度提醒", "创作额度即将用完时通知我"],
          ["order", "订单提醒", "支付成功、会员到期、退款完成时通知我"],
          ["system", "系统通知", "平台公告与反馈回复时通知我"],
          ["email", "邮件通知", "同时把上述通知发送到我的邮箱"],
        ] as Array<[string, string, string]>).map(([key, label, help]) => (
          <div className="toggle-row" key={key}>
            <div>
              <strong>{label}</strong>
              <span className="muted mini">{help}</span>
            </div>
            <button
              type="button"
              className={`toggle ${notifications[key] ? "active" : ""}`}
              role="switch"
              aria-checked={Boolean(notifications[key])}
              aria-label={label}
              disabled={busy === "notifications"}
              onClick={() => savePreference({ [key]: !notifications[key] }, "notifications")}
            />
          </div>
        ))}
      </div>
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3><KeyRound size={15} style={{ verticalAlign: "-2px" }} /> 修改密码</h3><p>修改成功后可以选择退出其他设备的登录。</p></div></div>
      <div className="form-grid two" style={{ marginTop: 12 }}>
        <div className="field">
          <span className="field-label">当前密码</span>
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">新密码 <small>至少 8 位</small></span>
          <input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">确认新密码</span>
          <input type="password" autoComplete="new-password" value={repeatPassword} onChange={event => setRepeatPassword(event.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">其他设备</span>
          <div className="toggle-row">
            <span className="muted mini">修改后退出其他登录</span>
            <button type="button" className={`toggle ${logoutOthers ? "active" : ""}`} role="switch" aria-checked={logoutOthers} aria-label="修改后退出其他登录" onClick={() => setLogoutOthers(value => !value)} />
          </div>
        </div>
      </div>
      <div className="inline-actions" style={{ marginTop: 12 }}>
        <button className="primary" disabled={busy === "password" || !currentPassword || newPassword.length < 8} onClick={changePassword}>
          {busy === "password" ? <LoaderCircle className="spin" size={14} /> : <KeyRound size={14} />}修改密码
        </button>
      </div>
    </section>

    <section className="panel">
      <div className="panel-title">
        <div><h3><MonitorSmartphone size={15} style={{ verticalAlign: "-2px" }} /> 登录状态</h3><p>这里显示当前有效的登录，发现陌生设备请立即退出并修改密码。</p></div>
        <div className="inline-actions">
          <button className="secondary" disabled={busy === "revoke-others" || sessions.length <= 1} onClick={() => revoke("others")}>
            {busy === "revoke-others" ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}退出其他登录
          </button>
          <button className="secondary" disabled={busy === "revoke-all"} onClick={() => revoke("all")}>全部退出</button>
        </div>
      </div>
      <table className="admin-table" style={{ marginTop: 12 }}>
        <thead><tr><th>设备</th><th>登录时间</th><th>最近活动</th><th>状态</th></tr></thead>
        <tbody>
          {sessions.map(session => (
            <tr key={session.id}>
              <td>{session.device}{session.ip ? <span className="muted mini"> · {session.ip}</span> : null}</td>
              <td>{new Date(session.createdAt).toLocaleString("zh-CN")}</td>
              <td>{new Date(session.lastActiveAt).toLocaleString("zh-CN")}</td>
              <td>{session.current ? <span className="stage-state succeeded">当前登录</span> : <span className="stage-state queued">其他登录</span>}</td>
            </tr>
          ))}
          {sessions.length === 0 && <tr><td colSpan={4} className="muted">没有其他有效登录</td></tr>}
        </tbody>
      </table>
    </section>

    <section className="panel">
      <div className="panel-title"><div><h3><ShieldAlert size={15} style={{ verticalAlign: "-2px" }} /> 注销账号</h3><p>注销后无法登录，如需恢复请联系客服。仍有未完成的订单或反馈时需要先处理。</p></div></div>
      <div className="form-grid two" style={{ marginTop: 12 }}>
        <div className="field">
          <span className="field-label">登录密码确认</span>
          <input type="password" autoComplete="current-password" value={closePassword} onChange={event => setClosePassword(event.target.value)} />
        </div>
      </div>
      <div className="inline-actions" style={{ marginTop: 12 }}>
        <button className="danger" disabled={busy === "close" || !closePassword} onClick={closeAccount}>
          {busy === "close" ? <LoaderCircle className="spin" size={14} /> : null}申请注销账号
        </button>
      </div>
    </section>
  </div>;
}
