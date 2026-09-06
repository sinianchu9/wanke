"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clapperboard, KeyRound, LoaderCircle, MailCheck } from "lucide-react";

/**
 * 忘记密码：请求重置 and 设置新密码 share one page, chosen by the `token` in the link.
 *
 * The request step always reports the same sentence, so this page cannot be used to find
 * out which addresses are registered.
 */
export default function ResetPassword({ token }: { token: string }) {
  return token ? <SetPassword token={token} /> : <RequestReset />;
}

function Brand() {
  return <Link href="/" className="brand">
    <span className="brand-mark"><Clapperboard size={19} /></span>
    <div><strong>Wanke</strong><span>AI VIDEO PLATFORM</span></div>
  </Link>;
}

function RequestReset() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "请求没有成功，请稍后再试");
      setNotice(body.notice || "如果这个邮箱已经注册，我们已经发送了一封包含重置链接的邮件。");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-wrap">
    <form className="auth-card" onSubmit={submit}>
      <Brand />
      <h1>找回密码</h1>
      <p className="muted">输入注册时使用的邮箱，我们会发送一个一次性链接，用于设置新密码。</p>
      {sent ? <>
        <div className="auth-progress tone-success"><MailCheck size={16} />请求已受理</div>
        <p className="muted">{notice}</p>
        <p className="muted mini">没有收到？请检查垃圾邮件箱，或 1 分钟后重新请求一次；仍然收不到请联系客服。</p>
        <Link className="primary" href="/login">返回登录</Link>
      </> : <>
        <label className="field">
          <span className="field-label">邮箱</span>
          <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <button className="primary" type="submit" disabled={busy || !email.trim()}>
          {busy && <LoaderCircle className="spin" size={15} />}发送重置链接
        </button>
        <div className="auth-switch"><span className="muted">想起来了？<Link href="/login">直接登录</Link></span></div>
      </>}
    </form>
  </div>;
}

function SetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== repeat) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "密码没有重置成功");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-wrap">
    <form className="auth-card" onSubmit={submit}>
      <Brand />
      <h1>设置新密码</h1>
      {done ? <>
        <div className="auth-progress tone-success"><CheckCircle2 size={16} />密码已重置</div>
        <p className="muted">密码已经更新，原来的登录全部退出，请用新密码重新登录。</p>
        <Link className="primary" href="/login">去登录</Link>
      </> : <>
        <p className="muted">为安全起见，重置成功后所有设备的登录都会退出。这个链接只能使用一次。</p>
        <label className="field">
          <span className="field-label">新密码<small>至少 8 位</small></span>
          <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} />
        </label>
        <label className="field">
          <span className="field-label">确认新密码</span>
          <input type="password" value={repeat} onChange={event => setRepeat(event.target.value)} autoComplete="new-password" required minLength={8} />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <button className="primary" type="submit" disabled={busy || password.length < 8}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}保存新密码
        </button>
        <div className="auth-switch"><span className="muted">链接失效了？<Link href="/reset-password">重新申请一次</Link></span></div>
      </>}
    </form>
  </div>;
}
