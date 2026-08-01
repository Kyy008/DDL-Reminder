import { describe, expect, it } from "vitest";
import {
  createTaskSchema,
  getTaskDeadlineSubmissionError,
  normalizeOptionalDescription,
  updateTaskSchema
} from "./task-validation";
import { TASK_ERROR_MESSAGES } from "./task-error-messages";

describe("createTaskSchema", () => {
  it("accepts a valid task payload", () => {
    const result = createTaskSchema.safeParse({
      title: "Submit report",
      description: "Final PDF",
      startAt: "2026-04-16T00:00:00.000Z",
      dueAt: "2026-04-17T00:00:00.000Z"
    });

    expect(result.success).toBe(true);
  });

  it("accepts a task without a DDL", () => {
    const result = createTaskSchema.safeParse({
      title: "Read references",
      hasDeadline: false
    });

    expect(result.success).toBe(true);
  });

  it("does not read the wall clock when startAt is omitted", () => {
    const result = createTaskSchema.safeParse({
      title: "Validated by the state layer",
      dueAt: "2000-01-01T00:00:00.000Z"
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const result = createTaskSchema.safeParse({
      title: "   ",
      dueAt: "2026-04-17T00:00:00.000Z"
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        TASK_ERROR_MESSAGES.titleRequired
      );
    }
  });

  it("rejects invalid dates", () => {
    const result = createTaskSchema.safeParse({
      title: "Submit report",
      dueAt: "not-a-date"
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        TASK_ERROR_MESSAGES.dateInvalid
      );
    }
  });

  it("requires a due time when DDL is enabled", () => {
    const result = createTaskSchema.safeParse({
      title: "Submit report",
      hasDeadline: true
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        TASK_ERROR_MESSAGES.dateInvalid
      );
    }
  });

  it("rejects a due time before start time", () => {
    const result = createTaskSchema.safeParse({
      title: "Submit report",
      startAt: "2026-04-17T00:00:00.000Z",
      dueAt: "2026-04-16T00:00:00.000Z"
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        TASK_ERROR_MESSAGES.dateRangeInvalid
      );
    }
  });
});

describe("updateTaskSchema", () => {
  it("accepts a partial update", () => {
    const result = updateTaskSchema.safeParse({
      title: "Updated title"
    });

    expect(result.success).toBe(true);
  });

  it("accepts removing the DDL from a task", () => {
    const result = updateTaskSchema.safeParse({
      hasDeadline: false,
      startAt: null,
      dueAt: null
    });

    expect(result.success).toBe(true);
  });

  it("validates start and due time when both are provided", () => {
    const result = updateTaskSchema.safeParse({
      startAt: "2026-04-17T00:00:00.000Z",
      dueAt: "2026-04-16T00:00:00.000Z"
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        TASK_ERROR_MESSAGES.dateRangeInvalid
      );
    }
  });
});

describe("getTaskDeadlineSubmissionError", () => {
  const now = new Date("2026-08-02T04:37:00.000Z");

  it.each(["2026-08-02T04:37:00.000Z", "2026-08-02T04:36:00.000Z"])(
    "rejects a new deadline at or before now (%s)",
    (dueAt) => {
      expect(
        getTaskDeadlineSubmissionError(
          { hasDeadline: true, dueAt },
          { isCreatingTask: true, now }
        )
      ).toBe(TASK_ERROR_MESSAGES.deadlineNotFuture);
    }
  );

  it("accepts a new deadline later than now", () => {
    expect(
      getTaskDeadlineSubmissionError(
        {
          hasDeadline: true,
          dueAt: "2026-08-02T04:38:00.000Z"
        },
        { isCreatingTask: true, now }
      )
    ).toBeNull();
  });

  it("does not validate dates when a task has no deadline", () => {
    expect(
      getTaskDeadlineSubmissionError(
        { hasDeadline: false },
        { isCreatingTask: true, now }
      )
    ).toBeNull();
  });

  it("keeps the existing edit rule for overdue tasks", () => {
    expect(
      getTaskDeadlineSubmissionError(
        {
          hasDeadline: true,
          startAt: "2026-08-01T02:00:00.000Z",
          dueAt: "2026-08-01T03:00:00.000Z"
        },
        { isCreatingTask: false, now }
      )
    ).toBeNull();
  });

  it("rejects an invalid deadline value", () => {
    expect(
      getTaskDeadlineSubmissionError(
        { hasDeadline: true, dueAt: "not-a-date" },
        { isCreatingTask: true, now }
      )
    ).toBe(TASK_ERROR_MESSAGES.dateInvalid);
  });
});

describe("normalizeOptionalDescription", () => {
  it("converts empty descriptions to null", () => {
    expect(normalizeOptionalDescription("")).toBeNull();
    expect(normalizeOptionalDescription(undefined)).toBeNull();
  });

  it("keeps non-empty descriptions", () => {
    expect(normalizeOptionalDescription("Notes")).toBe("Notes");
  });
});
