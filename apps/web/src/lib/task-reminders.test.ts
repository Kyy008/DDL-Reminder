import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPendingDeadlineReminderType,
  sendDueTaskRemindersForUser
} from "./task-reminders";

const mocks = vi.hoisted(() => ({
  sendTaskDeadlineReminderEmail: vi.fn()
}));

vi.mock("./mailer", () => ({
  sendTaskDeadlineReminderEmail: mocks.sendTaskDeadlineReminderEmail
}));

describe("getPendingDeadlineReminderType", () => {
  it("returns the approaching reminder after a task crosses the 48-hour threshold", () => {
    expect(
      getPendingDeadlineReminderType({
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        dueAt: new Date("2026-04-23T00:00:00.000Z"),
        now: new Date("2026-04-21T01:00:00.000Z"),
        sentReminderTypes: [],
        status: "ACTIVE"
      })
    ).toBe("DUE_IN_48H");
  });

  it("does not send an approaching reminder for a task created inside 48 hours", () => {
    expect(
      getPendingDeadlineReminderType({
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        dueAt: new Date("2026-04-21T00:00:00.000Z"),
        now: new Date("2026-04-20T01:00:00.000Z"),
        sentReminderTypes: [],
        status: "ACTIVE"
      })
    ).toBeNull();
  });

  it("returns the urgent reminder when an approaching task crosses the 2-hour threshold", () => {
    expect(
      getPendingDeadlineReminderType({
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        dueAt: new Date("2026-04-20T03:00:00.000Z"),
        now: new Date("2026-04-20T01:30:00.000Z"),
        sentReminderTypes: [],
        status: "ACTIVE"
      })
    ).toBe("DUE_IN_2H");
  });

  it("does not send an urgent reminder for a task created inside 2 hours", () => {
    expect(
      getPendingDeadlineReminderType({
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        dueAt: new Date("2026-04-20T01:00:00.000Z"),
        now: new Date("2026-04-20T00:30:00.000Z"),
        sentReminderTypes: [],
        status: "ACTIVE"
      })
    ).toBeNull();
  });

  it("does not send duplicate reminder types", () => {
    expect(
      getPendingDeadlineReminderType({
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        dueAt: new Date("2026-04-20T03:00:00.000Z"),
        now: new Date("2026-04-20T01:30:00.000Z"),
        sentReminderTypes: ["DUE_IN_2H"],
        status: "ACTIVE"
      })
    ).toBeNull();
  });

  it("uses custom reminder thresholds", () => {
    expect(
      getPendingDeadlineReminderType({
        approachingThresholdMs: 24 * 60 * 60 * 1000,
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        dueAt: new Date("2026-04-21T12:00:00.000Z"),
        now: new Date("2026-04-20T13:00:00.000Z"),
        sentReminderTypes: [],
        status: "ACTIVE",
        urgentThresholdMs: 30 * 60 * 1000
      })
    ).toBe("DUE_IN_48H");
  });
});

describe("sendDueTaskRemindersForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reserves a reminder log before sending the reminder email", async () => {
    const now = new Date("2026-04-21T01:00:00.000Z");
    const prisma = createPrismaMock([
      {
        id: "task_1",
        title: "Submit report",
        dueAt: new Date("2026-04-23T00:00:00.000Z"),
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        status: "ACTIVE",
        user: {
          email: "user@example.com",
          username: "Kyy"
        },
        reminderLogs: []
      }
    ]);

    await sendDueTaskRemindersForUser({
      now,
      prisma,
      userId: "user_1"
    });

    expect(prisma.reminderLog.create).toHaveBeenCalledWith({
      data: {
        taskId: "task_1",
        reminderType: "DUE_IN_48H",
        sentAt: now
      }
    });
    expect(mocks.sendTaskDeadlineReminderEmail).toHaveBeenCalledWith({
      dueAt: new Date("2026-04-23T00:00:00.000Z"),
      email: "user@example.com",
      reminderType: "DUE_IN_48H",
      taskTitle: "Submit report",
      username: "Kyy"
    });
  });

  it("skips reminder processing when the user disabled email reminders", async () => {
    const prisma = createPrismaMock([
      {
        id: "task_1",
        title: "Submit report",
        dueAt: new Date("2026-04-23T00:00:00.000Z"),
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        status: "ACTIVE",
        user: {
          email: "user@example.com",
          username: "Kyy"
        },
        reminderLogs: []
      }
    ]);
    prisma.user.findUnique.mockResolvedValueOnce({
      emailReminderEnabled: false,
      approachingReminderMinutes: 2880,
      urgentReminderMinutes: 120
    });

    await sendDueTaskRemindersForUser({
      now: new Date("2026-04-21T01:00:00.000Z"),
      prisma,
      userId: "user_1"
    });

    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(prisma.reminderLog.create).not.toHaveBeenCalled();
    expect(mocks.sendTaskDeadlineReminderEmail).not.toHaveBeenCalled();
  });

  it("uses the user's custom reminder thresholds when sending emails", async () => {
    const now = new Date("2026-04-20T11:00:00.000Z");
    const prisma = createPrismaMock([
      {
        id: "task_1",
        title: "Submit report",
        dueAt: new Date("2026-04-20T12:00:00.000Z"),
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        status: "ACTIVE",
        user: {
          email: "user@example.com",
          username: "Kyy"
        },
        reminderLogs: []
      }
    ]);
    prisma.user.findUnique.mockResolvedValueOnce({
      emailReminderEnabled: true,
      approachingReminderMinutes: 60,
      urgentReminderMinutes: 30
    });

    await sendDueTaskRemindersForUser({
      now,
      prisma,
      userId: "user_1"
    });

    expect(prisma.reminderLog.create).not.toHaveBeenCalled();
    expect(mocks.sendTaskDeadlineReminderEmail).not.toHaveBeenCalled();
  });

  it("releases the reminder log when email sending fails so it can retry later", async () => {
    const prisma = createPrismaMock([
      {
        id: "task_1",
        title: "Submit report",
        dueAt: new Date("2026-04-20T01:00:00.000Z"),
        createdAt: new Date("2026-04-19T22:00:00.000Z"),
        status: "ACTIVE",
        user: {
          email: "user@example.com",
          username: "Kyy"
        },
        reminderLogs: []
      }
    ]);
    mocks.sendTaskDeadlineReminderEmail.mockRejectedValueOnce(
      new Error("SMTP failed")
    );

    await sendDueTaskRemindersForUser({
      now: new Date("2026-04-20T00:00:00.000Z"),
      prisma,
      userId: "user_1"
    });

    expect(prisma.reminderLog.deleteMany).toHaveBeenCalledWith({
      where: {
        taskId: "task_1",
        reminderType: "DUE_IN_2H"
      }
    });
  });
});

function createPrismaMock(tasks: unknown[]) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        emailReminderEnabled: true,
        approachingReminderMinutes: 2880,
        urgentReminderMinutes: 120
      })
    },
    task: {
      findMany: vi.fn().mockResolvedValue(tasks)
    },
    reminderLog: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    }
  };
}
