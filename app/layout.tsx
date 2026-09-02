import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wanke · AI 视频生产平台",
  description: "面向创作者与小团队的商业级 AI 视频 SaaS：生成、复刻、口播、故事板与多语言翻译，一站完成。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
