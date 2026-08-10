import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  disablePrivacyScreen: vi.fn(),
  enablePrivacyScreen: vi.fn(),
  getExcluded: vi.fn(),
  getPlatform: vi.fn(),
  getPreference: vi.fn(),
  isNativePlatform: vi.fn(),
  setExcluded: vi.fn(),
  setPreference: vi.fn()
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: nativeMocks.getPlatform,
    isNativePlatform: nativeMocks.isNativePlatform
  },
  registerPlugin: vi.fn(() => ({
    getExcluded: nativeMocks.getExcluded,
    setExcluded: nativeMocks.setExcluded
  }))
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: nativeMocks.getPreference,
    set: nativeMocks.setPreference
  }
}));

vi.mock("@capacitor/privacy-screen", () => ({
  PrivacyScreen: {
    disable: nativeMocks.disablePrivacyScreen,
    enable: nativeMocks.enablePrivacyScreen
  }
}));

import {
  canControlBackgroundPrivacy,
  getBackgroundPrivacyEnabled,
  getBackgroundPrivacyKind,
  initializeBackgroundPrivacy,
  setBackgroundPrivacyEnabled
} from "./background-privacy";

describe("cross-platform background privacy", () => {
  beforeEach(() => {
    for (const mock of Object.values(nativeMocks)) {
      mock.mockReset();
    }
  });

  it("does nothing in a browser", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(false);
    nativeMocks.getPlatform.mockReturnValue("web");

    expect(getBackgroundPrivacyKind()).toBeNull();
    expect(canControlBackgroundPrivacy()).toBe(false);
    await expect(getBackgroundPrivacyEnabled()).resolves.toBe(false);
    await expect(setBackgroundPrivacyEnabled(true)).resolves.toBe(false);
  });

  it("keeps Android's real recent-task exclusion behavior", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("android");
    nativeMocks.getExcluded.mockResolvedValue({ excluded: true });
    nativeMocks.setExcluded.mockResolvedValue({ excluded: false });

    expect(getBackgroundPrivacyKind()).toBe("android-recents");
    await expect(getBackgroundPrivacyEnabled()).resolves.toBe(true);
    await expect(setBackgroundPrivacyEnabled(false)).resolves.toBe(false);
    expect(nativeMocks.setExcluded).toHaveBeenCalledWith({ excluded: false });
    expect(nativeMocks.enablePrivacyScreen).not.toHaveBeenCalled();
  });

  it("keeps iOS disabled by default and restores that state at startup", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("ios");
    nativeMocks.getPreference.mockResolvedValue({ value: null });
    nativeMocks.disablePrivacyScreen.mockResolvedValue({ success: true });

    expect(getBackgroundPrivacyKind()).toBe("ios-preview");
    await expect(initializeBackgroundPrivacy()).resolves.toBe(false);
    expect(nativeMocks.disablePrivacyScreen).toHaveBeenCalledOnce();
  });

  it("persists and enables the iOS app-switcher preview cover", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("ios");
    nativeMocks.enablePrivacyScreen.mockResolvedValue({ success: true });

    await expect(setBackgroundPrivacyEnabled(true)).resolves.toBe(true);
    expect(nativeMocks.enablePrivacyScreen).toHaveBeenCalledWith({
      ios: { blurEffect: "dark" }
    });
    expect(nativeMocks.setPreference).toHaveBeenCalledWith({
      key: "ddl-reminder:hide-background-preview",
      value: "true"
    });
  });
});
