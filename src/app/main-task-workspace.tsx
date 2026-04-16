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

type WorkspaceAction = "view" | "add" | "edit" | "delete";

const PROGRESS_START_COLOR = "#4bae50";
const PROGRESS_MID_COLOR = "#f5c84c";
const PROGRESS_END_COLOR = "#ff0000";

const EMPTY_FORM = {
  title: "",
  description: "",
  startAt: "",
  dueAt: ""
};

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

const EDIT_ACTIONS: Array<{
  id: Exclude<WorkspaceAction, "view">;
  label: string;
}> = [
  {
    id: "add",
    label: "添加任务"
  },
  {
    id: "edit",
    label: "编辑任务"
  },
  {
    id: "delete",
    label: "删除任务"
  }
];

export function MainTaskWorkspace() {
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [activeAction, setActiveAction] = useState<WorkspaceAction>("view");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(() => createEmptyForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/manage/session", {
          cache: "no-store"
        });
        const payload = (await response.json()) as { authenticated?: boolean };

        setIsAuthenticated(payload.authenticated === true);
      } finally {
        setIsCheckingSession(false);
      }
    }

    void checkSession();
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks
      .map((task) => toTaskView(task, now))
      .filter((task) => task.status !== "ARCHIVED")
      .sort(compareTaskViews);
  }, [now, tasks]);

  const selectedTask = useMemo(() => {
    return selectedTaskId
      ? (visibleTasks.find((task) => task.id === selectedTaskId) ?? null)
      : null;
  }, [selectedTaskId, visibleTasks]);

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

  function switchAction(action: WorkspaceAction) {
    setActiveAction(action);
    setSelectedTaskId(null);
    setForm(createEmptyForm());
    setError(null);
    setLoginError("");
  }

  function selectTaskForEdit(task: TaskView) {
    setSelectedTaskId(task.id);
    setForm(taskToForm(task));
    setError(null);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/manage/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        throw new Error("管理密码不正确。");
      }

      setPassword("");
      setIsAuthenticated(true);
    } catch (loginFailure) {
      setLoginError(getErrorMessage(loginFailure));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formToPayload(form))
      });
      const data = (await response.json()) as ApiTaskResponse;

      if (!response.ok || !data.task) {
        throw new Error(getApiError(data));
      }

      const savedTask = data.task;

      setTasks((currentTasks) => upsertTask(currentTasks, savedTask));
      setForm(createEmptyForm());
      setActiveAction("view");
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedTaskId) {
      setError("请先选择一个任务。");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${selectedTaskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formToPayload(form))
      });
      const data = (await response.json()) as ApiTaskResponse;

      if (!response.ok || !data.task) {
        throw new Error(getApiError(data));
      }

      const savedTask = data.task;

      setTasks((currentTasks) => upsertTask(currentTasks, savedTask));
      setSelectedTaskId(null);
      setForm(createEmptyForm());
      setActiveAction("view");
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteTask(taskId: string) {
    if (!window.confirm("确认删除这个任务吗？")) {
      return;
    }

    setBusyTaskId(taskId);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "DELETE"
      });
      const data = (await response.json()) as ApiTaskResponse;

      if (!response.ok) {
        throw new Error(getApiError(data));
      }

      setTasks((currentTasks) =>
        currentTasks.filter((task) => task.id !== taskId)
      );
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setBusyTaskId(null);
    }
  }

  async function completeTask(taskId: string) {
    setBusyTaskId(taskId);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/complete`, {
        method: "POST"
      });
      const data = (await response.json()) as ApiTaskResponse;

      if (response.status === 401) {
        throw new Error("请先在左侧任务编辑中输入管理密码，再标记完成。");
      }

      if (!response.ok || !data.task) {
        throw new Error(getApiError(data));
      }

      setTasks((currentTasks) => upsertTask(currentTasks, data.task!));
    } catch (completeError) {
      setError(getErrorMessage(completeError));
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <TreeSidebar activeAction={activeAction} onSwitch={switchAction} />

      <section className="min-w-0 flex-1 px-5 py-6 sm:px-6 lg:px-8">
        {activeAction === "view" ? (
          <ViewTasksPanel
            busyTaskId={busyTaskId}
            completeTask={completeTask}
            error={error}
            isLoading={isLoading}
            stats={stats}
            tasks={visibleTasks}
          />
        ) : (
          renderEditPanel({
            activeAction,
            busyTaskId,
            deleteTask,
            error,
            form,
            handleCreateTask,
            handleLogin,
            handleUpdateTask,
            isAuthenticated,
            isCheckingSession,
            isLoading,
            isSubmitting,
            loginError,
            password,
            selectedTask,
            selectTaskForEdit,
            setForm,
            setPassword,
            tasks: visibleTasks
          })
        )}
      </section>
    </div>
  );
}

function TreeSidebar({
  activeAction,
  onSwitch
}: {
  activeAction: WorkspaceAction;
  onSwitch: (action: WorkspaceAction) => void;
}) {
  return (
    <aside className="h-[calc(100vh-4rem)] w-72 shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[#171918] px-4 py-5">
      <nav className="flex flex-col gap-2">
        <TreeButton
          active={activeAction === "view"}
          icon={<ActionIcon action="view" />}
          label="查看任务"
          onClick={() => onSwitch("view")}
        />

        <div className="mt-2">
          <div className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold text-[var(--primary)]">
            <ActionIcon action="group" />
            <span className="flex-1">任务编辑</span>
            <ChevronUpIcon />
          </div>

          <div className="mt-1 flex flex-col gap-1 pl-6">
            {EDIT_ACTIONS.map((action) => (
              <TreeButton
                active={activeAction === action.id}
                icon={<ActionIcon action={action.id} />}
                key={action.id}
                label={action.label}
                onClick={() => onSwitch(action.id)}
              />
            ))}
          </div>
        </div>
      </nav>
    </aside>
  );
}

function TreeButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left text-sm font-semibold transition ${
        active
          ? "border-[var(--primary)] bg-[#263245] text-[var(--primary)]"
          : "border-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ViewTasksPanel({
  busyTaskId,
  completeTask,
  error,
  isLoading,
  stats,
  tasks
}: {
  busyTaskId: string | null;
  completeTask: (taskId: string) => void;
  error: string | null;
  isLoading: boolean;
  stats: {
    total: number;
    active: number;
    approaching: number;
    completed: number;
  };
  tasks: TaskView[];
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <StatsGrid stats={stats} />
      <TaskList
        busyTaskId={busyTaskId}
        completeTask={completeTask}
        error={error}
        isLoading={isLoading}
        tasks={tasks}
      />
    </div>
  );
}

function renderEditPanel({
  activeAction,
  busyTaskId,
  deleteTask,
  error,
  form,
  handleCreateTask,
  handleLogin,
  handleUpdateTask,
  isAuthenticated,
  isCheckingSession,
  isLoading,
  isSubmitting,
  loginError,
  password,
  selectedTask,
  selectTaskForEdit,
  setForm,
  setPassword,
  tasks
}: {
  activeAction: Exclude<WorkspaceAction, "view">;
  busyTaskId: string | null;
  deleteTask: (taskId: string) => void;
  error: string | null;
  form: TaskFormState;
  handleCreateTask: (event: FormEvent<HTMLFormElement>) => void;
  handleLogin: (event: FormEvent<HTMLFormElement>) => void;
  handleUpdateTask: (event: FormEvent<HTMLFormElement>) => void;
  isAuthenticated: boolean;
  isCheckingSession: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  loginError: string;
  password: string;
  selectedTask: TaskView | null;
  selectTaskForEdit: (task: TaskView) => void;
  setForm: (update: (currentForm: TaskFormState) => TaskFormState) => void;
  setPassword: (password: string) => void;
  tasks: TaskView[];
}) {
  if (isCheckingSession) {
    return <EmptyPanel title="正在检查登录状态" body="马上就好。" />;
  }

  if (!isAuthenticated) {
    return (
      <section className="mx-auto max-w-xl rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-xl font-semibold">需要管理密码</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          添加、编辑和删除任务前，请先验证管理密码。
        </p>
        <form
          className="mt-5 flex max-w-sm flex-col gap-3"
          onSubmit={handleLogin}
        >
          <input
            autoComplete="current-password"
            className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="输入管理密码"
            type="password"
            value={password}
          />
          {loginError ? (
            <p className="text-sm font-medium text-[var(--danger)]">
              {loginError}
            </p>
          ) : null}
          <button
            className="h-11 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "验证中..." : "进入操作"}
          </button>
        </form>
      </section>
    );
  }

  if (activeAction === "add") {
    return (
      <section className="mx-auto max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-xl font-semibold">添加任务</h2>
        <TaskForm
          form={form}
          isSubmitting={isSubmitting}
          onChange={setForm}
          onSubmit={handleCreateTask}
          submitLabel="添加任务"
          submittingLabel="添加中..."
        />
        <PanelError error={error} />
      </section>
    );
  }

  if (activeAction === "edit") {
    return (
      <section className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <TaskPicker
          emptyBody="现在没有可编辑的任务。"
          isLoading={isLoading}
          onPick={selectTaskForEdit}
          selectedTaskId={selectedTask?.id ?? null}
          tasks={tasks}
          title="选择要编辑的任务"
        />
        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="text-xl font-semibold">编辑任务</h2>
          {selectedTask ? (
            <TaskForm
              form={form}
              isSubmitting={isSubmitting}
              onChange={setForm}
              onSubmit={handleUpdateTask}
              submitLabel="保存修改"
              submittingLabel="保存中..."
            />
          ) : (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">
              从左侧选择一个任务后，这里会显示编辑表单。
            </p>
          )}
          <PanelError error={error} />
        </section>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="text-xl font-semibold">删除任务</h2>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        删除后任务会从 SQLite 数据库中移除。
      </p>
      <div className="mt-5 flex flex-col gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            正在读取任务。
          </p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            现在没有可删除的任务。
          </p>
        ) : (
          tasks.map((task) => (
            <TaskRow key={task.id} task={task}>
              <button
                className="h-10 rounded-md border border-rose-400/30 bg-rose-400/10 px-4 text-sm font-semibold text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busyTaskId === task.id}
                onClick={() => deleteTask(task.id)}
                type="button"
              >
                {busyTaskId === task.id ? "删除中..." : "删除"}
              </button>
            </TaskRow>
          ))
        )}
      </div>
      <PanelError error={error} />
    </section>
  );
}

function StatsGrid({
  stats
}: {
  stats: {
    total: number;
    active: number;
    approaching: number;
    completed: number;
  };
}) {
  return (
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
  );
}

function TaskList({
  busyTaskId,
  completeTask,
  error,
  isLoading,
  tasks
}: {
  busyTaskId: string | null;
  completeTask: (taskId: string) => void;
  error: string | null;
  isLoading: boolean;
  tasks: TaskView[];
}) {
  if (isLoading) {
    return <EmptyPanel title="正在读取任务" body="DDL 清单马上出现。" />;
  }

  if (tasks.length === 0) {
    return (
      <EmptyPanel title="还没有任务" body="从左侧任务编辑里添加第一个 DDL。" />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {tasks.map((task) => (
        <TaskCard
          busyTaskId={busyTaskId}
          completeTask={completeTask}
          key={task.id}
          task={task}
        />
      ))}
      <PanelError error={error} />
    </section>
  );
}

function TaskCard({
  busyTaskId,
  completeTask,
  task
}: {
  busyTaskId: string | null;
  completeTask: (taskId: string) => void;
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
          ) : (
            <button
              className="inline-flex h-10 items-center justify-center rounded-md bg-[#4bae50] px-4 text-sm font-semibold text-white transition hover:bg-[#449b48] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
              onClick={() => completeTask(task.id)}
              type="button"
            >
              {isBusy ? "处理中..." : "标记完成"}
            </button>
          )}
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
    </article>
  );
}

function TaskForm({
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
    <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
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
            onChange((currentForm) => ({
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

function TaskPicker({
  emptyBody,
  isLoading,
  onPick,
  selectedTaskId,
  tasks,
  title
}: {
  emptyBody: string;
  isLoading: boolean;
  onPick: (task: TaskView) => void;
  selectedTaskId: string | null;
  tasks: TaskView[];
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-5 flex flex-col gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            正在读取任务。
          </p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{emptyBody}</p>
        ) : (
          tasks.map((task) => (
            <TaskRow key={task.id} task={task}>
              <button
                className={`h-10 rounded-md border px-4 text-sm font-semibold ${
                  selectedTaskId === task.id
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)]"
                }`}
                onClick={() => onPick(task)}
                type="button"
              >
                编辑
              </button>
            </TaskRow>
          ))
        )}
      </div>
    </section>
  );
}

function TaskRow({ children, task }: { children: ReactNode; task: TaskView }) {
  const meta = STATUS_META[task.deadlineStatus];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--field)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="break-words font-semibold">{task.title}</p>
          <span
            className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${meta.toneClass}`}
          >
            {meta.label}
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {task.remainingText} · DDL {formatDateTime(task.dueDate)}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function EmptyPanel({ body, title }: { body: string; title: string }) {
  return (
    <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel)] p-8 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{body}</p>
    </section>
  );
}

function PanelError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return (
    <p className="mt-4 rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-medium text-rose-200">
      {error}
    </p>
  );
}

function ActionIcon({ action }: { action: WorkspaceAction | "group" }) {
  const commonProps = {
    "aria-hidden": true,
    className: "h-5 w-5 shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: "2",
    viewBox: "0 0 24 24"
  };

  if (action === "view") {
    return (
      <svg {...commonProps}>
        <path d="M3 5h18" />
        <path d="M3 12h18" />
        <path d="M3 19h18" />
      </svg>
    );
  }

  if (action === "group") {
    return (
      <svg {...commonProps}>
        <path d="M4 4h6l2 3h8v13H4z" />
      </svg>
    );
  }

  if (action === "add") {
    return (
      <svg {...commonProps}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  if (action === "edit") {
    return (
      <svg {...commonProps}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
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

function taskToForm(task: TaskView): TaskFormState {
  return {
    title: task.title,
    description: task.description ?? "",
    startAt: toDatetimeLocalValue(task.startDate),
    dueAt: toDatetimeLocalValue(task.dueDate)
  };
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
