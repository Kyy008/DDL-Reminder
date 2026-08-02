import {
  Capacitor,
  registerPlugin,
  SystemBars,
  SystemBarsStyle
} from "@capacitor/core";

type SystemBarTheme = "light" | "dark";

type DdlSystemBarsPlugin = {
  apply: (options: { theme: SystemBarTheme }) => Promise<void>;
};

const DdlSystemBars = registerPlugin<DdlSystemBarsPlugin>("DdlSystemBars");

export function applyNativeSystemBars(theme: SystemBarTheme) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return;
  }

  void applyAndroidSystemBars(theme);
}

async function applyAndroidSystemBars(theme: SystemBarTheme) {
  try {
    await SystemBars.setStyle({
      style: theme === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Dark
    });
    await DdlSystemBars.apply({ theme });
  } catch {
    // System bar styling should never prevent the app UI from loading.
  }
}
