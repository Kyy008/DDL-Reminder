"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  startAt: string | null;
  dueAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type TaskView = TaskDto & {
  status: TaskStatusValue;
  hasDeadline: boolean;
  startDate: Date | null;
  dueDate: Date | null;
  progress: number | null;
  deadlineStatus: DeadlineStatus;
  remainingText: string;
};

type TaskFormState = {
  hasDeadline: boolean;
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

type WorkspaceAction = "view" | "add" | "edit" | "delete";
type SidebarIconName =
  | "add"
  | "collapse"
  | "delete"
  | "edit"
  | "group"
  | "view";

const EMPTY_FORM = {
  hasDeadline: true,
  title: "",
  description: "",
  startAt: "",
  dueAt: ""
};

const EDIT_ACTIONS: Array<{
  id: Exclude<WorkspaceAction, "view">;
  icon: SidebarIconName;
  label: string;
}> = [
  {
    id: "add",
    icon: "add",
    label: "添加任务"
  },
  {
    id: "edit",
    icon: "edit",
    label: "编辑任务"
  },
  {
    id: "delete",
    icon: "delete",
    label: "删除任务"
  }
];

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
  urgent: {
    label: "紧急",
    toneClass: "border-rose-400/30 bg-rose-400/10 text-rose-200"
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
  const [activeAction, setActiveAction] = useState<WorkspaceAction>("view");
  const [form, setForm] = useState<TaskFormState>(() => createEmptyForm());
  const [now, setNow] = useState(() => new Date());
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null
  );
  const pendingFocusTaskId = useRef<string | null>(null);

  const loadTasks = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch("/api/tasks", {
        cache: "no-store"
      });
      const payload = await parseApiResponse(response);

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

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
      normal: visibleTasks.filter((task) => task.deadlineStatus === "normal")
        .length,
      approaching: visibleTasks.filter(
        (task) => task.deadlineStatus === "approaching"
      ).length,
      urgent: visibleTasks.filter((task) => task.deadlineStatus === "urgent")
        .length,
      completed: visibleTasks.filter((task) => task.status === "COMPLETED")
        .length
    };
  }, [visibleTasks]);

  useEffect(() => {
    const taskId = pendingFocusTaskId.current;

    if (!taskId || activeAction !== "view") {
      return;
    }

    const taskIsVisible = visibleTasks.some((task) => task.id === taskId);

    if (!taskIsVisible) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-task-card-id="${taskId}"]`
      );

      if (!target) {
        return;
      }

      target.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      setHighlightedTaskId(taskId);
      pendingFocusTaskId.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeAction, visibleTasks]);

  useEffect(() => {
    if (!highlightedTaskId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setHighlightedTaskId((currentTaskId) =>
        currentTaskId === highlightedTaskId ? null : currentTaskId
      );
    }, 1800);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [highlightedTaskId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const isCreatingTask = editingTaskId === null;
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
      const data = await parseApiResponse(response);

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      if (!response.ok || !data.task) {
        throw new Error(getApiError(data));
      }

      const savedTask = data.task;

      setTasks((currentTasks) => upsertTask(currentTasks, savedTask));
      resetForm();

      if (isCreatingTask) {
        pendingFocusTaskId.current = savedTask.id;
        setHighlightedTaskId(null);
        setActiveAction("view");
      }
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
      const data = await parseApiResponse(response);

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

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
    setActiveAction("edit");
    setEditingTaskId(task.id);
    setForm({
      hasDeadline: task.hasDeadline,
      title: task.title,
      description: task.description ?? "",
      startAt: task.startDate ? toDatetimeLocalValue(task.startDate) : "",
      dueAt: task.dueDate ? toDatetimeLocalValue(task.dueDate) : ""
    });
  }

  function resetForm() {
    setEditingTaskId(null);
    setForm(createEmptyForm());
  }

  function switchAction(action: WorkspaceAction) {
    setActiveAction(action);
    setError(null);
    resetForm();
  }

  if (!isManageMode) {
    return (
      <div className="flex flex-col gap-8">
        <StatsSection stats={stats} />
        <TaskList
          busyTaskId={busyTaskId}
          isLoading={isLoading}
          mode={mode}
          tasks={visibleTasks}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <TaskSidebar activeAction={activeAction} onSwitch={switchAction} />

      <section className="min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-8">
          <StatsSection stats={stats} />

          {activeAction === "view" ? (
            <TaskList
              busyTaskId={busyTaskId}
              isLoading={isLoading}
              highlightedTaskId={highlightedTaskId}
              mode="public"
              onComplete={(taskId) =>
                runTaskAction(taskId, `/api/tasks/${taskId}/complete`, "POST")
              }
              tasks={visibleTasks}
            />
          ) : null}

          {activeAction === "add" ? (
            <section className="max-w-3xl">
              <TaskEditorForm
                form={form}
                isSubmitting={isSubmitting}
                onChange={setForm}
                onSubmit={handleSubmit}
                submitLabel="添加任务"
                submittingLabel="添加中..."
              />
            </section>
          ) : null}

          {activeAction === "edit" ? (
            <section className="grid gap-6 xl:grid-cols-[minmax(340px,0.75fr)_1.25fr]">
              <TaskList
                busyTaskId={busyTaskId}
                isLoading={isLoading}
                mode="manage"
                onEdit={startEditing}
                tasks={visibleTasks}
              />
              {editingTaskId ? (
                <section>
                  <TaskEditorHeader eyebrow="编辑任务" title="调整 DDL 信息" />
                  <TaskEditorForm
                    form={form}
                    isSubmitting={isSubmitting}
                    onChange={setForm}
                    onSubmit={handleSubmit}
                    submitLabel="保存修改"
                    submittingLabel="保存中..."
                  />
                </section>
              ) : null}
            </section>
          ) : null}

          {activeAction === "delete" ? (
            <section>
              <TaskList
                busyTaskId={busyTaskId}
                isLoading={isLoading}
                mode="manage"
                onDelete={(taskId) =>
                  void runTaskAction(taskId, `/api/tasks/${taskId}`, "DELETE")
                }
                tasks={visibleTasks}
              />
            </section>
          ) : null}

          {error ? (
            <p className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-medium text-rose-200">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TaskEditorHeader({
  eyebrow,
  title
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <p className="text-sm font-semibold text-[var(--primary)]">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
    </div>
  );
}

function TaskEditorForm({
  form,
  isSubmitting,
  onChange,
  onSubmit,
  submitLabel,
  submittingLabel
}: {
  form: TaskFormState;
  isSubmitting: boolean;
  onChange: (update: (currentForm: TaskFormState) => TaskFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  submittingLabel: string;
}) {
  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5"
      onSubmit={onSubmit}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        标题
        <input
          className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          onChange={(event) =>
            onChange((currentForm) => ({
              ...currentForm,
              title: event.target.value
            }))
          }
          required
          value={form.title}
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium">
        描述
        <textarea
          className="min-h-28 resize-y rounded-md border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-base leading-6 text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          onChange={(event) =>
            onChange((currentForm) => ({
              ...currentForm,
              description: event.target.value
            }))
          }
          value={form.description}
        />
      </label>

      <div className="flex flex-wrap gap-4 text-sm font-medium">
        <label className="flex items-center gap-3">
          <input
            checked={form.hasDeadline}
            className="size-4 accent-[var(--primary)]"
            onChange={() =>
              onChange((currentForm) => {
                const deadlineFields =
                  !currentForm.startAt || !currentForm.dueAt
                    ? createDefaultDeadlineFields()
                    : {};

                return {
                  ...currentForm,
                  ...deadlineFields,
                  hasDeadline: true
                };
              })
            }
            type="checkbox"
          />
          设置 DDL
        </label>

        <label className="flex items-center gap-3">
          <input
            checked={!form.hasDeadline}
            className="size-4 accent-[var(--primary)]"
            onChange={() =>
              onChange((currentForm) => ({
                ...currentForm,
                hasDeadline: false
              }))
            }
            type="checkbox"
          />
          不设置 DDL
        </label>
      </div>

      {form.hasDeadline ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium">
            开始时间
            <input
              className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              onChange={(event) =>
                onChange((currentForm) => ({
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
                onChange((currentForm) => ({
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
      ) : null}

      <button
        className="h-11 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}

function StatsSection({
  stats
}: {
  stats: {
    normal: number;
    approaching: number;
    urgent: number;
    completed: number;
  };
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatBlock
        cardClass="border-[#57bfda] bg-[#57bfda]"
        label="进行中"
        labelClass="text-white"
        value={stats.normal}
        valueClass="text-white"
      />
      <StatBlock
        cardClass="border-[#f5c84c] bg-[#f5c84c]"
        label="临近截止"
        labelClass="text-white"
        value={stats.approaching}
        valueClass="text-white"
      />
      <StatBlock
        cardClass="border-[#ff0000] bg-[#ff0000]"
        label="即将截止"
        labelClass="text-white"
        value={stats.urgent}
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
  );
}

function TaskSidebar({
  activeAction,
  onSwitch
}: {
  activeAction: WorkspaceAction;
  onSwitch: (action: WorkspaceAction) => void;
}) {
  const [isEditGroupExpanded, setIsEditGroupExpanded] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const editGroupIsActive = activeAction !== "view";

  return (
    <aside
      className={`h-full shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[#171918] py-5 transition-[width,padding] duration-300 ease-in-out ${
        isCollapsed ? "w-20 px-3" : "w-72 px-4"
      }`}
    >
      <div
        className={`mb-4 flex ${
          isCollapsed ? "justify-center" : "justify-end"
        }`}
      >
        <button
          aria-label={isCollapsed ? "展开侧边导航栏" : "收起侧边导航栏"}
          className="inline-flex size-10 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          onClick={() => setIsCollapsed((currentValue) => !currentValue)}
          title={isCollapsed ? "展开侧边导航栏" : "收起侧边导航栏"}
          type="button"
        >
          <SidebarIcon
            className={`transition-transform duration-300 ${
              isCollapsed ? "rotate-180" : ""
            }`}
            name="collapse"
          />
        </button>
      </div>

      <nav className="flex flex-col gap-2">
        <TreeButton
          active={activeAction === "view"}
          icon="view"
          label="查看任务"
          collapsed={isCollapsed}
          onClick={() => onSwitch("view")}
        />

        <div className="mt-2">
          <button
            aria-expanded={isEditGroupExpanded}
            aria-label="任务编辑"
            className={`flex w-full items-center overflow-hidden rounded-md border px-3 py-3 text-left text-sm font-semibold transition ${
              editGroupIsActive
                ? "border-[var(--primary)] bg-[#263245] text-[var(--primary)]"
                : "border-transparent text-[var(--primary)] hover:bg-[var(--muted)]"
            } ${isCollapsed ? "justify-center gap-0" : "gap-3"}`}
            onClick={() => setIsEditGroupExpanded((isExpanded) => !isExpanded)}
            title="任务编辑"
            type="button"
          >
            <SidebarIcon name="group" />
            <span
              className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${
                isCollapsed ? "max-w-0 opacity-0" : "max-w-32 opacity-100"
              }`}
            >
              任务编辑
            </span>
            <span
              className={`shrink-0 overflow-hidden text-xs transition-[max-width,opacity,transform] duration-300 ${
                isEditGroupExpanded ? "" : "rotate-180"
              } ${isCollapsed ? "max-w-0 opacity-0" : "max-w-4 opacity-100"}`}
            >
              ▲
            </span>
          </button>

          {isEditGroupExpanded ? (
            <div
              className={`mt-1 flex flex-col gap-1 transition-[padding] duration-300 ${
                isCollapsed ? "pl-0" : "pl-6"
              }`}
            >
              {EDIT_ACTIONS.map((action) => (
                <TreeButton
                  active={activeAction === action.id}
                  collapsed={isCollapsed}
                  icon={action.icon}
                  key={action.id}
                  label={action.label}
                  onClick={() => onSwitch(action.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </nav>
    </aside>
  );
}

function TreeButton({
  active,
  collapsed,
  icon,
  label,
  onClick
}: {
  active: boolean;
  collapsed: boolean;
  icon: SidebarIconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`flex w-full items-center overflow-hidden rounded-md border px-3 py-3 text-left text-sm font-semibold transition ${
        active
          ? "border-[var(--primary)] bg-[#263245] text-[var(--primary)]"
          : "border-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      } ${collapsed ? "justify-center gap-0" : "gap-3"}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <SidebarIcon name={icon} />
      <span
        className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${
          collapsed ? "max-w-0 opacity-0" : "max-w-32 opacity-100"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function SidebarIcon({
  className = "",
  name
}: {
  className?: string;
  name: SidebarIconName;
}) {
  const commonProps = {
    "aria-hidden": true,
    className: `h-5 w-5 shrink-0 ${className}`,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: "2",
    viewBox: "0 0 24 24"
  };

  if (name === "view") {
    return (
      <svg {...commonProps}>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h10" />
      </svg>
    );
  }

  if (name === "group") {
    return (
      <svg {...commonProps}>
        <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M8 9h8" />
        <path d="M8 15h5" />
      </svg>
    );
  }

  if (name === "add") {
    return (
      <svg {...commonProps}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  if (name === "edit") {
    return (
      <svg {...commonProps}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </svg>
    );
  }

  if (name === "delete") {
    return (
      <svg {...commonProps}>
        <path d="M4 7h16" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M6 7l1 13h10l1-13" />
        <path d="M9 7V4h6v3" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M15 6 9 12l6 6" />
    </svg>
  );
}

function TaskList({
  busyTaskId,
  highlightedTaskId,
  isLoading,
  mode,
  onArchive,
  onComplete,
  onDelete,
  onEdit,
  tasks
}: {
  busyTaskId: string | null;
  highlightedTaskId?: string | null;
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
          isHighlighted={highlightedTaskId === task.id}
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
  isHighlighted = false,
  mode,
  onArchive,
  onComplete,
  onDelete,
  onEdit,
  task
}: {
  busyTaskId: string | null;
  isHighlighted?: boolean;
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
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  return (
    <article
      className={`rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 ${
        isHighlighted ? "task-card-success-flash" : ""
      }`}
      data-task-card-id={task.id}
    >
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
        {task.hasDeadline && task.startDate && task.dueDate ? (
          <div className="mb-3 grid gap-3 text-sm sm:grid-cols-3">
            <InfoPill label="开始" value={formatDateTime(task.startDate)} />
            <InfoPill label="剩余" value={task.remainingText} />
            <InfoPill label="DDL" value={formatDateTime(task.dueDate)} />
          </div>
        ) : (
          <div className="text-sm">
            <InfoPill label="DDL" value="未设置" />
          </div>
        )}
        {task.hasDeadline && !isCompleted && task.progress !== null ? (
          <div className="h-2.5 overflow-hidden rounded-md bg-[var(--muted)]">
            <div
              className="h-full rounded-md transition-[width]"
              style={{
                width: `${task.progress}%`,
                backgroundColor: getProgressColor(task.progress)
              }}
            />
          </div>
        ) : null}
      </div>

      {mode === "manage" ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {onEdit ? (
            <TaskActionButton onClick={() => onEdit(task)}>
              编辑
            </TaskActionButton>
          ) : null}
          {onArchive && task.status !== "ARCHIVED" ? (
            <TaskActionButton
              disabled={isBusy}
              onClick={() => onArchive(task.id)}
            >
              归档
            </TaskActionButton>
          ) : null}
          {onDelete && isConfirmingDelete ? (
            <>
              <TaskActionButton
                disabled={isBusy}
                onClick={() => setIsConfirmingDelete(false)}
              >
                取消
              </TaskActionButton>
              <TaskActionButton
                danger
                disabled={isBusy}
                onClick={() => onDelete(task.id)}
              >
                {isBusy ? "删除中..." : "确认删除"}
              </TaskActionButton>
            </>
          ) : null}
          {onDelete && !isConfirmingDelete ? (
            <TaskActionButton
              danger
              disabled={isBusy}
              onClick={() => setIsConfirmingDelete(true)}
            >
              删除
            </TaskActionButton>
          ) : null}
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
  const hasDeadline = Boolean(task.startAt && task.dueAt);
  const startDate = task.startAt ? new Date(task.startAt) : null;
  const dueDate = task.dueAt ? new Date(task.dueAt) : null;
  const deadlineStatus =
    hasDeadline && dueDate
      ? getDeadlineStatus({
          taskStatus: status,
          dueAt: dueDate,
          now
        })
      : getTaskStatusWithoutDeadline(status);

  return {
    ...task,
    status,
    hasDeadline,
    startDate,
    dueDate,
    progress:
      hasDeadline && startDate && dueDate
        ? calculateDeadlineProgress({
            startAt: startDate,
            dueAt: dueDate,
            now
          })
        : null,
    deadlineStatus,
    remainingText: dueDate ? getRemainingText(status, dueDate, now) : "无 DDL"
  };
}

function compareTaskViews(left: TaskView, right: TaskView) {
  const rankDiff = STATUS_RANK[left.status] - STATUS_RANK[right.status];

  if (rankDiff !== 0) {
    return rankDiff;
  }

  if (left.hasDeadline !== right.hasDeadline) {
    return left.hasDeadline ? -1 : 1;
  }

  if (!left.dueDate || !right.dueDate) {
    return (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
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

function getTaskStatusWithoutDeadline(status: TaskStatusValue): DeadlineStatus {
  if (status === "COMPLETED") {
    return "completed";
  }

  if (status === "ARCHIVED") {
    return "archived";
  }

  return "normal";
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
  return {
    ...EMPTY_FORM,
    ...createDefaultDeadlineFields()
  };
}

function createDefaultDeadlineFields() {
  const startAt = new Date();
  const dueAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);

  return {
    startAt: toDatetimeLocalValue(startAt),
    dueAt: toDatetimeLocalValue(dueAt)
  };
}

function formToPayload(form: TaskFormState) {
  if (!form.hasDeadline) {
    return {
      title: form.title,
      description: form.description,
      hasDeadline: false,
      startAt: null,
      dueAt: null
    };
  }

  return {
    title: form.title,
    description: form.description,
    hasDeadline: true,
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

async function parseApiResponse(response: Response): Promise<ApiTaskResponse> {
  const text = await response.text();

  if (!text) {
    return {
      error: response.ok ? "接口没有返回任务数据。" : "请求失败，请稍后再试。"
    };
  }

  try {
    return JSON.parse(text) as ApiTaskResponse;
  } catch {
    return {
      error: "接口返回内容无法解析，请稍后再试。"
    };
  }
}

function redirectToLogin() {
  window.location.href = "/login";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败。";
}
