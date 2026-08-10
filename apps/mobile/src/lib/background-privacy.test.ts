import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  getExcluded: vi.fn(),
  getPlatform: vi.fn(),
  isNativePlatform: vi.fn(),
  setExcluded: vi.fn()
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

import {
  canControlBackgroundPrivacy,
  getBackgroundPrivacyEnabled,
  getBackgroundPrivacyKind,
  setBackgroundPrivacyEnabled
} from "./background-privacy";

describe("Android background privacy", () => {
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
    expect(canControlBackgroundPrivacy()).toBe(true);
    await expect(getBackgroundPrivacyEnabled()).resolves.toBe(true);
    await expect(setBackgroundPrivacyEnabled(false)).resolves.toBe(false);
    expect(nativeMocks.setExcluded).toHaveBeenCalledWith({ excluded: false });
  });

  it("does not expose or apply background privacy on iOS", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("ios");

    expect(getBackgroundPrivacyKind()).toBeNull();
    expect(canControlBackgroundPrivacy()).toBe(false);
    await expect(getBackgroundPrivacyEnabled()).resolves.toBe(false);
    await expect(setBackgroundPrivacyEnabled(true)).resolves.toBe(false);
    expect(nativeMocks.getExcluded).not.toHaveBeenCalled();
    expect(nativeMocks.setExcluded).not.toHaveBeenCalled();
  });
});
