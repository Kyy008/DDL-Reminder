import {
  MAX_REMINDER_THRESHOLD_MINUTES,
  updateSettingsSchema
} from "./settings-validation";
import { TaskStatusValue } from "./task-constants";
import { TASK_ERROR_MESSAGES } from "./task-error-messages";
import {
  createTaskSchema,
  isValidTaskDateRange,
  normalizeOptionalDescription,
  taskIdSchema,
  updateTaskSchema
} from "./task-validation";

export type LocalTask = {
  id: string;
  title: string;
  description: string | null;
  startAt: string | null;
  dueAt: string | null;
  status: TaskStatusValue;
  createdAt: string;
  updatedAt: string;
};

export type LocalSettings = {
  localReminderEnabled: boolean;
  approachingReminderMinutes: number;
  urgentReminderMinutes: number;
};

export type LocalAppState = {
  version: 1;
  tasks: LocalTask[];
  settings: LocalSettings;
};

export type LocalTaskInput = Record<string, unknown>;
export type LocalSettingsInput = Record<string, unknown>;

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  localReminderEnabled: true,
  approachingReminderMinutes: 2880,
  urgentReminderMinutes: 120
};

export const EMPTY_LOCAL_APP_STATE: LocalAppState = {
  version: 1,
  tasks: [],
  settings: DEFAULT_LOCAL_SETTINGS
};

export const LOCAL_APP_STATE_ERROR_MESSAGES = {
  corruptJson: "本地数据似乎已损坏，暂时无法读取。原数据仍保留。",
  futureVersion:
    "这些数据由更高版本的 App 创建。请升级 App 后再试，原数据仍保留。",
  invalidDate: "部分任务的日期有误，已停止加载，以免覆盖原数据。",
  invalidState: "本地数据有误，已停止加载，以免覆盖原数据。"
} as const;

export class LocalAppStateError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "LocalAppStateError";
  }
}

export function createEmptyLocalAppState(): LocalAppState {
  return cloneState(EMPTY_LOCAL_APP_STATE);
}

export function parseLocalAppState(value: string | null): LocalAppState {
  if (value === null || value.trim() === "") {
    return createEmptyLocalAppState();
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(value);
  } catch {
    throw new LocalAppStateError(
      LOCAL_APP_STATE_ERROR_MESSAGES.corruptJson,
      500
    );
  }

  return normalizeLocalAppState(parsedValue);
}

export function serializeLocalAppState(state: LocalAppState) {
  return JSON.stringify(normalizeLocalAppState(state));
}

export function createTaskInState(
  state: LocalAppState,
  input: LocalTaskInput,
  { id = createLocalId(), now = new Date() } = {}
) {
  const parsed = createTaskSchema.safeParse(input);

  if (!parsed.success) {
    throw new LocalAppStateError(
      parsed.error.issues[0]?.message ?? "任务信息有误。"
    );
  }

  const title = parsed.data.title;

  if (hasDuplicateTitle(state.tasks, title)) {
    throw new LocalAppStateError(TASK_ERROR_MESSAGES.duplicateTitle, 409);
  }

  const hasDeadline = parsed.data.hasDeadline !== false;
  const startAt = parsed.data.startAt ?? now;
  const dueAt = parsed.data.dueAt ?? null;

  if (hasDeadline && (!dueAt || !isValidTaskDateRange(startAt, dueAt))) {
    throw new LocalAppStateError(
      dueAt
        ? TASK_ERROR_MESSAGES.dateRangeInvalid
        : TASK_ERROR_MESSAGES.dateInvalid
    );
  }

  const timestamp = now.toISOString();
  const task: LocalTask = {
    id,
    title,
    description: normalizeOptionalDescription(parsed.data.description),
    startAt: hasDeadline ? startAt.toISOString() : null,
    dueAt: hasDeadline ? dueAt!.toISOString() : null,
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    state: {
      ...state,
      tasks: [...state.tasks, task]
    },
    task
  };
}

