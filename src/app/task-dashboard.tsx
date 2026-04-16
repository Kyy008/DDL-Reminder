"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  calculateDeadlineProgress,
  DeadlineStatus,
  getDeadlineStatus,
  getRemainingTimeParts
} from "@/lib/deadline";
import { TaskStatusValue } from "@/lib/task-constants";

type TaskDto = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  dueAt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type TaskView = TaskDto & {
  status: TaskStatusValue;
  startDate: Date;
  dueDate: Date;
  progress: number;
  deadlineStatus: DeadlineStatus;
  remainingText: string;
};

type TaskFormState = {
  title: string;
  description: string;
  startAt: string;
  dueAt: string;
};

type ApiTaskResponse = {
  task?: TaskDto;
  tasks?: TaskDto[];
  error?: string;
  issues?: Array<{
    message: string;
  }>;
};

const EMPTY_FORM = {
  title: "",
  description: "",
  startAt: "",
  dueAt: ""
};

const PROGRESS_START_COLOR = "#4bae50";
const PROGRESS_MID_COLOR = "#f5c84c";
const PROGRESS_END_COLOR = "#ff0000";

const STATUS_RANK: Record<TaskStatusValue, number> = {
  ACTIVE: 0,
  COMPLETED: 1,
  ARCHIVED: 2
};

const STATUS_META: Record<
  DeadlineStatus,
  {
    label: string;
    toneClass: string;
  }
> = {
  normal: {
    label: "进行中",
    toneClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
  },
  approaching: {
    label: "临近",
    toneClass: "border-amber-400/30 bg-amber-400/10 text-amber-200"
  },
  overdue: {
    label: "已逾期",
    toneClass: "border-rose-400/30 bg-rose-400/10 text-rose-200"
  },
  completed: {
    label: "已完成",
    toneClass: "border-[#4bae50]/40 bg-[#4bae50]/15 text-[#7ee084]"
  },
  archived: {
    label: "已归档",
    toneClass: "border-stone-500/30 bg-stone-500/10 text-stone-400"
  }
};

