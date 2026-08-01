import { describe, expect, it } from "vitest";
import {
  getTimePickerMinuteOptions,
  updateTimePickerDate
} from "./deadline-picker";

describe("custom deadline time picker", () => {
  it("offers every minute from 00 through 59", () => {
    const options = getTimePickerMinuteOptions(37);

    expect(options).toHaveLength(60);
    expect(options).toEqual(Array.from({ length: 60 }, (_, minute) => minute));
  });

  it("changes one time column without mutating the date or the other column", () => {
    const original = new Date(2026, 6, 31, 12, 37);
    const changedHour = updateTimePickerDate(original, "hour", 18);
    const changedMinute = updateTimePickerDate(changedHour, "minute", 45);

    expect(original.getHours()).toBe(12);
    expect(original.getMinutes()).toBe(37);
    expect(changedHour.getFullYear()).toBe(2026);
    expect(changedHour.getMonth()).toBe(6);
    expect(changedHour.getDate()).toBe(31);
    expect(changedHour.getHours()).toBe(18);
    expect(changedHour.getMinutes()).toBe(37);
    expect(changedMinute.getHours()).toBe(18);
    expect(changedMinute.getMinutes()).toBe(45);
  });

  it("clamps wheel values to valid 24-hour clock boundaries", () => {
    const original = new Date(2026, 6, 31, 12, 30);

    expect(updateTimePickerDate(original, "hour", 99).getHours()).toBe(23);
    expect(updateTimePickerDate(original, "hour", -1).getHours()).toBe(0);
    expect(updateTimePickerDate(original, "minute", 99).getMinutes()).toBe(59);
    expect(updateTimePickerDate(original, "minute", -1).getMinutes()).toBe(0);
  });
});
