import { describe, expect, it } from "vitest";
import type { NotificationDiagnostics } from "@/lib/local-reminder-scheduler";
import {
  getChannelStatus,
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
