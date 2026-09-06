"use client";

import { useState } from "react";
import Link from "next/link";
import { Clapperboard, LoaderCircle, ShieldAlert } from "lucide-react";

export interface AuthFormProps {
  mode: "login" | "register";
  siteName: string;
  /** 免费套餐从商品目录读取，页面文案不再写死额度数字（§44 禁止双真值）。 */
  freePlan: { name: string; credits: number; validityDays: number };
  registrationEnabled: boolean;
}

export default function AuthForm({ mode, siteName, freePlan, registrationEnabled }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = mode === "register" && !registrationEnabled;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (closed) {
      setError("当前没有开放注册，请联系客服");
      return;
    }
    if (mode === "register" && !agreed) {
      setError("请先阅读并同意《用户协议》和《隐私政策》");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { email, name, password, termsAccepted: agreed }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作失败");
      const next = new URLSearchParams(window.location.search).get("next") || "/studio";
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return <div className="auth-wrap">
    <form className="auth-card" onSubmit={submit}>
      <Link href="/" className="brand">
        <span className="brand-mark"><Clapperboard size={19}/></span>
        <div><strong>{siteName}</strong><span>AI 视频创作平台</span></div>
      </Link>
      <h1>{mode === "login" ? "登录工作台" : "创建账号"}</h1>
      <p className="muted">{mode === "login"
        ? "登录后继续你的创作、任务与作品管理。"
        : `注册即可获得${freePlan.name}，每 ${freePlan.validityDays} 天 ${freePlan.credits} 个创作额度，可体验全部创作能力。`}</p>
      {closed && <div className="error-banner warning"><ShieldAlert size={15}/>当前没有开放注册，请联系客服开通。</div>}
      <label className="field">
        <span className="field-label">邮箱</span>
        <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required disabled={closed}/>
      </label>
      {mode === "register" && (
        <label className="field">
          <span className="field-label">昵称</span>
          <input type="text" value={name} onChange={event => setName(event.target.value)} placeholder="你的名字或工作室名称" autoComplete="name" required maxLength={60} disabled={closed}/>
        </label>
      )}
      <label className="field">
        <span className="field-label">密码{mode === "register" ? <small>至少 8 位</small> : null}</span>
        <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1} disabled={closed}/>
      </label>
      {mode === "register" && (
        <label className="auth-agree">
          <input type="checkbox" checked={agreed} disabled={closed} onChange={event => setAgreed(event.target.checked)}/>
          <span>我已阅读并同意<Link href="/legal/terms" target="_blank" rel="noreferrer">《用户协议》</Link>
            和<Link href="/legal/privacy" target="_blank" rel="noreferrer">《隐私政策》</Link></span>
        </label>
      )}
      {error && <div className="error-text">{error}</div>}
      <button className="primary" type="submit" disabled={busy || closed}>
        {busy && <LoaderCircle className="spin" size={15}/>}{mode === "login" ? "登录" : "注册并进入"}
      </button>
      {mode === "login" ? <div className="auth-inline">
        <span className="muted">还没有账号？<Link href="/register">免费注册</Link></span>
        <Link href="/reset-password">忘记密码</Link>
      </div> : <div className="auth-switch">
        <span className="muted">已有账号？<Link href="/login">直接登录</Link></span>
      </div>}
    </form>
  </div>;
}
