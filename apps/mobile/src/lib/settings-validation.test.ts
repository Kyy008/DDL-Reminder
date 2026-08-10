import { describe, expect, it } from "vitest";
import {
  REMINDER_THRESHOLD_ORDER_ERROR,
  updateSettingsSchema
} from "./settings-validation";

describe("updateSettingsSchema", () => {
  it("accepts equal approaching and urgent thresholds", () => {
    const result = updateSettingsSchema.safeParse({
      emailReminderEnabled: true,
      approachingReminderMinutes: 120,
      urgentReminderMinutes: 120
    });

    expect(result.success).toBe(true);
  });

  it("rejects an approaching threshold shorter than the urgent threshold", () => {
    const result = updateSettingsSchema.safeParse({
      emailReminderEnabled: true,
      approachingReminderMinutes: 30,
      urgentReminderMinutes: 120
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        REMINDER_THRESHOLD_ORDER_ERROR
      );
    }
  });
});
