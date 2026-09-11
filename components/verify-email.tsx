"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clapperboard, LoaderCircle, MailX } from "lucide-react";

type State = "working" | "done" | "failed" | "missing";

/**
 * Mail-side endpoint of 邮箱验证. The token in the link is the only credential and is
 * consumed by the server exactly once; this page just reports what the server said.
 */
export default function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? "working" : "missing");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "验证没有成功");
        setEmail(body.email || "");
        setState("done");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
        setState("failed");
      }
    })();
  }, [token]);

  return <div className="auth-wrap">
    <div className="auth-card">
      <Link href="/" className="auth-brand-badge">
        <span className="brand-logo-wrap">
          <svg className="brand-gold-logo" viewBox="0 0 36 28" fill="none" width="28" height="22">
            <path
              d="M3 8C4.5 16 7.5 24 10.5 24C13.5 24 15.5 12 18 12C20.5 12 22.5 24 25.5 24C28.5 24 31.5 16 33 8"
              stroke="url(#veGoldGrad)"
              strokeWidth="4.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient id="veGoldGrad" x1="3" y1="8" x2="33" y2="24" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FFE8A3" />
                <stop offset="0.5" stopColor="#F5B942" />
                <stop offset="1" stopColor="#E08B14" />
              </linearGradient>
            </defs>
          </svg>
        </span>
        <div className="auth-brand-text">
          <strong className="auth-brand-name">好秀</strong>
          <span className="auth-brand-sub">AI VIDEO PLATFORM</span>
        </div>
      </Link>

      {state === "working" && <>
        <h1>正在验证邮箱</h1>
        <p className="muted">请稍等，正在确认这个链接。</p>
        <div className="auth-progress"><LoaderCircle className="spin" size={16} />正在验证…</div>
      </>}

      {state === "done" && <>
        <h1>邮箱验证成功</h1>
        <p className="muted">{email ? `${email} 已经验证通过。` : "你的邮箱已经验证通过。"}现在可以使用找回密码，创作也不再受限。</p>
        <div className="auth-progress tone-success"><CheckCircle2 size={16} />验证完成</div>
        <Link className="primary" href="/studio">进入工作台</Link>
        <div className="auth-switch"><span className="muted">需要切换账号？<Link href="/login">重新登录</Link></span></div>
      </>}

      {state === "failed" && <>
        <h1>这个链接不能使用</h1>
        <p className="muted">{message}</p>
        <div className="auth-progress tone-attention"><MailX size={16} />验证未完成</div>
        <Link className="primary" href="/login">登录后重新获取验证邮件</Link>
        <div className="auth-switch"><span className="muted">登录后在「账号设置 → 验证邮箱」里可以重新发送。</span></div>
      </>}

      {state === "missing" && <>
        <h1>链接不完整</h1>
        <p className="muted">这封验证邮件的链接缺少必要信息，请从邮件里重新打开，或登录后重新发送一封。</p>
        <Link className="primary" href="/login">去登录</Link>
      </>}
    </div>
  </div>;
}
