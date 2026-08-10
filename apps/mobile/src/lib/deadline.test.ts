import { describe, expect, it } from "vitest";
import {
  calculateDeadlineProgress,
  getDeadlineStatus,
  getRemainingTimeParts,
  shouldSendReminder
} from "./deadline";

describe("calculateDeadlineProgress", () => {
  it("returns the elapsed percentage between start and due time", () => {
    const progress = calculateDeadlineProgress({
      startAt: new Date("2026-04-15T00:00:00.000Z"),
      dueAt: new Date("2026-04-17T00:00:00.000Z"),
      now: new Date("2026-04-16T00:00:00.000Z")
    });

    expect(progress).toBe(50);
  });

  it("clamps progress below 0", () => {
    const progress = calculateDeadlineProgress({
      startAt: new Date("2026-04-15T00:00:00.000Z"),
      dueAt: new Date("2026-04-17T00:00:00.000Z"),
      now: new Date("2026-04-14T00:00:00.000Z")
    });

    expect(progress).toBe(0);
  });

  it("clamps progress above 100", () => {
    const progress = calculateDeadlineProgress({
      startAt: new Date("2026-04-15T00:00:00.000Z"),
      dueAt: new Date("2026-04-17T00:00:00.000Z"),
      now: new Date("2026-04-18T00:00:00.000Z")
    });

    expect(progress).toBe(100);
  });
});

describe("getRemainingTimeParts", () => {
  it("returns days, hours, and minutes for future deadlines", () => {
    const remaining = getRemainingTimeParts(
      new Date("2026-04-17T03:30:00.000Z"),
      new Date("2026-04-16T01:00:00.000Z")
    );

    expect(remaining).toEqual({
      totalMs: 95_400_000,
      isOverdue: false,
      days: 1,
      hours: 2,
      minutes: 30
    });
  });

  it("returns zero parts and overdue flag for past deadlines", () => {
    const remaining = getRemainingTimeParts(
      new Date("2026-04-15T00:00:00.000Z"),
      new Date("2026-04-16T00:00:00.000Z")
    );

    expect(remaining).toEqual({
      totalMs: 0,
      isOverdue: true,
      days: 0,
      hours: 0,
      minutes: 0
    });
  });
});

describe("getDeadlineStatus", () => {
  it("returns completed for completed tasks even when due time has passed", () => {
    const status = getDeadlineStatus({
      taskStatus: "COMPLETED",
      dueAt: new Date("2026-04-15T00:00:00.000Z"),
      now: new Date("2026-04-16T00:00:00.000Z")
    });

    expect(status).toBe("completed");
  });

  it("returns overdue for active tasks past due time", () => {
    const status = getDeadlineStatus({
      taskStatus: "ACTIVE",
      dueAt: new Date("2026-04-15T00:00:00.000Z"),
      now: new Date("2026-04-16T00:00:00.000Z")
    });

    expect(status).toBe("overdue");
  });

  it("returns urgent for active tasks due in less than 2 hours", () => {
    const status = getDeadlineStatus({
      taskStatus: "ACTIVE",
      dueAt: new Date("2026-04-16T03:59:00.000Z"),
      now: new Date("2026-04-16T02:00:00.000Z")
    });

    expect(status).toBe("urgent");
  });

  it("returns approaching when the deadline is exactly at the urgent threshold", () => {
    const status = getDeadlineStatus({
      taskStatus: "ACTIVE",
      dueAt: new Date("2026-04-16T04:00:00.000Z"),
      now: new Date("2026-04-16T02:00:00.000Z")
    });

    expect(status).toBe("approaching");
  });

  it("returns approaching for active tasks due within 48 hours", () => {
    const status = getDeadlineStatus({
      taskStatus: "ACTIVE",
      dueAt: new Date("2026-04-18T01:00:00.000Z"),
      now: new Date("2026-04-16T02:00:00.000Z")
    });

    expect(status).toBe("approaching");
  });

  it("returns approaching when the deadline is within the threshold", () => {
    const status = getDeadlineStatus({
      taskStatus: "ACTIVE",
      dueAt: new Date("2026-04-17T01:00:00.000Z"),
      now: new Date("2026-04-16T02:00:00.000Z"),
      approachingThresholdMs: 48 * 60 * 60 * 1000
    });

    expect(status).toBe("approaching");
  });

  it("returns normal when the deadline is exactly at the threshold", () => {
    const status = getDeadlineStatus({
      taskStatus: "ACTIVE",
      dueAt: new Date("2026-04-18T02:00:00.000Z"),
      now: new Date("2026-04-16T02:00:00.000Z"),
      approachingThresholdMs: 48 * 60 * 60 * 1000
    });

    expect(status).toBe("normal");
  });

  it("returns normal when the deadline is not near", () => {
    const status = getDeadlineStatus({
      taskStatus: "ACTIVE",
      dueAt: new Date("2026-04-20T00:00:00.000Z"),
      now: new Date("2026-04-16T00:00:00.000Z")
    });

    expect(status).toBe("normal");
  });
});

describe("shouldSendReminder", () => {
  it("prevents duplicate reminder types for a task", () => {
    expect(shouldSendReminder(["DUE_IN_48H"], "DUE_IN_48H")).toBe(false);
  });

  it("allows reminder types that have not been sent", () => {
    expect(shouldSendReminder(["DUE_IN_48H"], "DUE_IN_2H")).toBe(true);
  });
});
