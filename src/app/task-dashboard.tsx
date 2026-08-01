"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  canControlAndroidRecents,
  getAndroidRecentsExcluded,
  setAndroidRecentsExcluded
} from "@/lib/android-recents";
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
import { LocalSettings, LocalTask } from "@/lib/local-app-state";
import { syncAllTaskReminders } from "@/lib/local-reminder-scheduler";
import { localTaskStore } from "@/lib/local-task-store";
import { TaskStatusValue } from "@/lib/task-constants";
import CalendarView from "./calendar-view";
import DeadlinePicker, { TimeWheelColumn } from "./deadline-picker";
import { NotificationSetupGuide } from "./notification-setup-guide";
import { initializeReminderReconciliation } from "./reminder-reconciliation";
import { WallpaperSettings } from "./wallpaper-settings";

type TaskDto = LocalTask;

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

type WorkspaceAction = "view" | "calendar" | "add" | "settings";
type SidebarIconName =
  | "add"
  | "calendar"
  | "collapse"
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

const QUICK_ACTIONS: Array<{
  id: WorkspaceAction;
  icon: SidebarIconName;
  label: string;
}> = [
  {
    id: "view",
    icon: "view",
    label: "查看任务"
  },
  {
    id: "calendar",
    icon: "calendar",
    label: "任务日历"
  },
  {
    id: "add",
    icon: "add",
    label: "添加任务"
  },
  {
    id: "settings",
    icon: "settings",
    label: "设置"
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
    toneClass:
      "border-[var(--status-normal-border)] bg-[var(--status-normal-bg)] text-[var(--status-normal-text)]"
  },
  approaching: {
    label: "临近",
    toneClass:
      "border-[var(--status-approaching-border)] bg-[var(--status-approaching-bg)] text-[var(--status-approaching-text)]"
  },
  urgent: {
    label: "紧急",
    toneClass:
      "border-[var(--status-urgent-border)] bg-[var(--status-urgent-bg)] text-[var(--status-urgent-text)]"
  },
  overdue: {
    label: "已逾期",
    toneClass:
      "border-[var(--status-urgent-border)] bg-[var(--status-urgent-bg)] text-[var(--status-urgent-text)]"
  },
  completed: {
    label: "已完成",
    toneClass:
      "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-text)]"
  },
  archived: {
    label: "已归档",
    toneClass:
      "border-[var(--status-archived-border)] bg-[var(--status-archived-bg)] text-[var(--status-archived-text)]"
  }
};

