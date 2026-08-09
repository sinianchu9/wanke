import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wanke Video Studio",
  description: "万镜一刻个人视频生产工作站",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
