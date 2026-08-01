import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  cancelAllLegacyNativeDdlAlarms: vi.fn(),
  checkExactNotificationSetting: vi.fn(),
  checkPermissions: vi.fn(),
  createChannel: vi.fn(),
  getPending: vi.fn(),
  getAndroidPowerStatus: vi.fn(),
  listChannels: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn()
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => "android",
    isNativePlatform: () => true
  }
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    cancel: nativeMocks.cancel,
    checkExactNotificationSetting: nativeMocks.checkExactNotificationSetting,
    checkPermissions: nativeMocks.checkPermissions,
    createChannel: nativeMocks.createChannel,
    getPending: nativeMocks.getPending,
    listChannels: nativeMocks.listChannels,
    requestPermissions: nativeMocks.requestPermissions,
    schedule: nativeMocks.schedule
  }
}));

vi.mock("./android-power", () => ({
  getAndroidPowerStatus: nativeMocks.getAndroidPowerStatus,
  openAndroidNotificationChannelSettings: vi.fn()
}));

vi.mock("./ddl-alarms", () => ({
  cancelAllLegacyNativeDdlAlarms: nativeMocks.cancelAllLegacyNativeDdlAlarms
}));

import {
  getNotificationStatusText,
  sendTestNotifications,
  syncAllTaskReminders,
  syncTaskReminders
} from "./local-reminder-scheduler";
import type { LocalSettings, LocalTask } from "./local-app-state";

const settings: LocalSettings = {
  localReminderEnabled: true,
  approachingReminderMinutes: 48 * 60,
  urgentReminderMinutes: 120
};

const futureTask: LocalTask = {
  id: "future_task",
  title: "Submit report",
  description: null,
  startAt: "2099-04-30T10:00:00.000Z",
  dueAt: "2099-05-03T10:00:00.000Z",
  status: "ACTIVE",
  createdAt: "2099-04-30T10:00:00.000Z",
  updatedAt: "2099-04-30T10:00:00.000Z"
};