export function TaskDashboard({ mode }: { mode: "public" | "manage" }) {
  const isManageMode = mode === "manage";
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(() => createEmptyForm());
  const [now, setNow] = useState(() => new Date());

  const loadTasks = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch("/api/tasks", {
        cache: "no-store"
      });
      const payload = (await response.json()) as ApiTaskResponse;

      if (!response.ok) {
        throw new Error(payload.error || "任务加载失败。");
      }

      setTasks(payload.tasks ?? []);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks
      .map((task) => toTaskView(task, now))
      .filter((task) => isManageMode || task.status !== "ARCHIVED")
      .sort(compareTaskViews);
  }, [isManageMode, now, tasks]);

  const stats = useMemo(() => {
    return {
      total: visibleTasks.length,
      active: visibleTasks.filter((task) => task.status === "ACTIVE").length,
      approaching: visibleTasks.filter(
        (task) => task.deadlineStatus === "approaching"
      ).length,
      completed: visibleTasks.filter((task) => task.status === "COMPLETED")
        .length
    };
  }, [visibleTasks]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const payload = formToPayload(form);
      const endpoint = editingTaskId
        ? `/api/tasks/${editingTaskId}`
        : "/api/tasks";
      const response = await fetch(endpoint, {
        method: editingTaskId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = (await response.json()) as ApiTaskResponse;

      if (!response.ok || !data.task) {
        throw new Error(getApiError(data));
      }

      const savedTask = data.task;

      setTasks((currentTasks) => upsertTask(currentTasks, savedTask));
      resetForm();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runTaskAction(
    taskId: string,
    endpoint: string,
    method: "POST" | "DELETE"
  ) {
    setBusyTaskId(taskId);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method
      });
      const data = (await response.json()) as ApiTaskResponse;

      if (!response.ok) {
        throw new Error(getApiError(data));
      }

      if (method === "DELETE") {
        setTasks((currentTasks) =>
          currentTasks.filter((task) => task.id !== taskId)
        );
      } else if (data.task) {
        const savedTask = data.task;

        setTasks((currentTasks) => upsertTask(currentTasks, savedTask));
      }

      if (editingTaskId === taskId) {
        resetForm();
      }
    } catch (actionError) {
      setError(getErrorMessage(actionError));
    } finally {
      setBusyTaskId(null);
    }
  }

  function startEditing(task: TaskView) {
    setEditingTaskId(task.id);
    setForm({
      title: task.title,
      description: task.description ?? "",
      startAt: toDatetimeLocalValue(task.startDate),
      dueAt: toDatetimeLocalValue(task.dueDate)
    });
  }

  function resetForm() {
    setEditingTaskId(null);
    setForm(createEmptyForm());
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          cardClass="border-[#5f34b0] bg-[#5f34b0]"
          label="全部任务"
          labelClass="text-white"
          value={stats.total}
          valueClass="text-white"
        />
        <StatBlock
          cardClass="border-[#57bfda] bg-[#57bfda]"
          label="进行中"
          labelClass="text-white"
          value={stats.active}
          valueClass="text-white"
        />
        <StatBlock
          cardClass="border-[#ff0000] bg-[#ff0000]"
          label="临近截止"
          labelClass="text-white"
          value={stats.approaching}
          valueClass="text-white"
        />
        <StatBlock
          cardClass="border-[#4bae50] bg-[#4bae50]"
          label="已完成"
          labelClass="text-white"
          value={stats.completed}
          valueClass="text-white"
        />
      </section>

      {isManageMode ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(340px,0.75fr)_1.25fr]">
          <form
            className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5"
            onSubmit={handleSubmit}
          >
            <div>
              <p className="text-sm font-semibold text-[var(--primary)]">
                {editingTaskId ? "编辑任务" : "新增任务"}
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                {editingTaskId ? "调整 DDL 信息" : "写下新的 DDL"}
              </h2>
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium">
              标题
              <input
                className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    title: event.target.value
                  }))
                }
                placeholder="例如：提交课程论文"
                required
                value={form.title}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              描述
              <textarea
                className="min-h-28 resize-y rounded-md border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-base leading-6 text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    description: event.target.value
                  }))
                }
                placeholder="材料、链接、提交要求..."
                value={form.description}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium">
                开始时间
                <input
                  className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      startAt: event.target.value
                    }))
                  }
                  required
                  type="datetime-local"
                  value={form.startAt}
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium">
                DDL 时间
                <input
                  className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      dueAt: event.target.value
                    }))
                  }
                  required
                  type="datetime-local"
                  value={form.dueAt}
                />
              </label>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting
                  ? "保存中..."
                  : editingTaskId
                    ? "保存修改"
                    : "添加任务"}
              </button>
              {editingTaskId ? (
                <button
                  className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-semibold"
                  onClick={resetForm}
                  type="button"
                >
                  取消编辑
                </button>
              ) : null}
            </div>
          </form>

          <TaskList
            busyTaskId={busyTaskId}
            isLoading={isLoading}
            mode={mode}
            onArchive={(taskId) =>
              runTaskAction(taskId, `/api/tasks/${taskId}/archive`, "POST")
            }
            onComplete={(taskId) =>
              runTaskAction(taskId, `/api/tasks/${taskId}/complete`, "POST")
            }
            onDelete={(taskId) => {
              if (window.confirm("确认删除这个任务吗？")) {
                void runTaskAction(taskId, `/api/tasks/${taskId}`, "DELETE");
              }
            }}
            onEdit={startEditing}
            tasks={visibleTasks}
          />
        </section>
      ) : (
        <TaskList
          busyTaskId={busyTaskId}
          isLoading={isLoading}
          mode={mode}
          tasks={visibleTasks}
        />
      )}

      {error ? (
        <p className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-medium text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TaskList({
  busyTaskId,
  isLoading,
  mode,
  onArchive,
  onComplete,
  onDelete,
  onEdit,
  tasks
}: {
  busyTaskId: string | null;
  isLoading: boolean;
  mode: "public" | "manage";
  onArchive?: (taskId: string) => void;
  onComplete?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onEdit?: (task: TaskView) => void;
  tasks: TaskView[];
}) {
  if (isLoading) {
    return (
      <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel)] p-8 text-center">
        <p className="text-lg font-semibold">正在读取任务</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          DDL 清单马上出现。
        </p>
      </section>
    );
  }

  if (tasks.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel)] p-8 text-center">
        <p className="text-lg font-semibold">还没有任务</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {mode === "manage"
            ? "从左侧添加第一个 DDL。"
            : "管理区添加任务后，这里会显示剩余时间和进度。"}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {tasks.map((task) => (
        <TaskCard
          busyTaskId={busyTaskId}
          key={task.id}
          mode={mode}
          onArchive={onArchive}
          onComplete={onComplete}
          onDelete={onDelete}
          onEdit={onEdit}
          task={task}
        />
      ))}
    </section>
  );
}

