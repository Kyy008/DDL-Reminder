import { describe, expect, it } from "vitest";
import { formatTimelineDistance, TIMELINE_RANGE_DAYS } from "./calendar-view";

describe("mobile calendar timeline labels", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");

  it("describes past and future deadlines around the current marker", () => {
    expect(
      formatTimelineDistance(new Date("2026-07-31T11:42:00.000Z"), now)
    ).toBe("18 分钟前");
    expect(
      formatTimelineDistance(new Date("2026-07-31T14:35:00.000Z"), now)
    ).toBe("2 小时 35 分钟后");
  });

  it("uses compact day and hour labels across a multi-day window", () => {
    expect(
      formatTimelineDistance(new Date("2026-08-02T17:00:00.000Z"), now)
    ).toBe("2 天 5 小时后");
  });

  it("shows five days on each side of the current time", () => {
    expect(TIMELINE_RANGE_DAYS).toBe(5);
  });

  it("labels deadlines within the current minute without showing zero", () => {
    expect(
      formatTimelineDistance(new Date("2026-07-31T12:00:20.000Z"), now)
    ).toBe("即将截止");
    expect(
      formatTimelineDistance(new Date("2026-07-31T11:59:40.000Z"), now)
    ).toBe("刚刚截止");
  });
});
