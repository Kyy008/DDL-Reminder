import { describe, expect, it } from "vitest";
import {
  createTaskSchema,
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

describe("normalizeOptionalDescription", () => {
  it("converts empty descriptions to null", () => {
    expect(normalizeOptionalDescription("")).toBeNull();
    expect(normalizeOptionalDescription(undefined)).toBeNull();
  });

  it("keeps non-empty descriptions", () => {
    expect(normalizeOptionalDescription("Notes")).toBe("Notes");
  });
});
