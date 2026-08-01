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
  canControlAndroidRecents,
  getAndroidRecentsExcluded,
  setAndroidRecentsExcluded
} from "./android-recents";

describe("Android recent-task bridge", () => {
  beforeEach(() => {
    nativeMocks.getExcluded.mockReset();
    nativeMocks.getPlatform.mockReset();
    nativeMocks.isNativePlatform.mockReset();
    nativeMocks.setExcluded.mockReset();
  });

  it("does nothing outside a native Android app", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(false);
    nativeMocks.getPlatform.mockReturnValue("web");

    expect(canControlAndroidRecents()).toBe(false);
    await expect(getAndroidRecentsExcluded()).resolves.toBe(false);
    await expect(setAndroidRecentsExcluded(true)).resolves.toBe(false);
    expect(nativeMocks.getExcluded).not.toHaveBeenCalled();
    expect(nativeMocks.setExcluded).not.toHaveBeenCalled();
  });

  it("reads and changes the Android setting", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("android");
    nativeMocks.getExcluded.mockResolvedValue({ excluded: true });
    nativeMocks.setExcluded.mockResolvedValue({ excluded: false });

    expect(canControlAndroidRecents()).toBe(true);
    await expect(getAndroidRecentsExcluded()).resolves.toBe(true);
    await expect(setAndroidRecentsExcluded(false)).resolves.toBe(false);
    expect(nativeMocks.setExcluded).toHaveBeenCalledWith({ excluded: false });
  });
});
