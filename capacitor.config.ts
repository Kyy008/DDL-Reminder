/// <reference types="@capacitor/local-notifications" />
/// <reference types="@capacitor/splash-screen" />

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.kyy.ddlreminder",
  appName: "DDL Reminder",
  loggingBehavior: "none",
  webDir: "out",
  android: {
    loggingBehavior: "none",
    webContentsDebuggingEnabled: false
  },
  plugins: {
    LocalNotifications: {
      iconColor: "#4bae50"
    },
    SplashScreen: {
      backgroundColor: "#f7faf4ff",
      launchAutoHide: true,
      launchFadeOutDuration: 160,
      launchShowDuration: 7000,
      showSpinner: false
    }
  }
};

export default config;
