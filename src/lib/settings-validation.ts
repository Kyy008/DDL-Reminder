import { z } from "zod";

export const updateSettingsSchema = z.object({
  emailReminderEnabled: z.boolean()
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