function TaskCard({
  busyTaskId,
  mode,
  onArchive,
  onComplete,
  onDelete,
  onEdit,
  task
}: {
  busyTaskId: string | null;
  mode: "public" | "manage";
  onArchive?: (taskId: string) => void;
  onComplete?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onEdit?: (task: TaskView) => void;
  task: TaskView;
}) {
  const meta = STATUS_META[task.deadlineStatus];
  const isBusy = busyTaskId === task.id;
  const isCompleted = task.status === "COMPLETED";

  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="break-words text-2xl font-semibold leading-tight">
              {task.title}
            </h2>
            <span
              className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${meta.toneClass}`}
            >
              {meta.label}
            </span>
          </div>
          {task.description ? (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--muted-foreground)]">
              {task.description}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 lg:self-start">
          {isCompleted ? (
            <span
              aria-label="已完成"
              className="inline-flex size-10 items-center justify-center rounded-full bg-[#4bae50] text-white shadow-sm"
              title="已完成"
            >
              <CheckIcon />
            </span>
          ) : onComplete ? (
            <button
              className="inline-flex h-10 items-center justify-center rounded-md bg-[#4bae50] px-4 text-sm font-semibold text-white transition hover:bg-[#449b48] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
              onClick={() => onComplete(task.id)}
              type="button"
            >
              {isBusy ? "处理中..." : "标记完成"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3 grid gap-3 text-sm sm:grid-cols-3">
          <InfoPill label="开始" value={formatDateTime(task.startDate)} />
          <InfoPill label="剩余" value={task.remainingText} />
          <InfoPill label="DDL" value={formatDateTime(task.dueDate)} />
        </div>
        {isCompleted ? null : (
          <div className="h-2.5 overflow-hidden rounded-md bg-[var(--muted)]">
            <div
              className="h-full rounded-md transition-[width]"
              style={{
                width: `${task.progress}%`,
                backgroundColor: getProgressColor(task.progress)
              }}
            />
          </div>
        )}
      </div>

      {mode === "manage" ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <TaskActionButton onClick={() => onEdit?.(task)}>
            编辑
          </TaskActionButton>
          {task.status !== "ARCHIVED" ? (
            <TaskActionButton
              disabled={isBusy}
              onClick={() => onArchive?.(task.id)}
            >
              归档
            </TaskActionButton>
          ) : null}
          <TaskActionButton
            danger
            disabled={isBusy}
            onClick={() => onDelete?.(task.id)}
          >
            删除
          </TaskActionButton>
        </div>
      ) : null}
    </article>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function StatBlock({
  cardClass,
  label,
  labelClass,
  value,
  valueClass
}: {
  cardClass: string;
  label: string;
  labelClass: string;
  value: number;
  valueClass: string;
}) {
  return (
    <div className={`rounded-lg border px-5 py-4 ${cardClass}`}>
      <p className={`text-sm font-medium ${labelClass}`}>{label}</p>
      <p className={`mt-2 text-3xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-[var(--muted)] px-3 py-2">
      <p className="text-xs font-medium text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold">{value}</p>
    </div>
  );
}

