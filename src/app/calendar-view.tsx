"use client";

import { useMemo, useState } from "react";
import type { DeadlineStatus } from "@/lib/deadline";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const HOUR_MS = 60 * 60 * 1000;
const TIMELINE_HOURS = 72;
const TIMELINE_HALF = TIMELINE_HOURS / 2;

type CalendarTask = {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
  deadlineStatus: DeadlineStatus;
  hasDeadline: boolean;
};

const STATUS_COLORS: Record<DeadlineStatus, string> = {
  normal: "#cfd9f4",
  approaching: "#f5c84c",
  urgent: "#f59e0b",
  overdue: "#ff7a8a",
  completed: "#4bae50",
  archived: "#a5ad9b"
};

type CalendarViewProps = {
  tasks: CalendarTask[];
};

export default function CalendarView({ tasks }: CalendarViewProps) {
  const today = useMemo(() => new Date(), []);
  const [centerMonth, setCenterMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );

  const prevMonth = new Date(
    centerMonth.getFullYear(),
    centerMonth.getMonth() - 1,
    1
  );
  const nextMonth = new Date(
    centerMonth.getFullYear(),
    centerMonth.getMonth() + 1,
    1
  );

  const months = [
    { date: prevMonth, key: "prev" },
    { date: centerMonth, key: "center" },
    { date: nextMonth, key: "next" }
  ];

  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of tasks) {
      if (!task.hasDeadline || !task.dueDate) continue;
      const key = dateKey(task.dueDate);
      const existing = map.get(key) ?? [];
      existing.push(task);
      map.set(key, existing);
    }
    return map;
  }, [tasks]);

  const timelineTasks = useMemo(() => {
    const now = today.getTime();
    const start = now - TIMELINE_HALF * HOUR_MS;
    const end = now + TIMELINE_HALF * HOUR_MS;

    const inRange = tasks
      .filter((t) => {
        if (!t.hasDeadline || !t.dueDate) return false;
        if (t.status !== "ACTIVE") return false;
        const dueMs = t.dueDate.getTime();
        return dueMs >= start && dueMs <= end;
      })
      .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());

    return { now, start, end, tasks: inRange };
  }, [tasks, today]);

  function handleMonthClick(monthKey: string) {
    if (monthKey === "prev") {
      setCenterMonth(
        new Date(centerMonth.getFullYear(), centerMonth.getMonth() - 1, 1)
      );
    } else if (monthKey === "next") {
      setCenterMonth(
        new Date(centerMonth.getFullYear(), centerMonth.getMonth() + 1, 1)
      );
    }
  }

  const rotationStyles: Record<string, React.CSSProperties> = {
    prev: {
      transform: "perspective(900px) rotateY(18deg) scale(0.92)",
      transformOrigin: "right center"
    },
    center: {
      transform: "none",
      zIndex: 2
    },
    next: {
      transform: "perspective(900px) rotateY(-18deg) scale(0.92)",
      transformOrigin: "left center"
    }
  };

  return (
    <section className="flex flex-col gap-8">
      <section>
        <h2 className="mb-5 text-xl font-bold tracking-wide">任务总览</h2>
        <div
          className="flex items-stretch justify-center gap-0"
          style={{ perspective: "1000px" }}
        >
          {months.map((month) => {
            const isCenter = month.key === "center";
            return (
              <button
                key={month.key}
                aria-label={`切换到 ${formatYearMonth(month.date)}`}
                className={`rounded-lg border p-3 text-left transition ${
                  isCenter
                    ? "border-[var(--primary)] bg-[var(--panel)] opacity-100"
                    : "border-[var(--border)] bg-[var(--panel)] opacity-50 hover:opacity-70"
                } ${month.key === "prev" ? "mr-0.5" : ""} ${month.key === "next" ? "ml-0.5" : ""}`}
                disabled={isCenter}
                onClick={() => handleMonthClick(month.key)}
                style={{
                  flex: isCenter ? "1 1 0" : "0.85 1 0",
                  ...rotationStyles[month.key]
                }}
                type="button"
              >
                <MonthGrid
                  isCenter={isCenter}
                  monthDate={month.date}
                  tasksByDay={tasksByDay}
                  today={today}
                />
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-5 text-xl font-bold tracking-wide">近3天任务</h2>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <SeventyTwoHourTimeline timeline={timelineTasks} />
        </div>
      </section>
    </section>
  );
}

function MonthGrid({
  isCenter,
  monthDate,
  tasksByDay,
  today
}: {
  isCenter: boolean;
  monthDate: Date;
  tasksByDay: Map<string, CalendarTask[]>;
  today: Date;
}) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDayOfWeek = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDayOfWeek; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(d);
  }

  const todayKey = dateKey(today);

  return (
    <div>
      <p
        className={`mb-2 text-sm font-bold ${
          isCenter ? "" : "pointer-events-none"
        }`}
      >
        {formatYearMonth(monthDate)}
      </p>
      <div
        className="grid grid-cols-7 gap-px text-center text-xs"
        role="grid"
      >
        {WEEKDAY_LABELS.map((label) => (
          <div
            className="py-1 font-semibold text-[var(--muted-foreground)]"
            key={label}
          >
            {label}
          </div>
        ))}
        {cells.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} />;
          }
          const cellDate = new Date(year, month, day);
          const cellKey = dateKey(cellDate);
          const dayTasks = tasksByDay.get(cellKey) ?? [];
          const isToday = cellKey === todayKey;

          return (
            <div
              className={`flex flex-col items-center gap-0.5 rounded py-1 text-xs ${
                isToday
                  ? "bg-[var(--primary)] font-bold text-[var(--primary-foreground)]"
                  : ""
              }`}
              key={day}
              role="gridcell"
            >
              <span>{day}</span>
              {dayTasks.length > 0 ? (
                <div className="flex gap-0.5">
                  {dayTasks.slice(0, 3).map((task, taskIndex) => (
                    <span
                      className="block size-1.5 rounded-full"
                      key={taskIndex}
                      style={{
                        backgroundColor: STATUS_COLORS[task.deadlineStatus]
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeventyTwoHourTimeline({
  timeline
}: {
  timeline: {
    now: number;
    start: number;
    end: number;
    tasks: CalendarTask[];
  };
}) {
  const { now, start, end, tasks } = timeline;
  const totalMs = end - start;

  function pct(ms: number) {
    return ((ms - start) / totalMs) * 100;
  }

  const scaleMarks = [-36, -24, -12, 0, 12, 24, 36];

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-2.5 h-1 rounded-full bg-[var(--muted)]" />

        <div
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${pct(now)}%` }}
        >
          <div className="flex flex-col items-center">
            <div className="size-3 rounded-full border-2 border-[var(--primary)] bg-[var(--primary)]" />
            <span className="mt-0.5 text-[10px] font-semibold text-[var(--primary)]">
              现在
            </span>
          </div>
        </div>

        {scaleMarks
          .filter((h) => h !== 0)
          .map((h) => {
            const markMs = now + h * HOUR_MS;
            const leftPct = pct(markMs);
            if (leftPct < 2 || leftPct > 98) return null;
            const label =
              h > 0
                ? `+${h}h`
                : `${h}h`;

            return (
              <div
                className="absolute top-2.5 -translate-x-1/2"
                key={h}
                style={{ left: `${leftPct}%` }}
              >
                <div className="size-1.5 rounded-full bg-[var(--muted-foreground)]" />
                <span className="mt-0.5 block text-[10px] leading-none text-[var(--muted-foreground)]">
                  {label}
                </span>
              </div>
            );
          })}
      </div>

      {tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
          未来72小时内没有待办任务
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {tasks.map((task) => {
            const dueMs = task.dueDate!.getTime();
            const taskPct = pct(dueMs);
            const isOverdue = dueMs < now;
            const diffHours = Math.abs(
              Math.round((dueMs - now) / HOUR_MS * 10) / 10
            );

            return (
              <div className="flex items-center gap-2.5" key={task.id}>
                <span
                  className={`w-20 shrink-0 text-right text-[10px] leading-tight ${
                    isOverdue
                      ? "text-[var(--danger)]"
                      : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {isOverdue
                    ? `逾期 ${diffHours}h`
                    : `${diffHours}h 后`}
                </span>
                <div className="relative h-8 flex-1 min-w-0">
                  <div className="absolute inset-0 rounded bg-[var(--muted)]" />

                  <div
                    className="absolute inset-y-0 left-0 rounded-l"
                    style={{
                      width: `${taskPct}%`,
                      backgroundColor:
                        STATUS_COLORS[task.deadlineStatus] + "30"
                    }}
                  />

                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2"
                    style={{ left: `${taskPct}%` }}
                  >
                    <div
                      className="size-3 rounded-full border-2"
                      style={{
                        backgroundColor: STATUS_COLORS[task.deadlineStatus],
                        borderColor: STATUS_COLORS[task.deadlineStatus]
                      }}
                    />
                  </div>

                  <span
                    className="absolute inset-y-0 right-0 flex items-center pr-2 text-xs font-medium"
                    style={{
                      color: STATUS_COLORS[task.deadlineStatus]
                    }}
                  >
                    {task.title}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function dateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatYearMonth(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}
