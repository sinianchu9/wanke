import type { Metadata } from "next";
import { BaiduAnalytics } from "@/components/baidu-analytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "好秀，AI视频一键秀出来",
  description: "好秀 · 商业级 AI 视频创作平台。好秀，AI视频一键秀出来！把创意变成成片，一个工作台完成全部 AI 视频生产。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <BaiduAnalytics />
        {children}
      </body>
    </html>
  );
}