describe("native local reminder scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeMocks.cancel.mockResolvedValue(undefined);
    nativeMocks.cancelAllLegacyNativeDdlAlarms.mockResolvedValue(0);
    nativeMocks.checkExactNotificationSetting.mockResolvedValue({
      exact_alarm: "granted"
    });
    nativeMocks.checkPermissions.mockResolvedValue({
      display: "granted"
    });
    nativeMocks.createChannel.mockResolvedValue(undefined);
    nativeMocks.getPending.mockResolvedValue({
      notifications: []
    });
    nativeMocks.getAndroidPowerStatus.mockResolvedValue(null);
    nativeMocks.listChannels.mockResolvedValue({
      channels: [
        {
          id: "ddl-reminders-v2",
          name: "任务提醒",
          importance: 4,
          vibration: true
        }
      ]
    });
    nativeMocks.requestPermissions.mockResolvedValue({
      display: "granted"
    });
    nativeMocks.schedule.mockResolvedValue({
      notifications: []
    });
  });

  it("uses Local Notifications with the non-alarm reminder channel", async () => {
    await expect(syncTaskReminders(futureTask, settings)).resolves.toBeNull();

    expect(nativeMocks.createChannel).toHaveBeenCalledWith({
      id: "ddl-reminders-v2",
      name: "任务提醒",
      description: "任务临近截止时发送通知",
      importance: 4,
      visibility: 0,
      vibration: true
    });
    expect(nativeMocks.schedule).toHaveBeenCalledOnce();
    expect(nativeMocks.schedule).toHaveBeenCalledWith({
      notifications: expect.arrayContaining([
        expect.objectContaining({
          channelId: "ddl-reminders-v2",
          smallIcon: "ic_stat_ddl",
          schedule: expect.objectContaining({
            allowWhileIdle: true
          })
        })
      ])
    });
  });

  it("uses an idle-safe alarm for the background notification test", async () => {
    await expect(sendTestNotifications()).resolves.toBeNull();

    expect(nativeMocks.schedule).toHaveBeenCalledWith({
      notifications: expect.arrayContaining([
        expect.objectContaining({
          id: 2_147_000_002,
          schedule: expect.objectContaining({
            allowWhileIdle: true
          })
        })
      ])
    });
  });

  it("schedules every close reminder instead of dropping later IDs", async () => {
    await syncAllTaskReminders(
      [
        futureTask,
        {
          ...futureTask,
          id: "nearby_task",
          title: "Nearby deadline",
          dueAt: "2099-05-03T10:04:00.000Z"
        }
      ],
      settings
    );

    const scheduledNotifications = nativeMocks.schedule.mock.calls[0][0]
      .notifications as Array<{ id: number }>;

    expect(scheduledNotifications).toHaveLength(6);
    expect(new Set(scheduledNotifications.map(({ id }) => id)).size).toBe(6);
  });

  it("skips notification-channel APIs on Android versions below API 26", async () => {
    nativeMocks.getAndroidPowerStatus.mockResolvedValue({
      sdkInt: 25
    });

    await expect(syncTaskReminders(futureTask, settings)).resolves.toBeNull();

    expect(nativeMocks.createChannel).not.toHaveBeenCalled();
    expect(nativeMocks.schedule).toHaveBeenCalledOnce();
  });

  it("does not show a permission prompt during automatic synchronization", async () => {
    nativeMocks.checkPermissions.mockResolvedValue({
      display: "prompt"
    });

    await expect(syncTaskReminders(futureTask, settings)).resolves.toContain(
      "通知权限还没打开"
    );

    expect(nativeMocks.requestPermissions).not.toHaveBeenCalled();
    expect(nativeMocks.schedule).not.toHaveBeenCalled();
  });

  it("cleans up legacy alarm-clock alarms before a full sync", async () => {
    await syncAllTaskReminders([], settings);

    expect(nativeMocks.cancelAllLegacyNativeDdlAlarms).toHaveBeenCalledOnce();
  });

  it("removes orphaned pending notifications during a full sync", async () => {
    nativeMocks.getPending.mockResolvedValue({
      notifications: [{ id: 999, title: "orphan", body: "orphan" }]
    });

    await syncAllTaskReminders([], settings);

    expect(nativeMocks.cancel).toHaveBeenCalledWith({
      notifications: [{ id: 999 }]
    });
  });

  it("keeps existing reminders when channel creation fails", async () => {
    nativeMocks.getPending.mockResolvedValue({
      notifications: [{ id: 999, title: "existing", body: "existing" }]
    });
    nativeMocks.createChannel.mockRejectedValue(
      new Error("channel unavailable")
    );

    await expect(syncAllTaskReminders([futureTask], settings)).rejects.toThrow(
      "channel unavailable"
    );
    expect(nativeMocks.schedule).not.toHaveBeenCalled();
    expect(nativeMocks.cancel).not.toHaveBeenCalled();
  });

  it("keeps existing reminders when scheduling fails", async () => {
    nativeMocks.getPending.mockResolvedValue({
      notifications: [{ id: 999, title: "existing", body: "existing" }]
    });
    nativeMocks.schedule.mockRejectedValue(new Error("scheduler unavailable"));

    await expect(syncAllTaskReminders([futureTask], settings)).rejects.toThrow(
      "scheduler unavailable"
    );
    expect(nativeMocks.cancel).not.toHaveBeenCalled();
  });

  it("fails closed when the exact-alarm setting cannot be checked", async () => {
    nativeMocks.checkExactNotificationSetting.mockRejectedValue(
      new Error("bridge unavailable")
    );

    await expect(syncTaskReminders(futureTask, settings)).resolves.toContain(
      "暂时无法确认“闹钟和提醒”权限"
    );
    expect(nativeMocks.schedule).toHaveBeenCalledOnce();

    await expect(getNotificationStatusText()).resolves.toContain(
      "“闹钟和提醒”：暂时无法检查，通知可能晚一些"
    );
  });

  it("reports the non-exact fallback when exact alarms are denied", async () => {
    nativeMocks.checkExactNotificationSetting.mockResolvedValue({
      exact_alarm: "denied"
    });

    await expect(getNotificationStatusText()).resolves.toContain(
      "“闹钟和提醒”：未允许，通知可能晚一些"
    );
  });

  it("reports when the reminder channel has been disabled", async () => {
    nativeMocks.listChannels.mockResolvedValue({
      channels: [
        {
          id: "ddl-reminders-v2",
          name: "任务提醒",
          importance: 0,
          vibration: false
        }
      ]
    });

    await expect(getNotificationStatusText()).resolves.toContain(
      "提醒通知：已关闭"
    );
  });
});