export function updateTaskInState(
  state: LocalAppState,
  taskId: string,
  input: LocalTaskInput,
  { now = new Date() } = {}
) {
  const id = parseTaskId(taskId);
  const existingTask = state.tasks.find((task) => task.id === id);

  if (!existingTask) {
    throw new LocalAppStateError(TASK_ERROR_MESSAGES.notFound, 404);
  }

  const parsed = updateTaskSchema.safeParse(input);

  if (!parsed.success) {
    throw new LocalAppStateError(
      parsed.error.issues[0]?.message ?? "任务信息有误。"
    );
  }

  if (
    parsed.data.title !== undefined &&
    hasDuplicateTitle(state.tasks, parsed.data.title, id)
  ) {
    throw new LocalAppStateError(TASK_ERROR_MESSAGES.duplicateTitle, 409);
  }

  const isRemovingDeadline = parsed.data.hasDeadline === false;
  const isUpdatingDeadline =
    parsed.data.hasDeadline === true ||
    parsed.data.startAt !== undefined ||
    parsed.data.dueAt !== undefined;
  const nextStartAt =
    parsed.data.startAt ??
    (existingTask.startAt ? new Date(existingTask.startAt) : now);
  const nextDueAt =
    parsed.data.dueAt ??
    (existingTask.dueAt ? new Date(existingTask.dueAt) : null);

  if (!isRemovingDeadline && isUpdatingDeadline) {
    if (!nextDueAt || !isValidTaskDateRange(nextStartAt, nextDueAt)) {
      throw new LocalAppStateError(
        !nextDueAt
          ? TASK_ERROR_MESSAGES.dateInvalid
          : TASK_ERROR_MESSAGES.dateRangeInvalid
      );
    }
  }

  const updatedTask: LocalTask = {
    ...existingTask,
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(parsed.data.description !== undefined
      ? {
          description: normalizeOptionalDescription(parsed.data.description)
        }
      : {}),
    ...(isRemovingDeadline
      ? {
          startAt: null,
          dueAt: null
        }
      : {
          ...(isUpdatingDeadline
            ? {
                startAt: nextStartAt.toISOString(),
                dueAt: nextDueAt!.toISOString()
              }
            : {})
        }),
    updatedAt: now.toISOString()
  };

  return {
    state: {
      ...state,
      tasks: state.tasks.map((task) => (task.id === id ? updatedTask : task))
    },
    task: updatedTask
  };
}

export function completeTaskInState(
  state: LocalAppState,
  taskId: string,
  { now = new Date() } = {}
) {
  return setTaskStatusInState(state, taskId, "COMPLETED", now);
}

export function archiveTaskInState(
  state: LocalAppState,
  taskId: string,
  { now = new Date() } = {}
) {
  return setTaskStatusInState(state, taskId, "ARCHIVED", now);
}

export function deleteTaskInState(state: LocalAppState, taskId: string) {
  const id = parseTaskId(taskId);
  const nextTasks = state.tasks.filter((task) => task.id !== id);

  if (nextTasks.length === state.tasks.length) {
    throw new LocalAppStateError(TASK_ERROR_MESSAGES.notFound, 404);
  }

  return {
    state: {
      ...state,
      tasks: nextTasks
    }
  };
}

export function updateSettingsInState(
  state: LocalAppState,
  input: LocalSettingsInput
) {
  const parsed = updateSettingsSchema.safeParse({
    emailReminderEnabled: input["localReminderEnabled"],
    approachingReminderMinutes: input["approachingReminderMinutes"],
    urgentReminderMinutes: input["urgentReminderMinutes"]
  });

  if (!parsed.success) {
    throw new LocalAppStateError(
      parsed.error.issues[0]?.message ?? "提醒设置有误。"
    );
  }

  const settings: LocalSettings = {
    localReminderEnabled: parsed.data.emailReminderEnabled,
    approachingReminderMinutes: parsed.data.approachingReminderMinutes,
    urgentReminderMinutes: parsed.data.urgentReminderMinutes
  };

  return {
    state: {
      ...state,
      settings
    },
    settings
  };
}

function setTaskStatusInState(
  state: LocalAppState,
  taskId: string,
  status: TaskStatusValue,
  now: Date
) {
  const id = parseTaskId(taskId);
  const existingTask = state.tasks.find((task) => task.id === id);

  if (!existingTask) {
    throw new LocalAppStateError(TASK_ERROR_MESSAGES.notFound, 404);
  }

  const task: LocalTask = {
    ...existingTask,
    status,
    updatedAt: now.toISOString()
  };

  return {
    state: {
      ...state,
      tasks: state.tasks.map((currentTask) =>
        currentTask.id === id ? task : currentTask
      )
    },
    task
  };
}

