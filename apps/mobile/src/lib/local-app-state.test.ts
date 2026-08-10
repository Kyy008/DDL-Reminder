import { describe, expect, it } from "vitest";
import {
  completeTaskInState,
  createEmptyLocalAppState,
  createTaskInState,
  deleteTaskInState,
  LOCAL_APP_STATE_ERROR_MESSAGES,
  parseLocalAppState,
  updateSettingsInState,
  updateTaskInState
} from "./local-app-state";
import { TASK_ERROR_MESSAGES } from "./task-error-messages";

const NOW = new Date("2026-04-30T10:00:00.000Z");

describe("local app state", () => {
  it("creates a task with a DDL", () => {
    const result = createTaskInState(
      createEmptyLocalAppState(),
      {
        title: "Submit report",
        description: "",
        startAt: "2026-04-30T10:00:00.000Z",
        dueAt: "2026-05-01T10:00:00.000Z"
      },
      {
        id: "task_1",
        now: NOW
      }
    );

    expect(result.task).toMatchObject({
      id: "task_1",
      title: "Submit report",
      description: null,
      status: "ACTIVE",
      startAt: "2026-04-30T10:00:00.000Z",
      dueAt: "2026-05-01T10:00:00.000Z"
    });
    expect(result.state.tasks).toHaveLength(1);
  });

  it("creates a task without a DDL", () => {
    const result = createTaskInState(
      createEmptyLocalAppState(),
      {
        title: "Read references",
        hasDeadline: false
      },
      {
        id: "task_1",
        now: NOW
      }
    );

    expect(result.task.startAt).toBeNull();
    expect(result.task.dueAt).toBeNull();
  });

  it("uses the injected clock when the start time is omitted", () => {
    const result = createTaskInState(
      createEmptyLocalAppState(),
      {
        title: "Short deadline",
        dueAt: "2026-04-30T10:01:00.000Z"
      },
      {
        id: "task_1",
        now: NOW
      }
    );

    expect(result.task.startAt).toBe(NOW.toISOString());
    expect(result.task.dueAt).toBe("2026-04-30T10:01:00.000Z");
  });

  it.each(["2026-04-30T10:00:00.000Z", "2026-04-30T09:59:00.000Z"])(
    "rejects a deadline at or before the actual creation time (%s)",
    (dueAt) => {
      expect(() =>
        createTaskInState(
          createEmptyLocalAppState(),
          {
            title: "Invalid short deadline",
            dueAt
          },
          {
            id: "task_1",
            now: NOW
          }
        )
      ).toThrow(TASK_ERROR_MESSAGES.deadlineNotFuture);
    }
  );

  it("rejects duplicate task titles", () => {
    const initial = createTaskInState(
      createEmptyLocalAppState(),
      {
        title: "Submit report",
        dueAt: "2026-05-01T10:00:00.000Z"
      },
      {
        id: "task_1",
        now: NOW
      }
    );

    expect(() =>
      createTaskInState(
        initial.state,
        {
          title: "Submit report",
          dueAt: "2026-05-02T10:00:00.000Z"
        },
        {
          id: "task_2",
          now: NOW
        }
      )
    ).toThrow(TASK_ERROR_MESSAGES.duplicateTitle);
  });

  it("rejects an invalid date range", () => {
    expect(() =>
      createTaskInState(
        createEmptyLocalAppState(),
        {
          title: "Bad deadline",
          startAt: "2026-05-01T10:00:00.000Z",
          dueAt: "2026-04-30T10:00:00.000Z"
        },
        {
          id: "task_1",
          now: NOW
        }
      )
    ).toThrow(TASK_ERROR_MESSAGES.dateRangeInvalid);
  });

  it("updates, completes, and deletes a task", () => {
    const created = createTaskInState(
      createEmptyLocalAppState(),
      {
        title: "Draft",
        dueAt: "2026-05-01T10:00:00.000Z"
      },
      {
        id: "task_1",
        now: NOW
      }
    );
    const updated = updateTaskInState(
      created.state,
      "task_1",
      {
        title: "Final draft",
        hasDeadline: false,
        startAt: null,
        dueAt: null
      },
      {
        now: new Date("2026-04-30T11:00:00.000Z")
      }
    );
    const completed = completeTaskInState(updated.state, "task_1", {
      now: new Date("2026-04-30T12:00:00.000Z")
    });
    const deleted = deleteTaskInState(completed.state, "task_1");

    expect(updated.task).toMatchObject({
      title: "Final draft",
      startAt: null,
      dueAt: null
    });
    expect(completed.task.status).toBe("COMPLETED");
    expect(deleted.state.tasks).toHaveLength(0);
  });

  it("persists a complete deadline pair when only dueAt is added", () => {
    const created = createTaskInState(
      createEmptyLocalAppState(),
      {
        title: "Add deadline later",
        hasDeadline: false
      },
      {
        id: "task_1",
        now: NOW
      }
    );
    const updated = updateTaskInState(
      created.state,
      created.task.id,
      {
        dueAt: "2026-05-01T10:00:00.000Z"
      },
      {
        now: NOW
      }
    );

    expect(updated.task.startAt).toBe(NOW.toISOString());
    expect(updated.task.dueAt).toBe("2026-05-01T10:00:00.000Z");
  });

  it("allows editing an overdue deadline when it remains after the task start", () => {
    const created = createTaskInState(
      createEmptyLocalAppState(),
      {
        title: "Overdue task",
        dueAt: "2026-05-01T10:00:00.000Z"
      },
      {
        id: "task_1",
        now: NOW
      }
    );
    const updated = updateTaskInState(
      created.state,
      created.task.id,
      {
        dueAt: "2026-04-30T11:00:00.000Z"
      },
      {
        now: new Date("2026-05-02T10:00:00.000Z")
      }
    );

    expect(updated.task.startAt).toBe(NOW.toISOString());
    expect(updated.task.dueAt).toBe("2026-04-30T11:00:00.000Z");
  });

  it("updates local notification settings", () => {
    const result = updateSettingsInState(createEmptyLocalAppState(), {
      localReminderEnabled: false,
      approachingReminderMinutes: 1440,
      urgentReminderMinutes: 30
    });

    expect(result.settings).toEqual({
      localReminderEnabled: false,
      approachingReminderMinutes: 1440,
      urgentReminderMinutes: 30
    });
  });

  it("rejects malformed non-empty persisted JSON", () => {
    expect(() => parseLocalAppState("{not-json")).toThrow(
      LOCAL_APP_STATE_ERROR_MESSAGES.corruptJson
    );
  });

  it("rejects state written by a future app version", () => {
    expect(() =>
      parseLocalAppState(
        JSON.stringify({
          version: 2,
          tasks: [],
          settings: {
            localReminderEnabled: true,
            approachingReminderMinutes: 2880,
            urgentReminderMinutes: 120
          }
        })
      )
    ).toThrow(LOCAL_APP_STATE_ERROR_MESSAGES.futureVersion);
  });

  it("rejects persisted tasks with invalid dates instead of dropping them", () => {
    expect(() =>
      parseLocalAppState(
        JSON.stringify({
          version: 1,
          tasks: [
            {
              id: "task_1",
              title: "Corrupt task",
              description: null,
              startAt: "not-a-date",
              dueAt: "2026-05-01T10:00:00.000Z",
              status: "ACTIVE",
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString()
            }
          ],
          settings: {
            localReminderEnabled: true,
            approachingReminderMinutes: 2880,
            urgentReminderMinutes: 120
          }
        })
      )
    ).toThrow(LOCAL_APP_STATE_ERROR_MESSAGES.invalidDate);
  });

  it("rejects persisted reminder thresholds in the wrong order", () => {
    expect(() =>
      parseLocalAppState(
        JSON.stringify({
          version: 1,
          tasks: [],
          settings: {
            localReminderEnabled: true,
            approachingReminderMinutes: 30,
            urgentReminderMinutes: 120
          }
        })
      )
    ).toThrow(LOCAL_APP_STATE_ERROR_MESSAGES.invalidState);
  });
});
