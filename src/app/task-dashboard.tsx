"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateDeadlineProgress,
  DAY_MS,
  DeadlineStatus,
  DEFAULT_APPROACHING_THRESHOLD_MS,
  DEFAULT_URGENT_THRESHOLD_MS,
  getDeadlineStatus,
  getRemainingTimeParts,
  HOUR_MS,
  MINUTE_MS
} from "@/lib/deadline";
import { TaskStatusValue } from "@/lib/task-constants";
import CalendarView from "./calendar-view";

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

type DurationValue = {
  days: number;
  hours: number;
  minutes: number;
};

type DurationUnitKey = keyof DurationValue;

type ReminderSettings = {
  emailReminderEnabled: boolean;
  approachingDuration: DurationValue;
  deadlineDuration: DurationValue;
};

type ReminderThresholds = {
  approachingThresholdMs: number;
  urgentThresholdMs: number;
};

type ApiTaskResponse = {
  task?: TaskDto;
  tasks?: TaskDto[];
  error?: string;
  issues?: Array<{
    message: string;
  }>;
};

type SettingsApiResponse = {
  settings?: {
    emailReminderEnabled?: boolean;
    approachingReminderMinutes?: number;
    urgentReminderMinutes?: number;
  };
  error?: string;
  issues?: Array<{
    message: string;
  }>;
};

type WorkspaceAction = "view" | "add" | "edit" | "settings" | "calendar";
type SidebarIconName =
  | "add"
  | "calendar"
  | "collapse"
  | "edit"
  | "group"
  | "menu"
  | "settings"
  | "view";

const EMPTY_FORM = {
  hasDeadline: true,
  title: "",
  description: "",
  startAt: "",
  dueAt: ""
};

const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  emailReminderEnabled: true,
  approachingDuration: msToDuration(DEFAULT_APPROACHING_THRESHOLD_MS),
  deadlineDuration: msToDuration(DEFAULT_URGENT_THRESHOLD_MS)
};

const EDIT_ACTIONS: Array<{
  id: Extract<WorkspaceAction, "add" | "edit">;
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
  }
];

