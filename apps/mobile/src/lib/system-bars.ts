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
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  void applySystemBars(theme);
}

async function applySystemBars(theme: SystemBarTheme) {
  try {
    await SystemBars.setStyle({
      style: theme === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Dark
    });

    if (Capacitor.getPlatform() === "android") {
      await DdlSystemBars.apply({ theme });
    }
  } catch {
    // System bar styling should never prevent the app UI from loading.
  }
}
