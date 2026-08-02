import type { Metadata, Viewport } from "next";
import { WALLPAPER_BOOTSTRAP_SCRIPT } from "@/lib/wallpaper-bootstrap";
import { TopNav } from "./top-nav";
import { WallpaperProvider } from "./wallpaper-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "DDL-Reminder",
  description:
    "Track deadlines, progress, and reminders in one focused dashboard.",
  icons: {
    icon: "/icon/tubiao.png",
    apple: "/icon/tubiao.png"
  }
};

export const viewport: Viewport = {
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: "#f7faf4"
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: "#0c0d0b"
    }
  ]
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link as="image" href="/background.png" rel="preload" />
        <script
          dangerouslySetInnerHTML={{
            __html: WALLPAPER_BOOTSTRAP_SCRIPT
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var themeMode = window.localStorage.getItem("ddl-reminder:theme-mode") || "dark";
  var root = document.documentElement;
  if (themeMode === "light" || themeMode === "dark") {
    root.dataset.theme = themeMode;
    root.style.colorScheme = themeMode;
  } else {
    root.removeAttribute("data-theme");
    root.style.colorScheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
} catch (_) {}
            `.trim()
          }}
        />
      </head>
      <body>
        <WallpaperProvider>
          <TopNav />
          <div className="pt-16">{children}</div>
        </WallpaperProvider>
      </body>
    </html>
  );
}
