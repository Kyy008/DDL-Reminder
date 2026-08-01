export const TASK_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

export const REMINDER_TYPES = ["DUE_IN_48H", "DUE_IN_2H", "OVERDUE"] as const;
export type ReminderTypeValue = (typeof REMINDER_TYPES)[number];
