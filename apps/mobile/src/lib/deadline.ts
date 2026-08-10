export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_TIME_ZONE = "Asia/Shanghai";
export const DEFAULT_URGENT_THRESHOLD_MS = 2 * HOUR_MS;
export const DEFAULT_APPROACHING_THRESHOLD_MS = 48 * HOUR_MS;

export type TaskStatusLike = "ACTIVE" | "COMPLETED" | "ARCHIVED";

export type DeadlineStatus =
  | "normal"
  | "approaching"
  | "urgent"
  | "overdue"
  | "completed"
  | "archived";

export type ReminderTypeLike = "DUE_IN_48H" | "DUE_IN_2H" | "OVERDUE";

export type RemainingTimeParts = {
  totalMs: number;
  isOverdue: boolean;
  days: number;
  hours: number;
  minutes: number;
};

type DeadlineInput = {
  startAt: Date;
  dueAt: Date;
  now?: Date;
};

type DeadlineStatusInput = {
  taskStatus: TaskStatusLike;
  dueAt: Date;
  now?: Date;
  urgentThresholdMs?: number;
  approachingThresholdMs?: number;
};

export function clampPercentage(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

export function calculateDeadlineProgress({
  startAt,
  dueAt,
  now = new Date()
}: DeadlineInput) {
  const totalMs = dueAt.getTime() - startAt.getTime();

  if (totalMs <= 0) {
    return now.getTime() >= dueAt.getTime() ? 100 : 0;
  }

  const elapsedMs = now.getTime() - startAt.getTime();

  return clampPercentage((elapsedMs / totalMs) * 100);
}

export function getRemainingTimeParts(
  dueAt: Date,
  now: Date = new Date()
): RemainingTimeParts {
  const rawTotalMs = dueAt.getTime() - now.getTime();
  const totalMs = Math.max(0, rawTotalMs);
  const days = Math.floor(totalMs / DAY_MS);
  const hours = Math.floor((totalMs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((totalMs % HOUR_MS) / MINUTE_MS);

  return {
    totalMs,
    isOverdue: rawTotalMs < 0,
    days,
    hours,
    minutes
  };
}

export function getDeadlineStatus({
  taskStatus,
  dueAt,
  now = new Date(),
  urgentThresholdMs = DEFAULT_URGENT_THRESHOLD_MS,
  approachingThresholdMs = DEFAULT_APPROACHING_THRESHOLD_MS
}: DeadlineStatusInput): DeadlineStatus {
  if (taskStatus === "COMPLETED") {
    return "completed";
  }

  if (taskStatus === "ARCHIVED") {
    return "archived";
  }

  const remainingMs = dueAt.getTime() - now.getTime();

  if (remainingMs < 0) {
    return "overdue";
  }

  if (remainingMs < urgentThresholdMs) {
    return "urgent";
  }

  if (remainingMs < approachingThresholdMs) {
    return "approaching";
  }

  return "normal";
}

export function isSameCalendarDay(
  left: Date,
  right: Date,
  timeZone = DEFAULT_TIME_ZONE
) {
  return getDateKey(left, timeZone) === getDateKey(right, timeZone);
}

export function hasReminderBeenSent(
  sentReminderTypes: Iterable<ReminderTypeLike>,
  reminderType: ReminderTypeLike
) {
  return new Set(sentReminderTypes).has(reminderType);
}

export function shouldSendReminder(
  sentReminderTypes: Iterable<ReminderTypeLike>,
  reminderType: ReminderTypeLike
) {
  return !hasReminderBeenSent(sentReminderTypes, reminderType);
}

function getDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}