export function TaskDashboard({ mode }: { mode: "public" | "manage" }) {
  const isManageMode = mode === "manage";
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isErrorTone, setIsErrorTone] = useState(true);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<WorkspaceAction>("view");
  const [form, setForm] = useState<TaskFormState>(() => createEmptyForm());
  const [appliedReminderSettings, setAppliedReminderSettings] =
    useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [draftReminderSettings, setDraftReminderSettings] =
    useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [canHideFromRecents, setCanHideFromRecents] = useState(false);
  const [hideFromRecents, setHideFromRecents] = useState(false);
  const [isRecentsSettingLoading, setIsRecentsSettingLoading] = useState(true);
  const [isRecentsSettingSaving, setIsRecentsSettingSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null
  );
  const pendingFocusTaskId = useRef<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await localTaskStore.listTasks());
    } catch (loadError) {
      setIsErrorTone(true);
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reconcileReminders = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      const state = await localTaskStore.getState();
      const warning = await syncAllTaskReminders(state.tasks, state.settings);

      if (warning) {
        setIsErrorTone(true);
        setError((currentError) => currentError ?? warning);
      }
    } catch {
      setIsErrorTone(true);
      setError(
        (currentError) =>
          currentError ?? "提醒没能自动更新。App 下次打开时会再试。"
      );
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeAppStateListener: (() => Promise<void>) | undefined;

    async function setUpReminderReconciliation() {
      await initializeReminderReconciliation({
        addListener: (eventName, listener) =>
          App.addListener(eventName, listener),
        isDisposed: () => isDisposed,
        onActive: () => {
          if (!isDisposed) {
            setNow(new Date());
            void loadTasks();
            void reconcileReminders();
          }
        },
        onListenerReady: (remove) => {
          removeAppStateListener = remove;
        },
        reconcile: reconcileReminders
      });
    }

    void setUpReminderReconciliation();

    return () => {
      isDisposed = true;
      void removeAppStateListener?.();
    };
  }, [loadTasks, reconcileReminders]);

  useEffect(() => {
    if (!isManageMode) {
      return;
    }

    let isCurrent = true;

    async function loadSettings() {
      setIsSettingsLoading(true);

      try {
        if (!isCurrent) {
          return;
        }

        const nextSettings = localSettingsToReminderSettings(
          await localTaskStore.getSettings()
        );

        setAppliedReminderSettings(nextSettings);
        setDraftReminderSettings(nextSettings);
      } catch (settingsError) {
        if (isCurrent) {
          setIsErrorTone(true);
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
    if (!isManageMode) {
      return;
    }

    const canControlRecents = canControlAndroidRecents();
    let isCurrent = true;

    setCanHideFromRecents(canControlRecents);

    if (!canControlRecents) {
      setIsRecentsSettingLoading(false);
      return;
    }

    async function loadRecentsSetting() {
      setIsRecentsSettingLoading(true);

      try {
        const isExcluded = await getAndroidRecentsExcluded();

        if (isCurrent) {
          setHideFromRecents(isExcluded);
        }
      } catch {
        if (isCurrent) {
          setIsErrorTone(true);
          setError("后台卡片设置没能读取，请稍后重试。");
        }
      } finally {
        if (isCurrent) {
          setIsRecentsSettingLoading(false);
        }
      }
    }

    void loadRecentsSetting();

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
    let interval: number | undefined;
    const delayUntilNextMinute = 60_000 - (Date.now() % 60_000) + 50;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => {
        setNow(new Date());
      }, 60_000);
    }, delayUntilNextMinute);

    return () => {
      window.clearTimeout(timeout);

      if (interval !== undefined) {
        window.clearInterval(interval);
      }
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
  const settingsHaveChanges = !settingsAreEqual(
    appliedReminderSettings,
    draftReminderSettings
  );
  const reminderThresholdOrderIsValid =
    durationToMinutes(draftReminderSettings.approachingDuration) >=
    durationToMinutes(draftReminderSettings.deadlineDuration);

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
    setIsErrorTone(true);

    try {
      const isCreatingTask = editingTaskId === null;
      const payload = formToPayload(form, isCreatingTask);
      const savedTask = editingTaskId
        ? await localTaskStore.updateTask(editingTaskId, payload)
        : await localTaskStore.createTask(payload);

      setTasks((currentTasks) => upsertTask(currentTasks, savedTask));
      resetForm();

      if (isCreatingTask) {
        pendingFocusTaskId.current = savedTask.id;
        setHighlightedTaskId(null);
        setActiveAction("view");
      }

      try {
        const state = await localTaskStore.getState();
        const reminderError = await syncAllTaskReminders(
          state.tasks,
          state.settings
        );

        if (reminderError) {
          setError(reminderError);
        }
      } catch {
        setError("任务已保存，但提醒没有更新成功。App 下次打开时会再试。");
      }
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runTaskAction(
    taskId: string,
    action: "archive" | "complete" | "delete"
  ) {
    setBusyTaskId(taskId);
    setError(null);
    setIsErrorTone(true);

    try {
      if (action === "delete") {
        await localTaskStore.deleteTask(taskId);
        setTasks((currentTasks) =>
          currentTasks.filter((task) => task.id !== taskId)
        );

        try {
          const state = await localTaskStore.getState();
          await syncAllTaskReminders(state.tasks, state.settings);
        } catch {
          setError("任务已删除，但相关提醒还没清除。App 下次打开时会再试。");
        }
      } else {
        const savedTask =
          action === "complete"
            ? await localTaskStore.completeTask(taskId)
            : await localTaskStore.archiveTask(taskId);

        setTasks((currentTasks) => upsertTask(currentTasks, savedTask));

        try {
          const state = await localTaskStore.getState();
          const reminderError = await syncAllTaskReminders(
            state.tasks,
            state.settings
          );

          if (reminderError) {
            setError(reminderError);
          }
        } catch {
          setError(
            "任务状态已更新，但提醒没有更新成功。App 下次打开时会再试。"
          );
        }
      }

      if (editingTaskId === taskId) {
        resetForm();
      }

      return true;
    } catch (actionError) {
      setError(getErrorMessage(actionError));
      return false;
    } finally {
      setBusyTaskId(null);
    }
  }

  function startEditing(task: TaskView) {
    setError(null);
    setIsErrorTone(true);
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
    if (action === activeAction) {
      return;
    }

    setActiveAction(action);
    setError(null);

    if (editingTaskId) {
      resetForm();
    }
  }

  async function saveReminderSettings() {
    if (!settingsHaveChanges || !reminderThresholdOrderIsValid) {
      return;
    }

    setIsSettingsSaving(true);
    setError(null);
    setIsErrorTone(true);

    try {
      const savedSettings = await localTaskStore.updateSettings({
        localReminderEnabled: draftReminderSettings.emailReminderEnabled,
        approachingReminderMinutes: durationToMinutes(
          draftReminderSettings.approachingDuration
        ),
        urgentReminderMinutes: durationToMinutes(
          draftReminderSettings.deadlineDuration
        )
      });
      const nextSettings = localSettingsToReminderSettings(savedSettings);

      setAppliedReminderSettings(nextSettings);
      setDraftReminderSettings(nextSettings);

      try {
        const reminderError = await syncAllTaskReminders(tasks, savedSettings);

        if (reminderError) {
          setError(reminderError);
        }
      } catch {
        setError("设置已保存，但提醒没有更新成功。App 下次打开时会再试。");
      }
    } catch (settingsError) {
      setError(getErrorMessage(settingsError));
    } finally {
      setIsSettingsSaving(false);
    }
  }

  async function toggleHideFromRecents() {
    if (isRecentsSettingLoading || isRecentsSettingSaving) {
      return;
    }

    setIsRecentsSettingSaving(true);
    setError(null);
    setIsErrorTone(true);

    try {
      setHideFromRecents(await setAndroidRecentsExcluded(!hideFromRecents));
    } catch {
      setError("后台卡片设置没能更改，请稍后重试。");
    } finally {
      setIsRecentsSettingSaving(false);
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
              mode="manage"
              onComplete={(taskId) => runTaskAction(taskId, "complete")}
              onDelete={(taskId) => runTaskAction(taskId, "delete")}
              onEdit={startEditing}
              tasks={visibleTasks}
            />
          ) : null}

          {activeAction === "add" ? (
            <section className="mx-auto w-full max-w-3xl">
              <TaskEditorForm
                form={form}
                isSubmitting={isSubmitting}
                onChange={setForm}
                onSubmit={handleSubmit}
                submitLabel="添加任务"
                submittingLabel="添加中…"
              />
            </section>
          ) : null}

          {activeAction === "calendar" ? (
            <CalendarView
              approachingReminderMinutes={durationToMinutes(
                appliedReminderSettings.approachingDuration
              )}
              tasks={tasks}
              urgentReminderMinutes={durationToMinutes(
                appliedReminderSettings.deadlineDuration
              )}
            />
          ) : null}

          {activeAction === "settings" ? (
            <section className="mx-auto w-full max-w-4xl">
              <SettingsPanel
                canHideFromRecents={canHideFromRecents}
                hasChanges={settingsHaveChanges}
                hideFromRecents={hideFromRecents}
                isEmailReminderPending={isSettingsLoading || isSettingsSaving}
                isRecentsSettingPending={
                  isRecentsSettingLoading || isRecentsSettingSaving
                }
                isSaving={isSettingsSaving}
                isThresholdOrderValid={reminderThresholdOrderIsValid}
                settings={draftReminderSettings}
                onCancel={() =>
                  setDraftReminderSettings(appliedReminderSettings)
                }
                onChange={setDraftReminderSettings}
                onToggleHideFromRecents={() => void toggleHideFromRecents()}
                onSave={() => void saveReminderSettings()}
              />
            </section>
          ) : null}

          {error ? (
            <p
              aria-live={isErrorTone ? "assertive" : "polite"}
              className={`form-notice-enter rounded-md border px-4 py-3 text-sm font-medium ${
                isErrorTone
                  ? "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)]"
                  : "border-[var(--border)] bg-[var(--panel-strong)] text-[var(--foreground)]"
              }`}
              role={isErrorTone ? "alert" : "status"}
            >
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {editingTaskId ? (
        <EditTaskDialog
          error={error}
          form={form}
          isSubmitting={isSubmitting}
          onChange={setForm}
          onClose={resetForm}
          onSubmit={handleSubmit}
        />
      ) : null}

      <MobileTaskDrawer activeAction={activeAction} onSwitch={switchAction} />
    </div>
  );
}

function EditTaskDialog({
  error,
  form,
  isSubmitting,
  onChange,
  onClose,
  onSubmit
}: {
  error: string | null;
  form: TaskFormState;
  isSubmitting: boolean;
  onChange: (update: (currentForm: TaskFormState) => TaskFormState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (document.querySelector(".deadline-picker-popover")) {
        return;
      }

      if (event.key === "Tab" && dialogRef.current) {
        trapFocusWithin(event, dialogRef.current);
        return;
      }

      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSubmitting, onClose]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("backButton", () => {
      if (
        !isSubmitting &&
        !document.querySelector(".deadline-picker-popover")
      ) {
        onClose();
      }
    }).then((listener) => {
      if (isDisposed) {
        void listener.remove();
      } else {
        removeListener = () => listener.remove();
      }
    });

    return () => {
      isDisposed = true;
      void removeListener?.();
    };
  }, [isSubmitting, onClose]);

  return createPortal(
    <div
      className="dialog-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isSubmitting) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby="edit-task-title"
        aria-modal="true"
        className="dialog-panel glass-panel max-h-[calc(100dvh-2rem)] w-[min(760px,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-[var(--border)] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.42)]"
        ref={dialogRef}
        role="dialog"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold" id="edit-task-title">
            编辑任务
          </h2>
          <button
            aria-label="关闭编辑任务"
            className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--danger)] bg-[var(--error-bg)] text-2xl leading-none text-[var(--danger)] transition hover:bg-[var(--muted)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <TaskEditorForm
          form={form}
          isSubmitting={isSubmitting}
          onChange={onChange}
          onSubmit={onSubmit}
          submitLabel="保存修改"
          submittingLabel="保存中…"
          variant="dialog"
        />
        {error ? (
          <p
            aria-live="assertive"
            className="mt-4 rounded-md border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3 text-sm font-medium text-[var(--error-text)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </section>
    </div>,
    document.body
  );
}

function TaskEditorForm({
  form,
  isSubmitting,
  onChange,
  onSubmit,
  submitLabel,
  submittingLabel,
  variant = "panel"
}: {
  form: TaskFormState;
  isSubmitting: boolean;
  onChange: (update: (currentForm: TaskFormState) => TaskFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  submittingLabel: string;
  variant?: "dialog" | "panel";
}) {
  return (
    <form
      className={`flex flex-col gap-4 ${
        variant === "panel"
          ? "glass-panel rounded-lg border border-[var(--border)] p-5"
          : ""
      }`}
      onSubmit={onSubmit}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        标题
        <input
          autoFocus={variant === "dialog"}
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
            name="deadline-mode"
            onChange={() =>
              onChange((currentForm) => {
                const deadlineFields = !currentForm.dueAt
                  ? createDefaultDeadlineFields()
                  : {};

                return {
                  ...currentForm,
                  ...deadlineFields,
                  hasDeadline: true
                };
              })
            }
            type="radio"
          />
          设置 DDL
        </label>

        <label className="flex items-center gap-3">
          <input
            checked={!form.hasDeadline}
            className="size-4 accent-[var(--primary)]"
            name="deadline-mode"
            onChange={() =>
              onChange((currentForm) => ({
                ...currentForm,
                hasDeadline: false
              }))
            }
            type="radio"
          />
          不设置 DDL
        </label>
      </div>

      {form.hasDeadline ? (
        <DeadlinePicker
          onChange={(dueAt) =>
            onChange((currentForm) => ({
              ...currentForm,
              dueAt
            }))
          }
          value={form.dueAt}
        />
      ) : null}

      <button
        className="h-11 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || !form.title.trim()}
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
    <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatBlock
        cardClass="border-[#57bfda] bg-[#57bfda]"
        label="进行中"
        labelClass="text-[#102018]"
        value={stats.normal}
        valueClass="text-[#102018]"
      />
      <StatBlock
        cardClass="border-[#f5c84c] bg-[#f5c84c]"
        label="临近截止"
        labelClass="text-[#332600]"
        value={stats.approaching}
        valueClass="text-[#332600]"
      />
      <StatBlock
        cardClass="border-[#cf2e24] bg-[#cf2e24]"
        label="紧急任务"
        labelClass="text-white"
        value={stats.urgent}
        valueClass="text-white"
      />
      <StatBlock
        cardClass="border-[#4bae50] bg-[#4bae50]"
        label="已完成"
        labelClass="text-[#102018]"
        value={stats.completed}
        valueClass="text-[#102018]"
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
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside
      className={`hidden h-full shrink-0 overflow-x-hidden overflow-y-auto border-r border-[var(--border)] bg-[var(--glass-sidebar)] py-5 backdrop-blur-xl transition-[width,padding] duration-300 ease-in-out md:block ${
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
        {QUICK_ACTIONS.slice(0, -1).map((action) => (
          <TreeButton
            active={activeAction === action.id}
            collapsed={isCollapsed}
            icon={action.icon}
            key={action.id}
            label={action.label}
            onClick={() => onSwitch(action.id)}
          />
        ))}
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
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("backButton", () => {
      setIsOpen(false);
      toggleButtonRef.current?.focus();
    }).then((listener) => {
      if (isDisposed) {
        void listener.remove();
      } else {
        removeListener = () => listener.remove();
      }
    });

    return () => {
      isDisposed = true;
      void removeListener?.();
    };
  }, [isOpen]);

  function switchAndClose(action: WorkspaceAction) {
    onSwitch(action);
    setIsOpen(false);
  }

  return (
    <>
      {isOpen ? (
        <button
          aria-label="关闭侧边导航栏"
          className="fixed inset-x-0 bottom-0 top-16 z-40 bg-black/45 md:hidden"
          onClick={() => setIsOpen(false)}
          type="button"
        />
      ) : null}

      <aside
        className={`fixed bottom-0 left-0 top-16 z-50 overflow-x-hidden overflow-y-auto border-r border-[var(--border)] bg-[var(--glass-sidebar)] py-5 backdrop-blur-xl transition-[width,padding] duration-300 ease-in-out md:hidden ${
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
            ref={toggleButtonRef}
            title={isOpen ? "收起侧边导航栏" : "展开侧边导航栏"}
            type="button"
          >
            <SidebarIcon name={isOpen ? "collapse" : "menu"} />
          </button>
        </div>

        {isOpen ? (
          <nav className="flex flex-col gap-2">
            {QUICK_ACTIONS.slice(0, -1).map((action) => (
              <TreeButton
                active={activeAction === action.id}
                collapsed={false}
                icon={action.icon}
                key={action.id}
                label={action.label}
                onClick={() => switchAndClose(action.id)}
              />
            ))}
            <div className="mt-2 border-t border-[var(--border)] pt-4">
              <TreeButton
                active={activeAction === "settings"}
                collapsed={false}
                icon="settings"
                label="设置"
                onClick={() => switchAndClose("settings")}
              />
            </div>
          </nav>
        ) : (
          <nav className="flex flex-col gap-2">
            {QUICK_ACTIONS.map((action) => (
              <TreeButton
                active={activeAction === action.id}
                collapsed
                icon={action.icon}
                key={action.id}
                label={action.label}
                onClick={() => onSwitch(action.id)}
              />
            ))}
          </nav>
        )}
      </aside>
    </>
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
      className={`flex w-full items-center overflow-hidden rounded-md border py-3 text-left text-sm font-semibold transition ${
        active
          ? "border-[var(--primary)] bg-[var(--active-surface)] text-[var(--primary)]"
          : "border-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      } ${collapsed ? "justify-center gap-0 px-0" : "gap-3 px-3"}`}
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
        <path d="M8 4h8" />
        <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1Z" />
        <path d="M16 4h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m8 12 2 2 4-4" />
        <path d="M8 18h7" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg {...commonProps}>
        <rect height="17" rx="2" width="18" x="3" y="4" />
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <path d="M3 9h18" />
        <path d="M8 13h.01" />
        <path d="M12 13h.01" />
        <path d="M16 13h.01" />
        <path d="M8 17h.01" />
        <path d="M12 17h.01" />
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
  canHideFromRecents,
  hasChanges,
  hideFromRecents,
  isEmailReminderPending,
  isRecentsSettingPending,
  isSaving,
  isThresholdOrderValid,
  onCancel,
  onChange,
  onSave,
  onToggleHideFromRecents,
  settings
}: {
  canHideFromRecents: boolean;
  hasChanges: boolean;
  hideFromRecents: boolean;
  isEmailReminderPending: boolean;
  isRecentsSettingPending: boolean;
  isSaving: boolean;
  isThresholdOrderValid: boolean;
  onCancel: () => void;
  onChange: (
    update: (currentSettings: ReminderSettings) => ReminderSettings
  ) => void;
  onSave: () => void;
  onToggleHideFromRecents: () => void;
  settings: ReminderSettings;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="glass-panel rounded-xl border border-[var(--border)] p-5 shadow-2xl shadow-black/20 sm:p-7">
        <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold">设置</h1>
          <div
            className={`grid w-full gap-2 sm:flex sm:w-auto sm:items-center sm:justify-end ${
              hasChanges ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {hasChanges ? (
              <button
                className="inline-flex h-10 min-w-0 items-center justify-center whitespace-nowrap rounded-md bg-rose-500 px-3 text-sm font-semibold leading-none text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-24 sm:px-4"
                disabled={isSaving}
                onClick={onCancel}
                type="button"
              >
                取消变更
              </button>
            ) : null}
            <button
              className={`inline-flex h-10 min-w-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-semibold leading-none transition disabled:cursor-not-allowed sm:min-w-24 sm:px-4 ${
                hasChanges && isThresholdOrderValid
                  ? "bg-[var(--success)] text-white hover:bg-[var(--success-hover)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]"
              }`}
              disabled={!hasChanges || isSaving || !isThresholdOrderValid}
              onClick={onSave}
              type="button"
            >
              {isSaving ? "保存中…" : "保存提醒设置"}
            </button>
          </div>
        </div>

        <div className="divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between gap-4 py-4">
            <span className="text-sm font-semibold">任务提醒</span>
            <button
              aria-checked={settings.emailReminderEnabled}
              aria-label="启用系统通知提醒"
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

          <NotificationSetupGuide />

          <div className="flex flex-col gap-5 py-4">
            <SettingsDurationInput
              label="临近提醒"
              value={settings.approachingDuration}
              onChange={(nextDuration) =>
                onChange((currentSettings) => ({
                  ...currentSettings,
                  approachingDuration: nextDuration
                }))
              }
            />
            <SettingsDurationInput
              label="紧急提醒"
              value={settings.deadlineDuration}
              onChange={(nextDuration) =>
                onChange((currentSettings) => ({
                  ...currentSettings,
                  deadlineDuration: nextDuration
                }))
              }
            />
            {!isThresholdOrderValid ? (
              <p
                className="rounded-md border border-[var(--error-border)] bg-[var(--error-bg)] px-3 py-2 text-sm font-medium text-[var(--error-text)]"
                role="alert"
              >
                临近提醒应早于或同时于紧急提醒。
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {canHideFromRecents ? (
        <section className="glass-panel rounded-xl border border-[var(--border)] px-5 shadow-2xl shadow-black/20 sm:px-7">
          <div className="flex items-center justify-between gap-5 py-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">隐藏后台卡片</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                开启后，DDL-Reminder
                不会出现在系统最近任务中。桌面图标照常能打开，任务提醒也不受影响。
              </p>
            </div>
            <button
              aria-checked={hideFromRecents}
              aria-label="隐藏系统最近任务中的应用卡片"
              className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
                hideFromRecents
                  ? "border-[var(--primary)] bg-[var(--primary)]"
                  : "border-[var(--border)] bg-[var(--muted)]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={isRecentsSettingPending}
              onClick={onToggleHideFromRecents}
              role="switch"
              type="button"
            >
              <span
                className={`absolute left-1 top-1 size-5 rounded-full bg-[var(--background)] transition-transform ${
                  hideFromRecents ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </section>
      ) : null}

      <div className="glass-panel rounded-xl border border-[var(--border)] px-5 shadow-2xl shadow-black/20 sm:px-7">
        <WallpaperSettings />
      </div>
    </div>
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
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function updateUnit(unit: DurationUnitKey, nextValue: number) {
    setDraftValue((currentValue) => ({
      ...currentValue,
      [unit]: nextValue
    }));
  }

  const closePicker = useCallback(() => {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && dialogRef.current) {
        trapFocusWithin(event, dialogRef.current);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(
          '.deadline-time-wheel-option[aria-selected="true"]'
        )
        ?.focus();
    });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePicker, isOpen]);

  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("backButton", closePicker).then((listener) => {
      if (isDisposed) {
        void listener.remove();
      } else {
        removeListener = () => listener.remove();
      }
    });

    return () => {
      isDisposed = true;
      void removeListener?.();
    };
  }, [closePicker, isOpen]);

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="flex w-full items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--field)] px-4 py-3 text-left transition hover:border-[var(--primary)] hover:bg-[var(--active-surface)] focus-visible:border-[var(--primary)] focus-visible:outline-none"
        onClick={() => {
          setDraftValue(value);
          setIsOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="min-w-0">
          <strong className="block text-sm">{label}</strong>
          <span className="mt-1 block text-sm font-semibold text-[var(--primary)]">
            截止前 {formatDurationValue(value)}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 text-xl leading-none text-[var(--muted-foreground)]"
        >
          ›
        </span>
      </button>

      {isOpen
        ? createPortal(
            <div
              className="dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3"
              onPointerDown={(event) => {
                if (event.currentTarget === event.target) {
                  closePicker();
                }
              }}
              role="presentation"
            >
              <section
                aria-label={`设置${label}`}
                aria-modal="true"
                className="dialog-panel deadline-picker-popover reminder-duration-dialog"
                ref={dialogRef}
                role="dialog"
              >
                <div className="mb-3 text-center">
                  <h2 className="text-lg font-semibold">设置{label}</h2>
                </div>

                <div
                  aria-live="polite"
                  className="deadline-picker-time-preview reminder-duration-preview"
                >
                  <span>截止前 {formatDurationValue(draftValue)}</span>
                </div>

                <div className="reminder-duration-grid">
                  <TimeWheelColumn
                    ariaLabel={`${label}：天`}
                    label="天"
                    onChange={(nextValue) => updateUnit("days", nextValue)}
                    options={Array.from({ length: 15 }, (_, day) => day)}
                    value={draftValue.days}
                  />
                  <TimeWheelColumn
                    ariaLabel={`${label}：小时`}
                    label="时"
                    onChange={(nextValue) => updateUnit("hours", nextValue)}
                    options={Array.from({ length: 24 }, (_, hour) => hour)}
                    value={draftValue.hours}
                  />
                  <TimeWheelColumn
                    ariaLabel={`${label}：分钟`}
                    label="分"
                    onChange={(nextValue) => updateUnit("minutes", nextValue)}
                    options={Array.from({ length: 60 }, (_, minute) => minute)}
                    value={draftValue.minutes}
                  />
                </div>

                <div className="deadline-picker-actions">
                  <button onClick={closePicker} type="button">
                    取消
                  </button>
                  <button
                    onClick={() => {
                      onChange(draftValue);
                      closePicker();
                    }}
                    type="button"
                  >
                    确定
                  </button>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
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
  onComplete?: (taskId: string) => Promise<boolean>;
  onDelete?: (taskId: string) => Promise<boolean>;
  onEdit?: (task: TaskView) => void;
  tasks: TaskView[];
}) {
  if (isLoading) {
    return (
      <section className="glass-panel rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-lg font-semibold">正在加载任务</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">请稍候…</p>
      </section>
    );
  }

  if (tasks.length === 0) {
    return (
      <section className="glass-panel rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
        <p className="text-lg font-semibold">暂无任务</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {mode === "manage"
            ? "点击“添加任务”，创建第一项任务。"
            : "目前还没有可显示的任务。"}
        </p>
      </section>
    );
  }

  return (
    <section
      className={`task-list-enter grid gap-4 ${
        layout === "grid" ? "xl:grid-cols-2" : ""
      }`}
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
  onComplete?: (taskId: string) => Promise<boolean>;
  onDelete?: (taskId: string) => Promise<boolean>;
  onEdit?: (task: TaskView) => void;
  task: TaskView;
}) {
  const meta = STATUS_META[task.deadlineStatus];
  const isBusy = busyTaskId === task.id;
  const isCompleted = task.status === "COMPLETED";
  const canComplete = task.status === "ACTIVE";
  const [pendingAction, setPendingAction] = useState<
    "complete" | "delete" | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function confirmPendingAction() {
    const action = pendingAction;

    setPendingAction(null);

    if (action === "delete" && onDelete) {
      setIsDeleting(true);
      await waitForUiAnimation(220);

      const succeeded = await onDelete(task.id);

      if (!succeeded) {
        setIsDeleting(false);
      }
    } else if (action === "complete" && onComplete) {
      await onComplete(task.id);
    }
  }

  return (
    <>
      <article
        className={`glass-panel rounded-lg border border-[var(--border)] p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-[0_14px_34px_rgba(0,0,0,0.2)] ${
          isHighlighted ? "task-card-success-flash" : ""
        } ${isDeleting ? "task-card-leave" : ""}`}
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
            {mode === "manage" && onEdit ? (
              <TaskActionButton
                disabled={isBusy || isDeleting}
                onClick={() => onEdit(task)}
              >
                编辑任务
              </TaskActionButton>
            ) : null}
            {onDelete ? (
              <TaskActionButton
                danger
                disabled={isBusy || isDeleting}
                minWidth
                onClick={() => setPendingAction("delete")}
              >
                删除任务
              </TaskActionButton>
            ) : null}
            {isCompleted ? (
              <span
                aria-label="已完成"
                className="complete-badge-pop inline-flex size-10 items-center justify-center rounded-full bg-[var(--success)] text-white shadow-sm"
                title="已完成"
              >
                <CheckIcon />
              </span>
            ) : onComplete && canComplete ? (
              <button
                className="inline-flex h-10 min-w-24 items-center justify-center rounded-md bg-[var(--success)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--success-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy || isDeleting}
                onClick={() => setPendingAction("complete")}
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
              <InfoPill
                label="创建时间"
                value={formatDateTime(task.startDate)}
              />
              <InfoPill label="剩余时间" value={task.remainingText} />
              <InfoPill label="截止时间" value={formatDateTime(task.dueDate)} />
            </div>
          ) : (
            <div className="text-sm">
              <InfoPill label="截止时间" value="未设置" />
            </div>
          )}
          {task.hasDeadline && canComplete && task.progress !== null ? (
            <div className="h-2.5 overflow-hidden rounded-md bg-[var(--muted)]">
              <div
                className="h-full rounded-md transition-[width,background-color] duration-200"
                style={{
                  width: `${task.progress}%`,
                  backgroundColor: getProgressColor(task.progress)
                }}
              />
            </div>
          ) : null}
        </div>

        {mode === "manage" && onArchive && task.status !== "ARCHIVED" ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <TaskActionButton
              disabled={isBusy}
              onClick={() => onArchive(task.id)}
            >
              归档
            </TaskActionButton>
          </div>
        ) : null}
      </article>

      {pendingAction ? (
        <ConfirmDialog
          confirmTone={pendingAction === "delete" ? "danger" : "success"}
          isBusy={isBusy}
          message={
            pendingAction === "delete"
              ? `确定删除任务“${task.title}”吗？`
              : `确定将任务“${task.title}”标记为已完成吗？`
          }
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmPendingAction()}
        />
      ) : null}
    </>
  );
}

function ConfirmDialog({
  confirmTone,
  isBusy,
  message,
  onCancel,
  onConfirm
}: {
  confirmTone: "danger" | "success";
  isBusy: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && dialogRef.current) {
        trapFocusWithin(event, dialogRef.current);
        return;
      }

      if (event.key === "Escape" && !isBusy) {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBusy, onCancel]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("backButton", () => {
      if (!isBusy) {
        onCancel();
      }
    }).then((listener) => {
      if (isDisposed) {
        void listener.remove();
      } else {
        removeListener = () => listener.remove();
      }
    });

    return () => {
      isDisposed = true;
      void removeListener?.();
    };
  }, [isBusy, onCancel]);

  return createPortal(
    <div
      className="dialog-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isBusy) {
          onCancel();
        }
      }}
      role="presentation"
    >
      <section
        aria-describedby="confirm-dialog-message"
        aria-modal="true"
        className="dialog-panel glass-panel w-[min(380px,calc(100vw-2rem))] rounded-lg border border-[var(--border)] p-6 text-center shadow-[0_22px_60px_rgba(0,0,0,0.42)]"
        ref={dialogRef}
        role="dialog"
      >
        <p
          className="text-base font-bold leading-7"
          id="confirm-dialog-message"
        >
          {message}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            autoFocus
            className="inline-flex h-10 min-w-20 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-4 text-sm font-semibold transition hover:bg-[var(--muted)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className={`inline-flex h-10 min-w-20 items-center justify-center rounded-md border px-4 text-sm font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 ${
              confirmTone === "danger"
                ? "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)]"
                : "border-[var(--success)] bg-[var(--success)] text-white hover:bg-[var(--success-hover)]"
            }`}
            disabled={isBusy}
            onClick={onConfirm}
            type="button"
          >
            {isBusy ? "处理中…" : confirmTone === "danger" ? "删除" : "完成"}
          </button>
        </div>
      </section>
    </div>,
    document.body
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
          ? "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)]"
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
    remainingText: dueDate
      ? getRemainingText(status, dueDate, now)
      : "未设置截止时间"
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
    return "不到 1 分钟";
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

  dueAt.setSeconds(0, 0);

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

function localSettingsToReminderSettings(
  settings: LocalSettings
): ReminderSettings {
  return {
    emailReminderEnabled: settings.localReminderEnabled,
    approachingDuration: minutesToDuration(settings.approachingReminderMinutes),
    deadlineDuration: minutesToDuration(settings.urgentReminderMinutes)
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

function formToPayload(form: TaskFormState, isCreatingTask: boolean) {
  if (!form.hasDeadline) {
    return {
      title: form.title,
      description: form.description,
      hasDeadline: false,
      startAt: null,
      dueAt: null
    };
  }

  const payload = {
    title: form.title,
    description: form.description,
    hasDeadline: true,
    dueAt: new Date(form.dueAt).toISOString()
  };

  if (isCreatingTask || !form.startAt) {
    return payload;
  }

  return {
    ...payload,
    startAt: new Date(form.startAt).toISOString()
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

function waitForUiAnimation(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function trapFocusWithin(event: KeyboardEvent, container: HTMLElement) {
  const focusableElements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden"));

  if (focusableElements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements.at(-1)!;
  const activeElement = document.activeElement;

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (
    !event.shiftKey &&
    (activeElement === lastElement || !container.contains(activeElement))
  ) {
    event.preventDefault();
    firstElement.focus();
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
