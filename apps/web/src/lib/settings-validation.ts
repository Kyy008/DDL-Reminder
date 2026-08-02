import { z } from "zod";

export const MAX_REMINDER_THRESHOLD_MINUTES = 14 * 24 * 60 + 23 * 60 + 59;

export const updateSettingsSchema = z.object({
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
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
