"use client";

import { useWallpaper } from "./wallpaper-provider";

export function WallpaperSettings() {
  const {
    busyAction,
    chooseWallpaper,
    config,
    isBusy,
    isLoading,
    mainImageUrl,
    notice,
    resetWallpaper
  } = useWallpaper();
  const customMain = config.custom?.main;

  return (
    <section
      aria-busy={isBusy}
      className="flex flex-col gap-4 py-5"
      aria-labelledby="wallpaper-title"
    >
      <div>
        <h2 className="text-sm font-semibold" id="wallpaper-title">
          App 背景
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
          图片只保存在本机 App
          中。导入时会自动校正方向、去除拍摄位置等照片信息并压缩；切换横竖屏时也会自动适配。是否跟随系统备份，由手机设置决定。
        </p>
      </div>

      <div className="wallpaper-preview-grid">
        <WallpaperPreview
          label="竖屏预览"
          mainImageUrl={mainImageUrl}
          orientation="portrait"
        />
        <WallpaperPreview
          label="横屏预览"
          mainImageUrl={mainImageUrl}
          orientation="landscape"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          className="h-11 rounded-md bg-[var(--success)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--success-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy || isLoading}
          onClick={() => void chooseWallpaper()}
          type="button"
        >
          {busyAction === "choose" || busyAction === "restore"
            ? "正在处理…"
            : "选择本机图片"}
        </button>
        <button
          className="h-11 rounded-md border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-semibold text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy || isLoading || !config.custom}
          onClick={() => void resetWallpaper()}
          type="button"
        >
          {busyAction === "reset" ? "恢复中…" : "恢复默认背景"}
        </button>
      </div>

      <p className="text-xs leading-5 text-[var(--muted-foreground)]">
        {customMain
          ? `正在使用自定义背景（约 ${formatBytes(customMain.bytes)}）。`
          : "正在使用默认背景。"}
        支持 30 MB 以内的图片，导入后会自动压缩。
      </p>

      {notice ? (
        <p
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
          className={`rounded-md border px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)]"
              : "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-text)]"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

function WallpaperPreview({
  label,
  mainImageUrl,
  orientation
}: {
  label: string;
  mainImageUrl: string;
  orientation: "landscape" | "portrait";
}) {
  return (
    <figure>
      <div
        aria-hidden="true"
        className={`wallpaper-preview wallpaper-preview-${orientation}`}
      >
        <span
          className="wallpaper-preview-main"
          style={{ backgroundImage: `url(${mainImageUrl})` }}
        />
        <span className="wallpaper-preview-overlay" />
      </div>
      <figcaption className="mt-1 text-center text-xs text-[var(--muted-foreground)]">
        {label}
      </figcaption>
    </figure>
  );
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