function TaskActionButton({
  children,
  danger = false,
  disabled = false,
  onClick
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
        danger
          ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
          : "border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)]"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function toTaskView(task: TaskDto, now: Date): TaskView {
  const status = toTaskStatus(task.status);
  const startDate = new Date(task.startAt);
  const dueDate = new Date(task.dueAt);
  const deadlineStatus = getDeadlineStatus({
    taskStatus: status,
    dueAt: dueDate,
    now
  });

  return {
    ...task,
    status,
    startDate,
    dueDate,
    progress: calculateDeadlineProgress({
      startAt: startDate,
      dueAt: dueDate,
      now
    }),
    deadlineStatus,
    remainingText: getRemainingText(status, dueDate, now)
  };
}

function compareTaskViews(left: TaskView, right: TaskView) {
  const rankDiff = STATUS_RANK[left.status] - STATUS_RANK[right.status];

  if (rankDiff !== 0) {
    return rankDiff;
  }

  if (left.status === "ACTIVE") {
    return left.dueDate.getTime() - right.dueDate.getTime();
  }

  return right.dueDate.getTime() - left.dueDate.getTime();
}

function toTaskStatus(status: string): TaskStatusValue {
  if (status === "COMPLETED" || status === "ARCHIVED") {
    return status;
  }

  return "ACTIVE";
}

function getRemainingText(status: TaskStatusValue, dueAt: Date, now: Date) {
  if (status === "COMPLETED") {
    return "已完成";
  }

  if (status === "ARCHIVED") {
    return "已归档";
  }

  const remaining = getRemainingTimeParts(dueAt, now);

  if (remaining.isOverdue) {
    return `逾期 ${formatDuration(now.getTime() - dueAt.getTime())}`;
  }

  if (remaining.totalMs < 60 * 1000) {
    return "不足 1 分钟";
  }

  return formatDuration(remaining.totalMs);
}

function getProgressColor(progress: number) {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const startColor = hexToRgb(PROGRESS_START_COLOR);
  const midColor = hexToRgb(PROGRESS_MID_COLOR);
  const endColor = hexToRgb(PROGRESS_END_COLOR);

  if (clampedProgress <= 50) {
    return rgbToCss(mixRgb(startColor, midColor, clampedProgress / 50));
  }

  return rgbToCss(mixRgb(midColor, endColor, (clampedProgress - 50) / 50));
}

function hexToRgb(hex: string) {
  const normalizedHex = hex.replace("#", "");

  return {
    red: Number.parseInt(normalizedHex.slice(0, 2), 16),
    green: Number.parseInt(normalizedHex.slice(2, 4), 16),
    blue: Number.parseInt(normalizedHex.slice(4, 6), 16)
  };
}

function mixRgb(
  from: ReturnType<typeof hexToRgb>,
  to: ReturnType<typeof hexToRgb>,
  amount: number
) {
  return {
    red: Math.round(from.red + (to.red - from.red) * amount),
    green: Math.round(from.green + (to.green - from.green) * amount),
    blue: Math.round(from.blue + (to.blue - from.blue) * amount)
  };
}

function rgbToCss({ blue, green, red }: ReturnType<typeof hexToRgb>) {
  return `rgb(${red} ${green} ${blue})`;
}

function formatDuration(totalMs: number) {
  const totalMinutes = Math.max(1, Math.floor(totalMs / (60 * 1000)));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days > 0) {
    parts.push(`${days} 天`);
  }

  if (hours > 0) {
    parts.push(`${hours} 小时`);
  }

  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} 分钟`);
  }

  return parts.slice(0, 2).join(" ");
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function toDatetimeLocalValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);

  return localDate.toISOString().slice(0, 16);
}

function createEmptyForm(): TaskFormState {
  const startAt = new Date();
  const dueAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);

  return {
    ...EMPTY_FORM,
    startAt: toDatetimeLocalValue(startAt),
    dueAt: toDatetimeLocalValue(dueAt)
  };
}

function formToPayload(form: TaskFormState) {
  return {
    title: form.title,
    description: form.description,
    startAt: new Date(form.startAt).toISOString(),
    dueAt: new Date(form.dueAt).toISOString()
  };
}

function upsertTask(tasks: TaskDto[], task: TaskDto) {
  const existingIndex = tasks.findIndex(
    (currentTask) => currentTask.id === task.id
  );

  if (existingIndex === -1) {
    return [...tasks, task];
  }

  return tasks.map((currentTask) =>
    currentTask.id === task.id ? task : currentTask
  );
}

function getApiError(data: ApiTaskResponse) {
  if (data.issues && data.issues.length > 0) {
    return data.issues.map((issue) => issue.message).join(" ");
  }

  return data.error || "请求失败。";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败。";
}
