import { Capacitor, registerPlugin } from "@capacitor/core";
import type { NativePreparedWallpaper } from "./wallpaper";

type AndroidWallpaperPlugin = {
  chooseAndPrepare: () => Promise<NativePreparedWallpaper>;
};

const AndroidWallpaper =
  registerPlugin<AndroidWallpaperPlugin>("AndroidWallpaper");

export function canUseAndroidWallpaperProcessor() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function chooseAndPrepareAndroidWallpaper() {
  if (!canUseAndroidWallpaperProcessor()) {
    throw new Error("请在 Android 版 App 中使用这项功能。");
  }

  return AndroidWallpaper.chooseAndPrepare();
}
