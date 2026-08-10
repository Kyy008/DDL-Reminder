import { Capacitor, registerPlugin } from "@capacitor/core";
import type { NativePreparedWallpaper } from "./wallpaper";

type NativeWallpaperPlugin = {
  chooseAndPrepare: () => Promise<NativePreparedWallpaper>;
};

const AndroidWallpaper =
  registerPlugin<NativeWallpaperPlugin>("AndroidWallpaper");
const IOSWallpaper = registerPlugin<NativeWallpaperPlugin>("IOSWallpaper");

export function canUseNativeWallpaperProcessor() {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  const platform = Capacitor.getPlatform();

  return platform === "android" || platform === "ios";
}

export async function chooseAndPrepareNativeWallpaper() {
  if (!canUseNativeWallpaperProcessor()) {
    throw new Error("请在安装后的 App 中使用这项功能。");
  }

  return Capacitor.getPlatform() === "ios"
    ? IOSWallpaper.chooseAndPrepare()
    : AndroidWallpaper.chooseAndPrepare();
}
