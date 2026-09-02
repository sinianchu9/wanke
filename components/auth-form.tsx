"use client";

import { useState } from "react";
import Link from "next/link";
import { Clapperboard, LoaderCircle } from "lucide-react";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { email, name, password }),
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
        <div><strong>Wanke</strong><span>AI VIDEO PLATFORM</span></div>
      </Link>
      <h1>{mode === "login" ? "登录工作台" : "创建账号"}</h1>
      <p className="muted">{mode === "login"
        ? "登录后继续你的创作、任务与作品管理。"
        : "注册即获得免费套餐，每月 10 条生成额度，可体验全部创作能力。"}</p>
      <label className="field">
        <span className="field-label">邮箱</span>
        <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required/>
      </label>
      {mode === "register" && (
        <label className="field">
          <span className="field-label">昵称</span>
          <input type="text" value={name} onChange={event => setName(event.target.value)} placeholder="你的名字或工作室名称" autoComplete="name" required maxLength={60}/>
        </label>
      )}
      <label className="field">
        <span className="field-label">密码{mode === "register" ? <small>至少 8 位</small> : null}</span>
        <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1}/>
      </label>
      {error && <div className="error-text">{error}</div>}
      <button className="primary" type="submit" disabled={busy}>
        {busy && <LoaderCircle className="spin" size={15}/>}{mode === "login" ? "登录" : "注册并进入"}
      </button>
      <div className="auth-switch">
        {mode === "login"
          ? <span className="muted">还没有账号？<Link href="/register">免费注册</Link></span>
          : <span className="muted">已有账号？<Link href="/login">直接登录</Link></span>}
      </div>
    </form>
  </div>;
}
