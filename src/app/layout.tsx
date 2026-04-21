import type { Metadata } from "next";
import { TopNav } from "./top-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "DDL Reminder",
  description:
    "Track deadlines, progress, and reminders in one focused dashboard.",
  icons: {
    icon: "/icon/tubiao.png",
    apple: "/icon/tubiao.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <TopNav />
        <div className="pt-16">{children}</div>
      </body>
    </html>
  );
}
