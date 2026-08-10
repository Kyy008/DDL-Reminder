import { describe, expect, it } from "vitest";
import type { NotificationDiagnostics } from "@/lib/local-reminder-scheduler";
import {
  formatIOSNotificationSettings,
  getChannelStatus,
  getIOSNotificationSettingsSummary,
  isIOSNotificationSettingsFullyReady,
  isNotificationChannelFullyReady
} from "./notification-setup-guide";

function createDiagnostics(
  importance: number,
  applicable = true
): NotificationDiagnostics {
  return {
    channel: applicable
      ? {
          applicable: true,
          enabled: importance > 0,
          exists: true,
          importance,
          vibration: true
        }
      : {
          applicable: false,
          enabled: null,
          exists: null,
          importance: null,
          vibration: null
        },
    exactAlarm: "granted",
    isNative: true,
    notificationPermission: "granted",
    pendingCount: 1,
    platform: "android",
    power: null
  };
}

describe("notification setup channel guidance", () => {
  it("only treats Android importance 4 or higher as fully ready", () => {
    expect(isNotificationChannelFullyReady(createDiagnostics(4))).toBe(true);
    expect(isNotificationChannelFullyReady(createDiagnostics(3))).toBe(false);
  });

  it("warns that importance 3 may not show a heads-up notification", () => {
    expect(getChannelStatus(createDiagnostics(3))).toEqual({
      label: "可能没有横幅",
      tone: "manual"
    });
  });

  it("keeps lower and disabled channel states distinct", () => {
    expect(getChannelStatus(createDiagnostics(2))).toEqual({
      label: "提醒级别较低",
      tone: "manual"
    });
    expect(getChannelStatus(createDiagnostics(0))).toEqual({
      label: "需开启",
      tone: "required"
    });
  });

  it("counts notification channels as complete when Android does not support them", () => {
    const diagnostics = createDiagnostics(0, false);

    expect(isNotificationChannelFullyReady(diagnostics)).toBe(true);
    expect(getChannelStatus(diagnostics)).toEqual({
      label: "不适用",
      tone: "neutral"
    });
  });
});

describe("iOS notification settings guidance", () => {
  const readySettings = {
    alert: "enabled" as const,
    sound: "enabled" as const,
    lockScreen: "enabled" as const,
    notificationCenter: "enabled" as const,
    scheduledDelivery: "disabled" as const
  };

  it("treats visible, audible, immediate notifications as ready", () => {
    expect(getIOSNotificationSettingsSummary(readySettings)).toEqual({
      label: "正常",
      tone: "done"
    });
    expect(isIOSNotificationSettingsFullyReady(readySettings)).toBe(true);
  });

  it("explains silent and scheduled-summary delivery without calling it broken", () => {
    expect(
      getIOSNotificationSettingsSummary({
        ...readySettings,
        sound: "disabled"
      })
    ).toEqual({ label: "声音已关闭", tone: "manual" });
    expect(
      getIOSNotificationSettingsSummary({
        ...readySettings,
        scheduledDelivery: "enabled"
      })
    ).toEqual({ label: "可能延迟送达", tone: "manual" });
  });

  it("reports when every visible delivery location is disabled", () => {
    expect(
      getIOSNotificationSettingsSummary({
        ...readySettings,
        alert: "disabled",
        lockScreen: "disabled",
        notificationCenter: "disabled"
      })
    ).toEqual({ label: "显示已关闭", tone: "required" });
  });

  it("formats every iOS setting in plain language", () => {
    expect(formatIOSNotificationSettings(readySettings)).toBe(
      "横幅：已开启；声音：已开启；锁定屏幕：已开启；通知中心：已开启；定时摘要：已关闭"
    );
  });
});
