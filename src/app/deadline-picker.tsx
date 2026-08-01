"use client";

import type { CSSProperties, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

const HOUR_MS = 60 * 60 * 1000;
const VIEWPORT_PADDING_PX = 12;
const TRIGGER_GAP_PX = 8;
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export type DeadlinePickerProps = {
  onChange: (value: string) => void;
  value: string;
};

export function DeadlinePicker({ onChange, value }: DeadlinePickerProps) {
  return (
    <div
      aria-label="截止日期和时间"
      className="deadline-picker-fields"
      role="group"
    >
      <div className="deadline-picker-field">
        <span className="deadline-picker-label">截止日期</span>
        <CalendarDatePicker onChange={onChange} value={value} />
      </div>
      <div className="deadline-picker-field">
        <span className="deadline-picker-label">截止时间</span>
        <TimePicker onChange={onChange} value={value} />
      </div>
    </div>
  );
}

export default DeadlinePicker;

function CalendarDatePicker({ onChange, value }: DeadlinePickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const initialDate =
    parseLocalDateTimeValue(value) ?? getDefaultDeadlineDate();
  const [isOpen, setIsOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(initialDate);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(initialDate.getFullYear(), initialDate.getMonth(), 1)
  );
  const calendarDays = getCalendarDays(visibleMonth);
  const selectedValue = parseLocalDateTimeValue(value);
  const draftIsValid = isFutureDate(draftDate);
  const popoverStyle = useFloatingPickerPosition({
    isOpen,
    popoverRef,
    triggerRef
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        !pickerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && popoverRef.current) {
        trapFocusWithin(event, popoverRef.current);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    const focusFrame = window.requestAnimationFrame(() => {
      popoverRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("backButton", () => {
      setIsOpen(false);
      triggerRef.current?.focus();
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

  function togglePicker() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    const nextDate = parseLocalDateTimeValue(value) ?? getDefaultDeadlineDate();

    setDraftDate(nextDate);
    setVisibleMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    setIsOpen(true);
  }

  function updateDraftDay(day: Date) {
    setDraftDate(
      new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        draftDate.getHours(),
        draftDate.getMinutes()
      )
    );
  }

  function commitDraft() {
    if (!isFutureDate(draftDate)) {
      return;
    }

    onChange(toDatetimeLocalValue(draftDate));
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="deadline-picker" ref={pickerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="选择截止日期"
        className="deadline-picker-trigger"
        onClick={togglePicker}
        ref={triggerRef}
        type="button"
      >
        {selectedValue ? formatDateOnly(selectedValue) : "选择日期"}
      </button>

      {isOpen
        ? createPortal(
            <div
              aria-label="选择截止日期"
              className="deadline-picker-popover deadline-picker-date-popover"
              ref={popoverRef}
              role="dialog"
              style={popoverStyle}
            >
              <div className="deadline-picker-calendar-header">
                <button
                  aria-label="上一年"
                  className="deadline-picker-jump-button"
                  onClick={() =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear() - 1,
                        visibleMonth.getMonth(),
                        1
                      )
                    )
                  }
                  type="button"
                >
                  «
                </button>
                <div className="deadline-picker-month-controls">
                  <button
                    aria-label="上一月"
                    onClick={() =>
                      setVisibleMonth(
                        new Date(
                          visibleMonth.getFullYear(),
                          visibleMonth.getMonth() - 1,
                          1
                        )
                      )
                    }
                    type="button"
                  >
                    ‹
                  </button>
                  <strong>{getMonthTitle(visibleMonth)}</strong>
                  <button
                    aria-label="下一月"
                    onClick={() =>
                      setVisibleMonth(
                        new Date(
                          visibleMonth.getFullYear(),
                          visibleMonth.getMonth() + 1,
                          1
                        )
                      )
                    }
                    type="button"
                  >
                    ›
                  </button>
                </div>
                <button
                  aria-label="下一年"
                  className="deadline-picker-jump-button"
                  onClick={() =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear() + 1,
                        visibleMonth.getMonth(),
                        1
                      )
                    )
                  }
                  type="button"
                >
                  »
                </button>
              </div>

              <div className="deadline-picker-weekdays">
                {WEEKDAY_LABELS.map((dayName) => (
                  <span key={dayName}>{dayName}</span>
                ))}
              </div>

              <div className="deadline-picker-calendar-grid">
                {calendarDays.map((day, index) => {
                  if (!day) {
                    return (
                      <span
                        aria-hidden="true"
                        className="deadline-picker-empty-day"
                        key={`empty-${index}`}
                      />
                    );
                  }

                  const disabled = isPastCalendarDay(day);
                  const selected = isSamePickerDay(day, draftDate);

                  return (
                    <button
                      aria-label={formatAccessibleDate(day)}
                      className={selected ? "is-selected" : ""}
                      disabled={disabled}
                      key={toDateKey(day)}
                      onClick={() => updateDraftDay(day)}
                      type="button"
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>

              {!draftIsValid ? (
                <p
                  aria-live="polite"
                  className="deadline-picker-error"
                  role="status"
                >
                  所选截止时间必须晚于当前时间。
                </p>
              ) : null}

              <PickerActions
                canCommit={draftIsValid}
                onCancel={() => {
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                onCommit={commitDraft}
              />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function TimePicker({ onChange, value }: DeadlinePickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const initialDate =
    parseLocalDateTimeValue(value) ?? getDefaultDeadlineDate();
  const [isOpen, setIsOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(initialDate);
  const [validationNow, setValidationNow] = useState(() => Date.now());
  const selectedValue = parseLocalDateTimeValue(value);
  const draftIsValid = draftDate.getTime() > validationNow;
  const hourOptions = Array.from({ length: 24 }, (_, hour) => hour);
  const minuteOptions = getTimePickerMinuteOptions(draftDate.getMinutes());
  const popoverStyle = useFloatingPickerPosition({
    isOpen,
    popoverRef,
    triggerRef
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        !pickerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && popoverRef.current) {
        trapFocusWithin(event, popoverRef.current);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    const focusFrame = window.requestAnimationFrame(() => {
      popoverRef.current
        ?.querySelector<HTMLElement>(
          '.deadline-time-wheel-option[aria-selected="true"]'
        )
        ?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("backButton", () => {
      setIsOpen(false);
      triggerRef.current?.focus();
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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timer = window.setInterval(
      () => setValidationNow(Date.now()),
      30_000
    );

    return () => window.clearInterval(timer);
  }, [isOpen]);

  function togglePicker() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    setDraftDate(parseLocalDateTimeValue(value) ?? getDefaultDeadlineDate());
    setValidationNow(Date.now());
    setIsOpen(true);
  }

  function updateDraftTime(part: "hour" | "minute", nextValue: number) {
    setDraftDate((currentDate) =>
      updateTimePickerDate(currentDate, part, nextValue)
    );
  }

  function commitDraft() {
    if (!isFutureDate(draftDate)) {
      setValidationNow(Date.now());
      return;
    }

    onChange(toDatetimeLocalValue(draftDate));
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="deadline-picker" ref={pickerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="选择截止时间"
        className="deadline-picker-trigger"
        onClick={togglePicker}
        ref={triggerRef}
        type="button"
      >
        {selectedValue ? formatTimeOnly(selectedValue) : "选择时间"}
      </button>

      {isOpen
        ? createPortal(
            <div
              aria-label="选择截止时间"
              className="deadline-picker-popover deadline-picker-time-popover"
              ref={popoverRef}
              role="dialog"
              style={popoverStyle}
            >
              <div className="deadline-picker-time-preview" aria-live="polite">
                <span>{String(draftDate.getHours()).padStart(2, "0")}</span>
                <strong aria-hidden="true">:</strong>
                <span>{String(draftDate.getMinutes()).padStart(2, "0")}</span>
              </div>

              <div className="deadline-picker-time-row">
                <TimeWheelColumn
                  ariaLabel="小时"
                  label="时"
                  onChange={(nextHour) => updateDraftTime("hour", nextHour)}
                  options={hourOptions}
                  value={draftDate.getHours()}
                />
                <TimeWheelColumn
                  ariaLabel="分钟"
                  label="分"
                  onChange={(nextMinute) =>
                    updateDraftTime("minute", nextMinute)
                  }
                  options={minuteOptions}
                  value={draftDate.getMinutes()}
                />
              </div>

              {!draftIsValid ? (
                <p
                  aria-live="polite"
                  className="deadline-picker-error"
                  role="status"
                >
                  所选截止时间必须晚于当前时间。
                </p>
              ) : null}

              <PickerActions
                canCommit={draftIsValid}
                onCancel={() => {
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                onCommit={commitDraft}
              />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function TimeWheelColumn({
  ariaLabel,
  label,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  label: string;
  onChange: (value: number) => void;
  options: number[];
  value: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    const selectedOption = list?.querySelector<HTMLElement>(
      `[data-time-value="${value}"]`
    );

    if (!list || !selectedOption) {
      return;
    }

    isProgrammaticScrollRef.current = true;
    const listRect = list.getBoundingClientRect();
    const optionRect = selectedOption.getBoundingClientRect();

    list.scrollTop +=
      optionRect.top +
      optionRect.height / 2 -
      (listRect.top + list.clientHeight / 2);
    const frame = window.requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  useEffect(
    () => () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
    },
    []
  );

  function selectNearestVisibleOption() {
    const list = listRef.current;

    if (!list) {
      return;
    }

    const listCenter = list.getBoundingClientRect().top + list.clientHeight / 2;
    const optionElements = Array.from(
      list.querySelectorAll<HTMLElement>("[data-time-value]")
    );
    const nearestOption = optionElements.reduce<HTMLElement | null>(
      (nearest, option) => {
        if (!nearest) {
          return option;
        }

        const optionCenter =
          option.getBoundingClientRect().top + option.clientHeight / 2;
        const nearestCenter =
          nearest.getBoundingClientRect().top + nearest.clientHeight / 2;

        return Math.abs(optionCenter - listCenter) <
          Math.abs(nearestCenter - listCenter)
          ? option
          : nearest;
      },
      null
    );
    const nextValue = Number(nearestOption?.dataset.timeValue);

    if (Number.isFinite(nextValue) && nextValue !== value) {
      onChange(nextValue);
    }
  }

  function handleScroll() {
    if (isProgrammaticScrollRef.current) {
      return;
    }

    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }

    scrollTimerRef.current = window.setTimeout(selectNearestVisibleOption, 90);
  }

  function moveSelection(offset: number, currentValue: number) {
    const currentIndex = options.indexOf(currentValue);
    const nextIndex = Math.min(
      options.length - 1,
      Math.max(0, currentIndex + offset)
    );
    const nextValue = options[nextIndex];

    onChange(nextValue);
    window.requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-time-value="${nextValue}"]`)
        ?.focus();
    });
  }

  return (
    <div className="deadline-time-wheel-column">
      <span className="deadline-time-wheel-label">{label}</span>
      <div
        aria-label={ariaLabel}
        aria-orientation="vertical"
        className="deadline-time-wheel"
        onScroll={handleScroll}
        ref={listRef}
        role="listbox"
        tabIndex={-1}
      >
        {options.map((option) => (
          <button
            aria-selected={option === value}
            className="deadline-time-wheel-option"
            data-time-value={option}
            key={option}
            onClick={() => onChange(option)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(-1, option);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1, option);
              } else if (event.key === "Home") {
                event.preventDefault();
                onChange(options[0]);
              } else if (event.key === "End") {
                event.preventDefault();
                onChange(options.at(-1)!);
              }
            }}
            role="option"
            tabIndex={option === value ? 0 : -1}
            type="button"
          >
            {String(option).padStart(2, "0")}
          </button>
        ))}
      </div>
    </div>
  );
}

function PickerActions({
  canCommit,
  onCancel,
  onCommit
}: {
  canCommit: boolean;
  onCancel: () => void;
  onCommit: () => void;
}) {
  return (
    <div className="deadline-picker-actions">
      <button onClick={onCancel} type="button">
        取消
      </button>
      <button disabled={!canCommit} onClick={onCommit} type="button">
        确认
      </button>
    </div>
  );
}

function useFloatingPickerPosition({
  isOpen,
  popoverRef,
  triggerRef
}: {
  isOpen: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const [style, setStyle] = useState<CSSProperties>({
    bottom: "auto",
    left: VIEWPORT_PADDING_PX,
    maxHeight: `calc(100dvh - ${VIEWPORT_PADDING_PX * 2}px)`,
    overflowY: "auto",
    position: "fixed",
    right: "auto",
    top: VIEWPORT_PADDING_PX,
    visibility: "hidden"
  });

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;

      if (!trigger || !popover) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const naturalHeight = popover.scrollHeight;
      const boundedTriggerTop = Math.min(
        Math.max(triggerRect.top, VIEWPORT_PADDING_PX),
        window.innerHeight - VIEWPORT_PADDING_PX
      );
      const boundedTriggerBottom = Math.min(
        Math.max(triggerRect.bottom, VIEWPORT_PADDING_PX),
        window.innerHeight - VIEWPORT_PADDING_PX
      );
      const availableBelow = Math.max(
        0,
        window.innerHeight -
          boundedTriggerBottom -
          TRIGGER_GAP_PX -
          VIEWPORT_PADDING_PX
      );
      const availableAbove = Math.max(
        0,
        boundedTriggerTop - TRIGGER_GAP_PX - VIEWPORT_PADDING_PX
      );
      const viewportAvailableHeight =
        window.innerHeight - VIEWPORT_PADDING_PX * 2;
      const openAbove = availableAbove >= naturalHeight;
      const openBelow = !openAbove && availableBelow >= naturalHeight;
      const useViewportPlacement = !openAbove && !openBelow;
      const availableHeight = useViewportPlacement
        ? viewportAvailableHeight
        : openAbove
          ? availableAbove
          : availableBelow;
      const minimumHeight = Math.min(120, viewportAvailableHeight);
      const maxHeight = Math.max(
        minimumHeight,
        Math.min(viewportAvailableHeight, availableHeight)
      );
      const renderedHeight = Math.min(naturalHeight, maxHeight);
      const candidateTop = useViewportPlacement
        ? Math.max(
            VIEWPORT_PADDING_PX,
            (window.innerHeight - renderedHeight) / 2
          )
        : openAbove
          ? boundedTriggerTop - TRIGGER_GAP_PX - renderedHeight
          : boundedTriggerBottom + TRIGGER_GAP_PX;
      const maxTop = window.innerHeight - VIEWPORT_PADDING_PX - renderedHeight;
      const top = Math.max(
        VIEWPORT_PADDING_PX,
        Math.min(candidateTop, Math.max(VIEWPORT_PADDING_PX, maxTop))
      );
      const maxLeft =
        window.innerWidth - VIEWPORT_PADDING_PX - popoverRect.width;
      const left = Math.max(
        VIEWPORT_PADDING_PX,
        Math.min(triggerRect.right - popoverRect.width, maxLeft)
      );

      setStyle({
        bottom: "auto",
        left,
        maxHeight,
        overflowY: naturalHeight > maxHeight ? "auto" : "visible",
        overscrollBehavior: "contain",
        position: "fixed",
        right: "auto",
        top,
        visibility: "visible"
      });
    }

    updatePosition();
    const resizeObserver = new ResizeObserver(updatePosition);

    if (popoverRef.current) {
      resizeObserver.observe(popoverRef.current);
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, popoverRef, triggerRef]);

  return style;
}

export function getTimePickerMinuteOptions(currentMinute: number) {
  void currentMinute;

  return Array.from({ length: 60 }, (_, minute) => minute);
}

export function updateTimePickerDate(
  date: Date,
  part: "hour" | "minute",
  value: number
) {
  const nextDate = new Date(date);

  if (part === "hour") {
    nextDate.setHours(Math.min(23, Math.max(0, value)));
  } else {
    nextDate.setMinutes(Math.min(59, Math.max(0, value)));
  }

  return nextDate;
}

function parseLocalDateTimeValue(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getDefaultDeadlineDate() {
  const defaultDate = new Date(Date.now() + HOUR_MS);

  defaultDate.setSeconds(0, 0);

  return defaultDate;
}

function isFutureDate(date: Date) {
  return date.getTime() > Date.now();
}

function isSamePickerDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isPastCalendarDay(date: Date) {
  const dayEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  );

  return dayEnd.getTime() <= Date.now();
}

function getCalendarDays(visibleMonth: Date): Array<Date | null> {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return [
    ...Array.from({ length: firstDay.getDay() }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => new Date(year, month, index + 1)
    )
  ];
}

function getMonthTitle(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatDateOnly(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatTimeOnly(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit"
  }).format(date);
}

function formatAccessibleDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function toDatetimeLocalValue(date: Date) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000
  );

  return localDate.toISOString().slice(0, 16);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function trapFocusWithin(event: KeyboardEvent, container: HTMLElement) {
  const focusableElements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter(
    (element) => !element.hasAttribute("hidden") && element.tabIndex >= 0
  );

  if (focusableElements.length === 0) {
    event.preventDefault();
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
