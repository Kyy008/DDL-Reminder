import { describe, expect, it } from "vitest";
import { getTaskReminderPlans } from "./local-reminder-scheduler";
import { LocalSettings, LocalTask } from "./local-app-state";

const settings: LocalSettings = {
  localReminderEnabled: true,
  approachingReminderMinutes: 48 * 60,
  urgentReminderMinutes: 120
};

const task: LocalTask = {
  id: "task_1",
  title: "Submit report",
  description: null,
  startAt: "2026-04-30T10:00:00.000Z",
  dueAt: "2026-05-03T10:00:00.000Z",
  status: "ACTIVE",
  createdAt: "2026-04-30T10:00:00.000Z",
  updatedAt: "2026-04-30T10:00:00.000Z"
};

describe("local reminder scheduler", () => {
  it("plans approaching, urgent, and due notifications for active tasks", () => {
    const plans = getTaskReminderPlans(
      task,
      settings,
      new Date("2026-04-30T10:00:00.000Z")
    );

    expect(plans).toMatchObject([
      {
        kind: "approaching",
        title: "快到截止时间了：Submit report",
        at: new Date("2026-05-01T10:00:00.000Z")
      },
      {
        kind: "urgent",
        title: "马上截止：Submit report",
        at: new Date("2026-05-03T08:00:00.000Z")
      },
      {
        kind: "due",
        title: "已到截止时间：Submit report",
        at: new Date("2026-05-03T10:00:00.000Z")
      }
    ]);
  });

  it("skips completed tasks and disabled reminders", () => {
    expect(
      getTaskReminderPlans(
        {
          ...task,
          status: "COMPLETED"
        },
        settings
      )
    ).toEqual([]);
    expect(
      getTaskReminderPlans(task, {
        ...settings,
        localReminderEnabled: false
      })
    ).toEqual([]);
  });

  it("skips lead-time reminder times that have already passed", () => {
    const plans = getTaskReminderPlans(
      task,
      settings,
      new Date("2026-05-03T07:00:00.000Z")
    );

    expect(plans.map((plan) => plan.kind)).toEqual(["urgent", "due"]);
  });

  it("keeps the due notification after both lead-time reminders have passed", () => {
    const plans = getTaskReminderPlans(
      task,
      settings,
      new Date("2026-05-03T09:00:00.000Z")
    );

    expect(plans).toMatchObject([
      {
        kind: "due",
        title: "已到截止时间：Submit report",
        at: new Date("2026-05-03T10:00:00.000Z")
      }
    ]);
  });

  it("deduplicates reminders that resolve to the same trigger time", () => {
    const plans = getTaskReminderPlans(
      task,
      {
        ...settings,
        approachingReminderMinutes: 0,
        urgentReminderMinutes: 0
      },
      new Date("2026-04-30T10:00:00.000Z")
    );

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      kind: "due",
      at: new Date("2026-05-03T10:00:00.000Z")
    });
  });

  it("keeps every reminder when trigger times are less than nine minutes apart", () => {
    const plans = getTaskReminderPlans(
      task,
      {
        ...settings,
        approachingReminderMinutes: 8,
        urgentReminderMinutes: 4
      },
      new Date("2026-05-03T09:00:00.000Z")
    );

    expect(plans).toHaveLength(3);
    expect(plans).toMatchObject([
      { kind: "approaching", at: new Date("2026-05-03T09:52:00.000Z") },
      { kind: "urgent", at: new Date("2026-05-03T09:56:00.000Z") },
      { kind: "due", at: new Date("2026-05-03T10:00:00.000Z") }
    ]);
  });
});