const VIEW_ACTIONS: Array<{
  id: Extract<WorkspaceAction, "view" | "calendar">;
  icon: SidebarIconName;
  label: string;
}> = [
  {
    id: "view",
    icon: "view",
    label: "任务列表"
  },
  {
    id: "calendar",
    icon: "calendar",
    label: "任务日历"
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
  const [appliedReminderSettings, setAppliedReminderSettings] =
    useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [draftReminderSettings, setDraftReminderSettings] =
    useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
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
    if (!isManageMode) {
      return;
    }

    let isCurrent = true;

    async function loadSettings() {
      setIsSettingsLoading(true);

      try {
        const response = await fetch("/api/settings", {
          cache: "no-store"
        });
        const payload = await parseSettingsResponse(response);

        if (response.status === 401) {
          redirectToLogin();
          return;
        }

        if (!response.ok) {
          throw new Error(getSettingsApiError(payload));
        }

        if (!isCurrent) {
          return;
        }

        const nextSettings = apiSettingsToReminderSettings(payload.settings);

        setAppliedReminderSettings(nextSettings);
        setDraftReminderSettings(nextSettings);
      } catch (settingsError) {
        if (isCurrent) {
          setError(getErrorMessage(settingsError));
        }
      } finally {
        if (isCurrent) {
          setIsSettingsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      isCurrent = false;
    };
  }, [isManageMode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTasks();
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const reminderThresholds = useMemo(
    () => toReminderThresholds(appliedReminderSettings),
    [appliedReminderSettings]
  );

  const visibleTasks = useMemo(() => {
    return tasks
      .map((task) => toTaskView(task, now, reminderThresholds))
      .filter((task) => isManageMode || task.status !== "ARCHIVED")
      .sort(compareTaskViews);
  }, [isManageMode, now, reminderThresholds, tasks]);

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
  const hasVisibleTasks = visibleTasks.length > 0;
  const shouldShowTaskList = isLoading || hasVisibleTasks;
  const settingsHaveChanges = !settingsAreEqual(
    appliedReminderSettings,
    draftReminderSettings
  );

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

  async function saveReminderSettings() {
    if (!settingsHaveChanges) {
      return;
    }

    setIsSettingsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          emailReminderEnabled: draftReminderSettings.emailReminderEnabled,
          approachingReminderMinutes: durationToMinutes(
            draftReminderSettings.approachingDuration
          ),
          urgentReminderMinutes: durationToMinutes(
            draftReminderSettings.deadlineDuration
          )
        })
      });
      const payload = await parseSettingsResponse(response);

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      if (!response.ok) {
        throw new Error(getSettingsApiError(payload));
      }

      const nextSettings = apiSettingsToReminderSettings(payload.settings);

      setAppliedReminderSettings(nextSettings);
      setDraftReminderSettings(nextSettings);
    } catch (settingsError) {
      setError(getErrorMessage(settingsError));
    } finally {
      setIsSettingsSaving(false);
    }
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

      <section className="min-w-0 flex-1 overflow-y-auto py-6 pl-20 pr-5 sm:pr-6 md:px-6 lg:px-8">
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
              onDelete={(taskId) =>
                void runTaskAction(taskId, `/api/tasks/${taskId}`, "DELETE")
              }
              tasks={visibleTasks}
            />
          ) : null}

          {activeAction === "add" ? (
            <section className="grid gap-6 xl:grid-cols-2">
              <section className="min-w-0">
                <TaskEditorForm
                  form={form}
                  isSubmitting={isSubmitting}
                  onChange={setForm}
                  onSubmit={handleSubmit}
                  submitLabel="添加任务"
                  submittingLabel="添加中..."
                />
              </section>
              {shouldShowTaskList ? (
                <section className="min-w-0">
                  <TaskList
                    busyTaskId={busyTaskId}
                    isLoading={isLoading}
                    layout="single"
                    mode="public"
                    tasks={visibleTasks}
                  />
                </section>
              ) : null}
            </section>
          ) : null}

          {activeAction === "edit" ? (
            <section
              className={`grid gap-6 ${
                hasVisibleTasks ? "xl:grid-cols-2" : ""
              }`}
            >
              {editingTaskId ? (
                <section className="min-w-0">
                  <TaskEditorForm
                    form={form}
                    isSubmitting={isSubmitting}
                    onChange={setForm}
                    onSubmit={handleSubmit}
                    submitLabel="保存修改"
                    submittingLabel="保存中..."
                  />
                </section>
              ) : (
                <section className="min-w-0" />
              )}
              {shouldShowTaskList ? (
                <section className="min-w-0">
                  <TaskList
                    busyTaskId={busyTaskId}
                    isLoading={isLoading}
                    layout="single"
                    mode="manage"
                    onEdit={startEditing}
                    tasks={visibleTasks}
                  />
                </section>
              ) : null}
            </section>
          ) : null}

          {activeAction === "settings" ? (
            <section className="grid gap-6 xl:grid-cols-2">
              <section className="min-w-0">
                <SettingsPanel
                  hasChanges={settingsHaveChanges}
                  isEmailReminderPending={isSettingsLoading || isSettingsSaving}
                  isSaving={isSettingsSaving}
                  settings={draftReminderSettings}
                  onCancel={() =>
                    setDraftReminderSettings(appliedReminderSettings)
                  }
                  onChange={setDraftReminderSettings}
                  onSave={() => void saveReminderSettings()}
                />
              </section>
            </section>
          ) : null}

          {activeAction === "calendar" ? (
            <CalendarView
              tasks={visibleTasks.map((t) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                startDate: t.startDate,
                dueDate: t.dueDate,
                deadlineStatus: t.deadlineStatus,
                hasDeadline: t.hasDeadline
              }))}
            />
          ) : null}

          {error ? (
            <p className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-medium text-rose-200">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      <MobileTaskDrawer activeAction={activeAction} onSwitch={switchAction} />
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
        label="紧急任务"
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
  const [isViewGroupExpanded, setIsViewGroupExpanded] = useState(true);
  const [isEditGroupExpanded, setIsEditGroupExpanded] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const viewGroupIsActive = activeAction === "view" || activeAction === "calendar";
  const editGroupIsActive = activeAction === "add" || activeAction === "edit";

  return (
    <aside
      className={`hidden h-full shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[#171918] py-5 transition-[width,padding] duration-300 ease-in-out md:block ${
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
        <div>
          <button
            aria-expanded={isViewGroupExpanded}
            aria-label="查看任务"
            className={`flex w-full items-center overflow-hidden rounded-md border px-3 py-3 text-left text-sm font-semibold transition ${
              viewGroupIsActive
                ? "border-[var(--primary)] bg-[#263245] text-[var(--primary)]"
                : "border-transparent text-[var(--primary)] hover:bg-[var(--muted)]"
            } ${isCollapsed ? "justify-center gap-0" : "gap-3"}`}
            onClick={() => setIsViewGroupExpanded((isExpanded) => !isExpanded)}
            title="查看任务"
            type="button"
          >
            <SidebarIcon name="view" />
            <span
              className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${
                isCollapsed ? "max-w-0 opacity-0" : "max-w-32 opacity-100"
              }`}
            >
              查看任务
            </span>
            <ChevronIcon
              className={`transition-[max-width,opacity,transform] duration-300 ${
                isViewGroupExpanded ? "rotate-180" : "rotate-0"
              } ${isCollapsed ? "max-w-0 opacity-0" : "max-w-5 opacity-100"}`}
            />
          </button>

          <div
            className={`grid overflow-hidden transition-[grid-template-rows,opacity,transform,padding] duration-300 ease-in-out ${
              isViewGroupExpanded
                ? "grid-rows-[1fr] opacity-100 translate-y-0"
                : "grid-rows-[0fr] opacity-0 -translate-y-1"
            } ${isCollapsed ? "pl-0" : "pl-6"}`}
          >
            <div className="min-h-0">
              <div className="mt-1 flex flex-col gap-1">
                {VIEW_ACTIONS.map((action) => (
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
            </div>
          </div>
        </div>

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
            <ChevronIcon
              className={`transition-[max-width,opacity,transform] duration-300 ${
                isEditGroupExpanded ? "rotate-180" : "rotate-0"
              } ${isCollapsed ? "max-w-0 opacity-0" : "max-w-5 opacity-100"}`}
            />
          </button>

          <div
            className={`grid overflow-hidden transition-[grid-template-rows,opacity,transform,padding] duration-300 ease-in-out ${
              isEditGroupExpanded
                ? "grid-rows-[1fr] opacity-100 translate-y-0"
                : "grid-rows-[0fr] opacity-0 -translate-y-1"
            } ${isCollapsed ? "pl-0" : "pl-6"}`}
          >
            <div className="min-h-0">
              <div className="mt-1 flex flex-col gap-1">
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
            </div>
          </div>
        </div>
      </nav>

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <TreeButton
          active={activeAction === "settings"}
          icon="settings"
          label="设置"
          collapsed={isCollapsed}
          onClick={() => onSwitch("settings")}
        />
      </div>
    </aside>
  );
}

function MobileTaskDrawer({
  activeAction,
  onSwitch
}: {
  activeAction: WorkspaceAction;
  onSwitch: (action: WorkspaceAction) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isViewGroupExpanded, setIsViewGroupExpanded] = useState(true);
  const [isEditGroupExpanded, setIsEditGroupExpanded] = useState(true);
  const viewGroupIsActive = activeAction === "view" || activeAction === "calendar";
  const editGroupIsActive = activeAction === "add" || activeAction === "edit";

  function switchAndClose(action: WorkspaceAction) {
    onSwitch(action);
    setIsOpen(false);
  }

  return (
    <>
      {isOpen ? (
        <button
          aria-label="关闭侧边导航栏"
          className="fixed inset-x-0 bottom-0 top-16 z-20 bg-black/45 md:hidden"
          onClick={() => setIsOpen(false)}
          type="button"
        />
      ) : null}

      <aside
        className={`fixed bottom-0 left-0 top-16 z-30 overflow-y-auto border-r border-[var(--border)] bg-[#171918] py-5 transition-[width,padding] duration-300 ease-in-out md:hidden ${
          isOpen ? "w-72 px-4" : "w-16 px-3"
        }`}
      >
        <div
          className={`mb-4 flex ${isOpen ? "justify-end" : "justify-center"}`}
        >
          <button
            aria-expanded={isOpen}
            aria-label={isOpen ? "收起侧边导航栏" : "展开侧边导航栏"}
            className="inline-flex size-10 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => setIsOpen((currentValue) => !currentValue)}
            title={isOpen ? "收起侧边导航栏" : "展开侧边导航栏"}
            type="button"
          >
            <SidebarIcon name={isOpen ? "collapse" : "menu"} />
          </button>
        </div>

        <nav
          className={`flex flex-col gap-2 transition-opacity duration-200 ${
            isOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div>
            <button
              aria-expanded={isViewGroupExpanded}
              aria-label="查看任务"
              className={`flex w-full items-center gap-3 overflow-hidden rounded-md border px-3 py-3 text-left text-sm font-semibold transition ${
                viewGroupIsActive
                  ? "border-[var(--primary)] bg-[#263245] text-[var(--primary)]"
                  : "border-transparent text-[var(--primary)] hover:bg-[var(--muted)]"
              }`}
              onClick={() =>
                setIsViewGroupExpanded((isExpanded) => !isExpanded)
              }
              title="查看任务"
              type="button"
            >
              <SidebarIcon name="view" />
              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                查看任务
              </span>
              <ChevronIcon
                className={`transition-transform duration-300 ${
                  isViewGroupExpanded ? "rotate-180" : "rotate-0"
                }`}
              />
            </button>

            <div
              className={`grid overflow-hidden pl-6 transition-[grid-template-rows,opacity,transform,padding] duration-300 ease-in-out ${
                isViewGroupExpanded
                  ? "grid-rows-[1fr] opacity-100 translate-y-0"
                  : "grid-rows-[0fr] opacity-0 -translate-y-1"
              }`}
            >
              <div className="min-h-0">
                <div className="mt-1 flex flex-col gap-1">
                  {VIEW_ACTIONS.map((action) => (
                    <TreeButton
                      active={activeAction === action.id}
                      collapsed={false}
                      icon={action.icon}
                      key={action.id}
                      label={action.label}
                      onClick={() => switchAndClose(action.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-2">
            <button
              aria-expanded={isEditGroupExpanded}
              aria-label="任务编辑"
              className={`flex w-full items-center gap-3 overflow-hidden rounded-md border px-3 py-3 text-left text-sm font-semibold transition ${
                editGroupIsActive
                  ? "border-[var(--primary)] bg-[#263245] text-[var(--primary)]"
                  : "border-transparent text-[var(--primary)] hover:bg-[var(--muted)]"
              }`}
              onClick={() =>
                setIsEditGroupExpanded((isExpanded) => !isExpanded)
              }
              title="任务编辑"
              type="button"
            >
              <SidebarIcon name="group" />
              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                任务编辑
              </span>
              <ChevronIcon
                className={`transition-transform duration-300 ${
                  isEditGroupExpanded ? "rotate-180" : "rotate-0"
                }`}
              />
            </button>

            <div
              className={`grid overflow-hidden pl-6 transition-[grid-template-rows,opacity,transform,padding] duration-300 ease-in-out ${
                isEditGroupExpanded
                  ? "grid-rows-[1fr] opacity-100 translate-y-0"
                  : "grid-rows-[0fr] opacity-0 -translate-y-1"
              }`}
            >
              <div className="min-h-0">
                <div className="mt-1 flex flex-col gap-1">
                  {EDIT_ACTIONS.map((action) => (
                    <TreeButton
                      active={activeAction === action.id}
                      collapsed={false}
                      icon={action.icon}
                      key={action.id}
                      label={action.label}
                      onClick={() => switchAndClose(action.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <TreeButton
              active={activeAction === "settings"}
              collapsed={false}
              icon="settings"
              label="设置"
              onClick={() => switchAndClose("settings")}
            />
          </div>
        </nav>
      </aside>
    </>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-5 w-5 shrink-0 overflow-hidden ${className}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
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

  if (name === "menu") {
    return (
      <svg {...commonProps}>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
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

  if (name === "calendar") {
    return (
      <svg {...commonProps}>
        <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
        <path d="M16 2v4" />
        <path d="M8 2v4" />
        <path d="M3 10h18" />
        <path d="M8 14h.01" />
        <path d="M12 14h.01" />
        <path d="M16 14h.01" />
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

  if (name === "settings") {
    return (
      <svg {...commonProps}>
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2 2 0 1 1-4 0v-.08a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-1.98.36l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.8 1.8 0 0 0 4.3 15a1.8 1.8 0 0 0-1.65-1.1H2.6a2 2 0 1 1 0-4h.08A1.8 1.8 0 0 0 4.33 8.8a1.8 1.8 0 0 0-.36-1.98l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05a1.8 1.8 0 0 0 1.98.36 1.8 1.8 0 0 0 1.1-1.65V2.6a2 2 0 1 1 4 0v.08a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 1.98-.36l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.1h.08a2 2 0 1 1 0 4h-.08A1.8 1.8 0 0 0 19.4 15Z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M15 6 9 12l6 6" />
    </svg>
  );
}

function SettingsPanel({
  hasChanges,
  isEmailReminderPending,
  isSaving,
  onCancel,
  onChange,
  onSave,
  settings
}: {
  hasChanges: boolean;
  isEmailReminderPending: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (
    update: (currentSettings: ReminderSettings) => ReminderSettings
  ) => void;
  onSave: () => void;
  settings: ReminderSettings;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">设置</h1>
        <div className="flex items-center gap-2">
          {hasChanges ? (
            <button
              className="h-10 rounded-md bg-rose-500 px-4 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onCancel}
              type="button"
            >
              取消变更
            </button>
          ) : null}
          <button
            className={`h-10 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed ${
              hasChanges
                ? "bg-[#4bae50] text-white hover:bg-[#449b48]"
                : "bg-[var(--muted)] text-[var(--muted-foreground)]"
            }`}
            disabled={!hasChanges || isSaving}
            onClick={onSave}
            type="button"
          >
            {isSaving ? "保存中..." : "变更设置"}
          </button>
        </div>
      </div>

      <div className="divide-y divide-[var(--border)]">
        <div className="flex items-center justify-between gap-4 py-4">
          <span className="text-sm font-semibold">邮件提醒</span>
          <button
            aria-checked={settings.emailReminderEnabled}
            aria-label="是否邮件提醒"
            className={`relative h-7 w-12 rounded-full border transition ${
              settings.emailReminderEnabled
                ? "border-[var(--primary)] bg-[var(--primary)]"
                : "border-[var(--border)] bg-[var(--muted)]"
            } disabled:cursor-not-allowed disabled:opacity-60`}
            disabled={isEmailReminderPending}
            onClick={() =>
              onChange((currentSettings) => ({
                ...currentSettings,
                emailReminderEnabled: !currentSettings.emailReminderEnabled
              }))
            }
            role="switch"
            type="button"
          >
            <span
              className={`absolute left-1 top-1 size-5 rounded-full bg-[var(--background)] transition-transform ${
                settings.emailReminderEnabled
                  ? "translate-x-5"
                  : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="flex flex-col gap-5 py-4">
          <SettingsDurationInput
            label="临近时间"
            value={settings.approachingDuration}
            onChange={(nextDuration) =>
              onChange((currentSettings) => ({
                ...currentSettings,
                approachingDuration: nextDuration
              }))
            }
          />
          <SettingsDurationInput
            label="紧急时间"
            value={settings.deadlineDuration}
            onChange={(nextDuration) =>
              onChange((currentSettings) => ({
                ...currentSettings,
                deadlineDuration: nextDuration
              }))
            }
          />
        </div>
      </div>
    </section>
  );
}

function SettingsDurationInput({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: DurationValue) => void;
  value: DurationValue;
}) {
  function updateUnit(unit: DurationUnitKey, nextValue: number) {
    onChange({
      ...value,
      [unit]: nextValue
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-sm text-[var(--muted-foreground)]">
          {formatDurationValue(value)}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <DurationWheelColumn
          max={14}
          onChange={(nextValue) => updateUnit("days", nextValue)}
          unitLabel="天"
          value={value.days}
        />
        <DurationWheelColumn
          max={23}
          onChange={(nextValue) => updateUnit("hours", nextValue)}
          unitLabel="小时"
          value={value.hours}
        />
        <DurationWheelColumn
          max={59}
          onChange={(nextValue) => updateUnit("minutes", nextValue)}
          unitLabel="分钟"
          value={value.minutes}
        />
      </div>
    </div>
  );
}

function DurationWheelColumn({
  max,
  onChange,
  unitLabel,
  value
}: {
  max: number;
  onChange: (value: number) => void;
  unitLabel: string;
  value: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isUserScrollingRef = useRef(false);
  const latestValueRef = useRef(value);
  const options = Array.from({ length: max + 1 }, (_, index) => index);

  function scrollValueIntoView(nextValue: number) {
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-wheel-value="${nextValue}"]`
    );

    target?.scrollIntoView({
      block: "center"
    });
  }

  useEffect(() => {
    latestValueRef.current = value;

    if (!isUserScrollingRef.current) {
      scrollValueIntoView(value);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        window.clearTimeout(scrollTimeoutRef.current);
      }

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  function updateFromScroll() {
    const container = scrollRef.current;

    if (!container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;
    let closestValue = value;
    let closestDistance = Number.POSITIVE_INFINITY;

    container
      .querySelectorAll<HTMLButtonElement>("[data-wheel-value]")
      .forEach((button) => {
        const buttonRect = button.getBoundingClientRect();
        const buttonCenterY = buttonRect.top + buttonRect.height / 2;
        const distance = Math.abs(buttonCenterY - centerY);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestValue = Number(button.dataset.wheelValue);
        }
      });

    if (closestValue !== latestValueRef.current) {
      latestValueRef.current = closestValue;
      onChange(closestValue);
    }
  }

  function handleScroll() {
    isUserScrollingRef.current = true;

    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        updateFromScroll();
      });
    }

    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = window.setTimeout(() => {
      updateFromScroll();
      isUserScrollingRef.current = false;
      scrollValueIntoView(latestValueRef.current);
    }, 160);
  }

  return (
    <div className="relative h-32 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--field)] sm:h-36">
      <div className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-12 -translate-y-1/2 rounded-md bg-[var(--muted)] sm:inset-x-2" />
      <span className="pointer-events-none absolute right-2 top-1/2 z-40 -translate-y-1/2 text-sm font-semibold text-[var(--foreground)] sm:right-5 sm:text-base">
        {unitLabel}
      </span>
      <div className="pointer-events-none absolute inset-0 z-30 bg-[linear-gradient(to_bottom,var(--field)_0%,transparent_30%,transparent_70%,var(--field)_100%)]" />
      <div
        className="relative z-20 h-full snap-y snap-mandatory overflow-y-auto py-10 [scrollbar-width:none] sm:py-11 [&::-webkit-scrollbar]:hidden"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {options.map((option) => {
          const isSelected = option === value;

          return (
            <button
              className={`flex h-12 w-full snap-center items-center justify-center pr-8 text-xl font-semibold transition sm:pr-12 sm:text-3xl ${
                isSelected
                  ? "text-3xl text-[var(--foreground)] sm:text-5xl"
                  : "text-[var(--muted-foreground)] opacity-55"
              }`}
              data-wheel-value={option}
              key={option}
              onClick={() => {
                latestValueRef.current = option;
                onChange(option);
                scrollValueIntoView(option);
              }}
              type="button"
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TaskList({
  busyTaskId,
  highlightedTaskId,
  isLoading,
  layout = "grid",
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
  layout?: "grid" | "single";
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
    return null;
  }

  return (
    <section
      className={`grid gap-4 ${layout === "grid" ? "md:grid-cols-2" : ""}`}
    >
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
  const [isConfirmingComplete, setIsConfirmingComplete] = useState(false);

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
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:self-start">
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
                minWidth
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
              minWidth
              onClick={() => {
                setIsConfirmingComplete(false);
                setIsConfirmingDelete(true);
              }}
            >
              删除任务
            </TaskActionButton>
          ) : null}
          {onComplete && !isCompleted && isConfirmingComplete ? (
            <>
              <TaskActionButton
                disabled={isBusy}
                onClick={() => setIsConfirmingComplete(false)}
              >
                取消
              </TaskActionButton>
              <button
                className="inline-flex h-10 min-w-24 items-center justify-center rounded-md bg-[#4bae50] px-4 text-sm font-semibold text-white transition hover:bg-[#449b48] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy}
                onClick={() => onComplete(task.id)}
                type="button"
              >
                {isBusy ? "处理中..." : "确认完成"}
              </button>
            </>
          ) : null}
          {isCompleted ? (
            <span
              aria-label="已完成"
              className="inline-flex size-10 items-center justify-center rounded-full bg-[#4bae50] text-white shadow-sm"
              title="已完成"
            >
              <CheckIcon />
            </span>
          ) : onComplete && !isConfirmingComplete ? (
            <button
              className="inline-flex h-10 min-w-24 items-center justify-center rounded-md bg-[#4bae50] px-4 text-sm font-semibold text-white transition hover:bg-[#449b48] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
              onClick={() => {
                setIsConfirmingDelete(false);
                setIsConfirmingComplete(true);
              }}
              type="button"
            >
              标记完成
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
  minWidth = false,
  onClick
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  minWidth?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
        danger
          ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
          : "border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)]"
      } ${minWidth ? "min-w-24" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function toTaskView(
  task: TaskDto,
  now: Date,
  reminderThresholds: ReminderThresholds
): TaskView {
  const status = toTaskStatus(task.status);
  const hasDeadline = Boolean(task.startAt && task.dueAt);
  const startDate = task.startAt ? new Date(task.startAt) : null;
  const dueDate = task.dueAt ? new Date(task.dueAt) : null;
  const deadlineStatus =
    hasDeadline && dueDate
      ? getDeadlineStatus({
          taskStatus: status,
          dueAt: dueDate,
          now,
          approachingThresholdMs: reminderThresholds.approachingThresholdMs,
          urgentThresholdMs: reminderThresholds.urgentThresholdMs
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

function msToDuration(totalMs: number): DurationValue {
  const days = Math.floor(totalMs / DAY_MS);
  const hours = Math.floor((totalMs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((totalMs % HOUR_MS) / MINUTE_MS);

  return {
    days: clampDurationUnit(days, 14),
    hours: clampDurationUnit(hours, 23),
    minutes: clampDurationUnit(minutes, 59)
  };
}

function minutesToDuration(totalMinutes: number): DurationValue {
  return msToDuration(totalMinutes * MINUTE_MS);
}

function durationToMinutes(duration: DurationValue) {
  return duration.days * 24 * 60 + duration.hours * 60 + duration.minutes;
}

function toReminderThresholds(settings: ReminderSettings): ReminderThresholds {
  return {
    approachingThresholdMs:
      durationToMinutes(settings.approachingDuration) * MINUTE_MS,
    urgentThresholdMs: durationToMinutes(settings.deadlineDuration) * MINUTE_MS
  };
}

function apiSettingsToReminderSettings(
  settings: SettingsApiResponse["settings"]
): ReminderSettings {
  return {
    emailReminderEnabled:
      settings?.emailReminderEnabled ??
      DEFAULT_REMINDER_SETTINGS.emailReminderEnabled,
    approachingDuration: minutesToDuration(
      settings?.approachingReminderMinutes ??
        durationToMinutes(DEFAULT_REMINDER_SETTINGS.approachingDuration)
    ),
    deadlineDuration: minutesToDuration(
      settings?.urgentReminderMinutes ??
        durationToMinutes(DEFAULT_REMINDER_SETTINGS.deadlineDuration)
    )
  };
}

function settingsAreEqual(left: ReminderSettings, right: ReminderSettings) {
  return (
    left.emailReminderEnabled === right.emailReminderEnabled &&
    durationToMinutes(left.approachingDuration) ===
      durationToMinutes(right.approachingDuration) &&
    durationToMinutes(left.deadlineDuration) ===
      durationToMinutes(right.deadlineDuration)
  );
}

function clampDurationUnit(value: number, max: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(max, Math.max(0, value));
}

function formatDurationValue(duration: DurationValue) {
  return `${duration.days} 天 ${duration.hours} 小时 ${duration.minutes} 分钟`;
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

function getSettingsApiError(data: SettingsApiResponse) {
  if (data.issues && data.issues.length > 0) {
    return data.issues.map((issue) => issue.message).join(" ");
  }

  return data.error || "设置保存失败。";
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

async function parseSettingsResponse(
  response: Response
): Promise<SettingsApiResponse> {
  const text = await response.text();

  if (!text) {
    return {
      error: response.ok ? "接口没有返回设置数据。" : "请求失败，请稍后再试。"
    };
  }

  try {
    return JSON.parse(text) as SettingsApiResponse;
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
