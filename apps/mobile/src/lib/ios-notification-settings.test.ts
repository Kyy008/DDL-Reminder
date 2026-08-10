import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  getStatus: vi.fn(),
  isNativePlatform: vi.fn(),
  openSettings: vi.fn()
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: nativeMocks.getPlatform,
    isNativePlatform: nativeMocks.isNativePlatform
  },
  registerPlugin: vi.fn(() => ({
    getStatus: nativeMocks.getStatus,
    openSettings: nativeMocks.openSettings
  }))
}));

import {
  canUseIOSNotificationSettings,
  getIOSNotificationSettingsStatus,
  normalizeIOSNotificationSettingsStatus,
  openIOSNotificationSettings
} from "./ios-notification-settings";

describe("iOS notification settings bridge", () => {
  beforeEach(() => {
    nativeMocks.getPlatform.mockReset();
    nativeMocks.getStatus.mockReset();
    nativeMocks.isNativePlatform.mockReset();
    nativeMocks.openSettings.mockReset();
  });

  it("does nothing outside a native iOS app", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(false);
    nativeMocks.getPlatform.mockReturnValue("web");

    expect(canUseIOSNotificationSettings()).toBe(false);
    await expect(getIOSNotificationSettingsStatus()).resolves.toBeNull();
    await expect(openIOSNotificationSettings()).resolves.toBe(false);
    expect(nativeMocks.getStatus).not.toHaveBeenCalled();
    expect(nativeMocks.openSettings).not.toHaveBeenCalled();
  });

  it("reads iOS delivery settings and opens the system settings page", async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("ios");
    nativeMocks.getStatus.mockResolvedValue({
      alert: "enabled",
      sound: "disabled",
      lockScreen: "enabled",
      notificationCenter: "enabled",
      scheduledDelivery: "notSupported"
    });
    nativeMocks.openSettings.mockResolvedValue({ opened: true });

    expect(canUseIOSNotificationSettings()).toBe(true);
    await expect(getIOSNotificationSettingsStatus()).resolves.toEqual({
      alert: "enabled",
      sound: "disabled",
      lockScreen: "enabled",
      notificationCenter: "enabled",
      scheduledDelivery: "notSupported"
    });
    await expect(openIOSNotificationSettings()).resolves.toBe(true);
  });

  it("normalizes unexpected native values instead of trusting the bridge", () => {
    expect(
      normalizeIOSNotificationSettingsStatus({
        alert: "enabled",
        sound: "surprise"
      })
    ).toEqual({
      alert: "enabled",
      sound: "unknown",
      lockScreen: "unknown",
      notificationCenter: "unknown",
      scheduledDelivery: "unknown"
    });
  });
});
