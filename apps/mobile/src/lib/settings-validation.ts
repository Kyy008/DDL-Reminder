import { z } from "zod";

export const MAX_REMINDER_THRESHOLD_MINUTES = 14 * 24 * 60 + 23 * 60 + 59;
export const REMINDER_THRESHOLD_ORDER_ERROR =
  "临近提醒应早于或同时于紧急提醒。";

export const updateSettingsSchema = z
  .object({
    emailReminderEnabled: z.boolean(),
    approachingReminderMinutes: z
      .number()
      .int()
      .min(0)
      .max(MAX_REMINDER_THRESHOLD_MINUTES),
    urgentReminderMinutes: z
      .number()
      .int()
      .min(0)
      .max(MAX_REMINDER_THRESHOLD_MINUTES)
  })
  .superRefine((settings, context) => {
    if (settings.approachingReminderMinutes < settings.urgentReminderMinutes) {
      context.addIssue({
        code: "custom",
        message: REMINDER_THRESHOLD_ORDER_ERROR,
        path: ["approachingReminderMinutes"]
      });
    }
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