function parseTaskId(taskId: string) {
  const parsed = taskIdSchema.safeParse(taskId);

  if (!parsed.success) {
    throw new LocalAppStateError(TASK_ERROR_MESSAGES.idInvalid);
  }

  return parsed.data;
}

function hasDuplicateTitle(
  tasks: LocalTask[],
  title: string,
  exceptId?: string
) {
  return tasks.some((task) => task.title === title && task.id !== exceptId);
}

function normalizeLocalAppState(value: unknown): LocalAppState {
  if (!isRecord(value)) {
    throw new LocalAppStateError(
      LOCAL_APP_STATE_ERROR_MESSAGES.invalidState,
      500
    );
  }

  if (
    typeof value["version"] === "number" &&
    value["version"] > EMPTY_LOCAL_APP_STATE.version
  ) {
    throw new LocalAppStateError(
      LOCAL_APP_STATE_ERROR_MESSAGES.futureVersion,
      409
    );
  }

  if (
    value["version"] !== EMPTY_LOCAL_APP_STATE.version ||
    !Array.isArray(value["tasks"]) ||
    !isLocalSettings(value["settings"])
  ) {
    throw new LocalAppStateError(
      LOCAL_APP_STATE_ERROR_MESSAGES.invalidState,
      500
    );
  }

  const tasks: LocalTask[] = [];

  for (const task of value["tasks"]) {
    if (hasInvalidStoredTaskDate(task)) {
      throw new LocalAppStateError(
        LOCAL_APP_STATE_ERROR_MESSAGES.invalidDate,
        500
      );
    }

    if (!isLocalTask(task)) {
      throw new LocalAppStateError(
        LOCAL_APP_STATE_ERROR_MESSAGES.invalidState,
        500
      );
    }

    tasks.push(task);
  }

  return {
    version: 1,
    tasks,
    settings: normalizeLocalSettings(value["settings"])
  };
}

function normalizeLocalSettings(value: LocalSettings): LocalSettings {
  return {
    localReminderEnabled: value.localReminderEnabled,
    approachingReminderMinutes: value.approachingReminderMinutes,
    urgentReminderMinutes: value.urgentReminderMinutes
  };
}

function isLocalSettings(value: unknown): value is LocalSettings {
  return (
    isRecord(value) &&
    typeof value["localReminderEnabled"] === "boolean" &&
    isStoredReminderMinutes(value["approachingReminderMinutes"]) &&
    isStoredReminderMinutes(value["urgentReminderMinutes"]) &&
    value["approachingReminderMinutes"] >= value["urgentReminderMinutes"]
  );
}

function isStoredReminderMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_REMINDER_THRESHOLD_MINUTES
  );
}

function isLocalTask(value: unknown): value is LocalTask {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["id"] === "string" &&
    typeof value["title"] === "string" &&
    (typeof value["description"] === "string" ||
      value["description"] === null) &&
    (typeof value["startAt"] === "string" || value["startAt"] === null) &&
    (typeof value["dueAt"] === "string" || value["dueAt"] === null) &&
    (value["status"] === "ACTIVE" ||
      value["status"] === "COMPLETED" ||
      value["status"] === "ARCHIVED") &&
    typeof value["createdAt"] === "string" &&
    typeof value["updatedAt"] === "string" &&
    !hasInvalidStoredTaskDate(value) &&
    ((value["startAt"] === null && value["dueAt"] === null) ||
      (typeof value["startAt"] === "string" &&
        typeof value["dueAt"] === "string" &&
        new Date(value["dueAt"]).getTime() >
          new Date(value["startAt"]).getTime()))
  );
}

function hasInvalidStoredTaskDate(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }

  return ["startAt", "dueAt", "createdAt", "updatedAt"].some((key) => {
    const dateValue = value[key];

    return (
      typeof dateValue === "string" &&
      !Number.isFinite(new Date(dateValue).getTime())
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneState(state: LocalAppState): LocalAppState {
  return {
    version: 1,
    tasks: state.tasks.map((task) => ({ ...task })),
    settings: { ...state.settings }
  };
}

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `task_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}
