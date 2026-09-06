import Link from "next/link";

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

/**
 * Shared renderer for 用户协议 / 隐私政策. Both documents are referenced from the
 * registration form, so they have to exist and stay readable on a phone.
 */
export default function LegalDocument(props: {
  title: string;
  summary: string;
  siteName: string;
  contactEmail: string;
  updatedAt: string;
  sections: LegalSection[];
}) {
  return <div className="legal-wrap">
    <nav className="legal-nav">
      <Link href="/">← 返回首页</Link>
      <span>
        <Link href="/legal/terms">用户协议</Link>
        <Link href="/legal/privacy">隐私政策</Link>
      </span>
    </nav>
    <header className="legal-head">
      <h1>{props.title}</h1>
      <p className="muted">{props.summary}</p>
      <p className="muted mini">运营主体：{props.siteName} · 最近更新：{props.updatedAt}
        {props.contactEmail ? ` · 联系方式：${props.contactEmail}` : ""}</p>
    </header>
    <div className="legal-body">
      {props.sections.map(section => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {(section.paragraphs || []).map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          {section.items?.length ? <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul> : null}
        </section>
      ))}
      <p className="muted mini legal-foot">
        继续注册或使用{props.siteName}，即表示你已经阅读并同意本协议。
        {props.contactEmail ? `任何疑问可以通过 ${props.contactEmail} 联系我们。` : "任何疑问可以通过站内「帮助与反馈」联系我们。"}
      </p>
    </div>
  </div>;
}
