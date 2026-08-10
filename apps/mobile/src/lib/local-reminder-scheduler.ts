import { Capacitor, type PermissionState } from "@capacitor/core";
import {
  LocalNotifications,
  type LocalNotificationSchema
} from "@capacitor/local-notifications";
import {
  getAndroidPowerStatus,
  type AndroidPowerStatus,
  openAndroidNotificationChannelSettings
} from "./android-power";
import { cancelAllLegacyNativeDdlAlarms } from "./ddl-alarms";
import { LocalSettings, LocalTask } from "./local-app-state";

type ReminderKind = "approaching" | "urgent" | "due";

export type PlannedTaskReminder = {
  id: number;
  kind: ReminderKind;
  taskId: string;
  taskTitle: string;
  title: string;
  body: string;
  at: Date;
};

type ExactAlarmPermissionStatus = "granted" | "denied" | "unknown";

export type ReminderChannelDiagnostics = {
  applicable: boolean;
  enabled: boolean | null;
  exists: boolean | null;
  importance: number | null;
  vibration: boolean | null;
};

export type NotificationDiagnostics = {
  channel: ReminderChannelDiagnostics;
  exactAlarm: ExactAlarmPermissionStatus;
  isNative: boolean;
  notificationPermission: PermissionState | "unknown";
  pendingCount: number | null;
  platform: string;
  power: AndroidPowerStatus | null;
};

const REMINDER_CHANNEL_ID = "ddl-reminders-v2";
const REMINDER_SMALL_ICON = "ic_stat_ddl";
const TEST_NOTIFICATION_ID = 2_147_000_001;
const SCHEDULED_TEST_NOTIFICATION_ID = 2_147_000_002;
const SCHEDULED_TEST_DELAY_MS = 15_000;
const IOS_PENDING_NOTIFICATION_LIMIT = 64;
const IOS_RESERVED_TEST_NOTIFICATION_SLOTS = 2;
const IOS_TASK_REMINDER_LIMIT =
  IOS_PENDING_NOTIFICATION_LIMIT - IOS_RESERVED_TEST_NOTIFICATION_SLOTS;
const IOS_PENDING_VERIFICATION_ATTEMPTS = 4;
const IOS_PENDING_VERIFICATION_DELAY_MS = 100;
const NOTIFICATION_PERMISSION_ERROR =
  "通知权限还没打开。任务已经保存，但可能收不到提醒。";
const EXACT_ALARM_PERMISSION_WARNING =
  "“闹钟和提醒”权限还没打开。通知仍会发送，但可能晚一些。";
const EXACT_ALARM_STATUS_UNKNOWN_WARNING =
  "暂时无法确认“闹钟和提醒”权限。通知仍会发送，但可能晚一些。";
const IOS_NOTIFICATION_LIMIT_WARNING =
  "iOS 当前只保留最近的 62 条任务提醒，其余提醒会在下次打开 App 时继续补上。";
const IOS_PENDING_VERIFICATION_WARNING =
  "部分提醒还没有出现在系统排程中，App 下次打开时会自动重试。";

export function getTaskReminderPlans(
  task: LocalTask,
  settings: LocalSettings,
  now = new Date()
): PlannedTaskReminder[] {
  if (
    !settings.localReminderEnabled ||
    task.status !== "ACTIVE" ||
    !task.dueAt
  ) {
    return [];
  }

  const dueAt = new Date(task.dueAt);

  if (dueAt.getTime() <= now.getTime()) {
    return [];
  }

  const leadTimeReminders = [
    {
      kind: "approaching" as const,
      minutes: settings.approachingReminderMinutes,
      title: `快到截止时间了：${task.title}`,
      body: `距离截止还有约 ${formatReminderLeadTime(
        settings.approachingReminderMinutes
      )}。`
    },
    {
      kind: "urgent" as const,
      minutes: settings.urgentReminderMinutes,
      title: `马上截止：${task.title}`,
      body: `距离截止还有约 ${formatReminderLeadTime(
        settings.urgentReminderMinutes
      )}。`
    }
  ];
  const plannedLeadTimeReminders = leadTimeReminders.map((reminder) => ({
    id: getTaskReminderId(task.id, reminder.kind),
    kind: reminder.kind,
    taskId: task.id,
    taskTitle: task.title,
    title: reminder.title,
    body: reminder.body,
    at: new Date(dueAt.getTime() - reminder.minutes * 60 * 1000)
  }));

  const futureReminders = [
    ...plannedLeadTimeReminders,
    {
      id: getTaskReminderId(task.id, "due"),
      kind: "due" as const,
      taskId: task.id,
      taskTitle: task.title,
      title: `已到截止时间：${task.title}`,
      body: "这项任务已截止。",
      at: dueAt
    }
  ].filter((reminder) => reminder.at.getTime() > now.getTime());
  const reminderByTriggerTime = new Map<number, PlannedTaskReminder>();

  // The array is ordered by urgency, so a due reminder replaces an urgent
  // reminder, and an urgent reminder replaces an approaching reminder when
  // settings make them land on the same minute.
  for (const reminder of futureReminders) {
    reminderByTriggerTime.set(reminder.at.getTime(), reminder);
  }

  return [...reminderByTriggerTime.values()].sort(
    (left, right) => left.at.getTime() - right.at.getTime()
  );
}

export async function syncTaskReminders(
  task: LocalTask,
  settings: LocalSettings
) {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  const plans = getTaskReminderPlans(task, settings);

  if (plans.length === 0) {
    await cancelTaskReminders(task.id);
    return null;
  }

  const capabilityWarning = await ensureReminderCapability(false);

  if (capabilityWarning === NOTIFICATION_PERMISSION_ERROR) {
    return capabilityWarning;
  }

  await ensureReminderChannel();
  await LocalNotifications.schedule({
    notifications: plans.map(toLocalNotification)
  });
  await cancelReminderIds(
    getTaskReminderIds(task.id).filter(
      (id) => !plans.some((plan) => plan.id === id)
    )
  );

  const pendingWarning = await verifyIOSPendingReminderIds(
    plans.map(({ id }) => id)
  );

  return mergeReminderWarnings(capabilityWarning, pendingWarning);
}

export async function syncAllTaskReminders(
  tasks: LocalTask[],
  settings: LocalSettings
) {
  await clearLegacyAlarmClockReminders();

  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  const allPlans = tasks
    .flatMap((task) => getTaskReminderPlans(task, settings))
    .sort((left, right) => left.at.getTime() - right.at.getTime());
  const { plans, warning: limitWarning } = selectTaskReminderPlans(allPlans);
  const pending = await LocalNotifications.getPending();
  const desiredIds = new Set(plans.map((plan) => plan.id));
  const orphanIds = pending.notifications
    .map(({ id }) => id)
    .filter(
      (id) =>
        !desiredIds.has(id) &&
        id !== TEST_NOTIFICATION_ID &&
        id !== SCHEDULED_TEST_NOTIFICATION_ID
    );

  if (plans.length === 0) {
    await cancelReminderIds(orphanIds);
    return limitWarning;
  }

  const capabilityWarning = await ensureReminderCapability(false);

  if (capabilityWarning === NOTIFICATION_PERMISSION_ERROR) {
    return capabilityWarning;
  }

  await ensureReminderChannel();

  if (Capacitor.getPlatform() === "ios") {
    await cancelReminderIds(orphanIds);
  }

  await LocalNotifications.schedule({
    notifications: plans.map(toLocalNotification)
  });

  if (Capacitor.getPlatform() !== "ios") {
    await cancelReminderIds(orphanIds);
  }

  const pendingWarning = await verifyIOSPendingReminderIds(
    plans.map(({ id }) => id)
  );

  return mergeReminderWarnings(capabilityWarning, limitWarning, pendingWarning);
}

export async function clearLegacyAlarmClockReminders() {
  return cancelAllLegacyNativeDdlAlarms();
}

export async function cancelTaskReminders(taskId: string) {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  await cancelReminderIds(getTaskReminderIds(taskId));
}

export async function sendTestNotifications() {
  if (!Capacitor.isNativePlatform()) {
    return "请在安装后的 App 中测试系统通知。";
  }

  const capabilityWarning = await ensureReminderCapability(true);

  if (capabilityWarning === NOTIFICATION_PERMISSION_ERROR) {
    return capabilityWarning;
  }

  await ensureReminderChannel();

  await LocalNotifications.cancel({
    notifications: [
      {
        id: TEST_NOTIFICATION_ID
      },
      {
        id: SCHEDULED_TEST_NOTIFICATION_ID
      }
    ]
  });

  await LocalNotifications.schedule({
    notifications: [
      {
        id: TEST_NOTIFICATION_ID,
        title: "DDL-Reminder 通知测试",
        body: "立即通知测试成功。",
        channelId: REMINDER_CHANNEL_ID,
        smallIcon: REMINDER_SMALL_ICON,
        ...(Capacitor.getPlatform() === "ios" ? { sound: "default" } : {}),
        autoCancel: true
      },
      {
        id: SCHEDULED_TEST_NOTIFICATION_ID,
        title: "DDL-Reminder 定时测试",
        body: "后台定时通知测试成功。",
        channelId: REMINDER_CHANNEL_ID,
        smallIcon: REMINDER_SMALL_ICON,
        ...(Capacitor.getPlatform() === "ios" ? { sound: "default" } : {}),
        schedule: {
          at: new Date(Date.now() + SCHEDULED_TEST_DELAY_MS),
          allowWhileIdle: true
        },
        autoCancel: true
      }
    ]
  });

  return capabilityWarning;
}

export async function getNotificationStatusText() {
  const diagnostics = await getNotificationDiagnostics();

  if (!diagnostics.isNative) {
    return "请在安装后的 App 中查看通知状态。";
  }

  const statusParts = [
    `通知权限：${
      diagnostics.notificationPermission === "granted"
        ? "已允许"
        : diagnostics.notificationPermission === "unknown"
          ? "检查失败"
          : "未允许"
    }`,
    getReminderChannelStatusText(diagnostics.channel),
    getExactAlarmStatusText(diagnostics.exactAlarm),
    `待发送提醒：${
      diagnostics.pendingCount === null
        ? "检查失败"
        : `${diagnostics.pendingCount} 条`
    }`
  ];

  if (diagnostics.power) {
    statusParts.push(formatAndroidPowerStatus(diagnostics.power));
  }

  return statusParts.join("；");
}

export async function getNotificationDiagnostics(): Promise<NotificationDiagnostics> {
  const platform = Capacitor.getPlatform();
  const isNative = Capacitor.isNativePlatform();

  if (!isNative) {
    return {
      channel: createNotApplicableChannelDiagnostics(),
      exactAlarm: "granted",
      isNative: false,
      notificationPermission: "unknown",
      pendingCount: null,
      platform,
      power: null
    };
  }

  const [notificationPermission, exactAlarm, channel, pendingCount, power] =
    await Promise.all([
      LocalNotifications.checkPermissions()
        .then(({ display }) => display)
        .catch(() => "unknown" as const),
      checkExactAlarmPermission(),
      getReminderChannelDiagnostics(),
      LocalNotifications.getPending()
        .then(({ notifications }) => notifications.length)
        .catch(() => null),
      getAndroidPowerStatus().catch(() => null)
    ]);

  return {
    channel,
    exactAlarm,
    isNative,
    notificationPermission,
    pendingCount,
    platform,
    power
  };
}

export async function requestReminderNotificationPermission() {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  return ensureNotificationPermission(true);
}

export async function openExactAlarmSettings() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return null;
  }

  const exactAlarm = await checkExactAlarmPermission();

  if (exactAlarm === "granted") {
    return null;
  }

  await LocalNotifications.changeExactNotificationSetting();

  return "“闹钟和提醒”设置已打开。完成后返回 App，提醒会自动更新。";
}

export async function openReminderNotificationSettings() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return "请在 Android 版 App 中使用这项功能。";
  }

  await ensureReminderChannel();

  return openAndroidNotificationChannelSettings(REMINDER_CHANNEL_ID);
}

function toLocalNotification(
  reminder: PlannedTaskReminder
): LocalNotificationSchema {
  return {
    id: reminder.id,
    title: reminder.title,
    body: reminder.body,
    channelId: REMINDER_CHANNEL_ID,
    smallIcon: REMINDER_SMALL_ICON,
    ...(Capacitor.getPlatform() === "ios" ? { sound: "default" } : {}),
    schedule: {
      at: reminder.at,
      allowWhileIdle: true
    },
    autoCancel: true,
    extra: {
      kind: reminder.kind,
      taskId: reminder.taskId
    }
  };
}

function selectTaskReminderPlans(plans: PlannedTaskReminder[]) {
  if (
    Capacitor.getPlatform() !== "ios" ||
    plans.length <= IOS_TASK_REMINDER_LIMIT
  ) {
    return { plans, warning: null };
  }

  const priority: Record<ReminderKind, number> = {
    due: 0,
    urgent: 1,
    approaching: 2
  };
  const selected = [...plans]
    .sort(
      (left, right) =>
        priority[left.kind] - priority[right.kind] ||
        left.at.getTime() - right.at.getTime()
    )
    .slice(0, IOS_TASK_REMINDER_LIMIT)
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  return { plans: selected, warning: IOS_NOTIFICATION_LIMIT_WARNING };
}

async function verifyIOSPendingReminderIds(ids: number[]) {
  if (Capacitor.getPlatform() !== "ios" || ids.length === 0) {
    return null;
  }

  for (
    let attempt = 0;
    attempt < IOS_PENDING_VERIFICATION_ATTEMPTS;
    attempt += 1
  ) {
    const pending = await LocalNotifications.getPending();
    const pendingIds = new Set(pending.notifications.map(({ id }) => id));

    if (ids.every((id) => pendingIds.has(id))) {
      return null;
    }

    if (attempt + 1 < IOS_PENDING_VERIFICATION_ATTEMPTS) {
      await delay(IOS_PENDING_VERIFICATION_DELAY_MS);
    }
  }

  return IOS_PENDING_VERIFICATION_WARNING;
}

function mergeReminderWarnings(...warnings: Array<string | null>) {
  const distinctWarnings = [...new Set(warnings.filter(Boolean))];

  return distinctWarnings.length > 0 ? distinctWarnings.join(" ") : null;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function ensureNotificationPermission(requestIfNeeded: boolean) {
  const current = await LocalNotifications.checkPermissions();

  if (current.display === "granted") {
    return true;
  }

  if (!requestIfNeeded) {
    return false;
  }

  const requested = await LocalNotifications.requestPermissions();

  return requested.display === "granted";
}

async function ensureReminderCapability(requestPermission: boolean) {
  const hasPermission = await ensureNotificationPermission(requestPermission);

  if (!hasPermission) {
    return NOTIFICATION_PERMISSION_ERROR;
  }

  const exactAlarm = await checkExactAlarmPermission();

  if (exactAlarm === "denied") {
    return EXACT_ALARM_PERMISSION_WARNING;
  }

  if (exactAlarm === "unknown") {
    return EXACT_ALARM_STATUS_UNKNOWN_WARNING;
  }

  return null;
}

async function checkExactAlarmPermission(): Promise<ExactAlarmPermissionStatus> {
  if (Capacitor.getPlatform() !== "android") {
    return "granted";
  }

  try {
    const result = await LocalNotifications.checkExactNotificationSetting();

    return result.exact_alarm === "granted" ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

async function ensureReminderChannel() {
  if (Capacitor.getPlatform() !== "android") {
    return;
  }

  const powerStatus = await getAndroidPowerStatus().catch(() => null);

  if (powerStatus && powerStatus.sdkInt < 26) {
    return;
  }

  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL_ID,
    name: "任务提醒",
    description: "任务临近截止时发送通知",
    importance: 4,
    visibility: 0,
    vibration: true
  });
}

async function getReminderChannelDiagnostics(): Promise<ReminderChannelDiagnostics> {
  if (Capacitor.getPlatform() !== "android") {
    return createNotApplicableChannelDiagnostics();
  }

  try {
    const powerStatus = await getAndroidPowerStatus().catch(() => null);

    if (powerStatus && powerStatus.sdkInt < 26) {
      return createNotApplicableChannelDiagnostics();
    }

    await ensureReminderChannel();
    const { channels } = await LocalNotifications.listChannels();
    const channel = channels.find(({ id }) => id === REMINDER_CHANNEL_ID);

    if (!channel) {
      return {
        applicable: true,
        enabled: null,
        exists: false,
        importance: null,
        vibration: null
      };
    }

    const importance =
      channel.importance === undefined ? null : Number(channel.importance);

    return {
      applicable: true,
      enabled: importance === null ? null : importance > 0,
      exists: true,
      importance,
      vibration: channel.vibration ?? null
    };
  } catch {
    return {
      applicable: true,
      enabled: null,
      exists: null,
      importance: null,
      vibration: null
    };
  }
}

function getReminderChannelStatusText(
  channel: ReminderChannelDiagnostics
): string {
  if (!channel.applicable) {
    return "提醒通知：无需设置";
  }

  if (channel.exists === false) {
    return "提醒通知：创建失败";
  }

  if (channel.exists === null || channel.enabled === null) {
    return "提醒通知：检查失败";
  }

  if (!channel.enabled) {
    return "提醒通知：已关闭";
  }

  const importanceLabel =
    (channel.importance ?? 0) >= 4
      ? "较高"
      : (channel.importance ?? 0) >= 3
        ? "默认"
        : "较低";

  return `提醒通知：已开启，提醒级别${importanceLabel}，振动${
    channel.vibration ? "已开启" : "未开启"
  }`;
}

function getExactAlarmStatusText(status: ExactAlarmPermissionStatus) {
  if (status === "granted") {
    return "“闹钟和提醒”：已允许";
  }

  if (status === "denied") {
    return "“闹钟和提醒”：未允许，通知可能晚一些";
  }

  return "“闹钟和提醒”：暂时无法检查，通知可能晚一些";
}

function createNotApplicableChannelDiagnostics(): ReminderChannelDiagnostics {
  return {
    applicable: false,
    enabled: null,
    exists: null,
    importance: null,
    vibration: null
  };
}

function formatAndroidPowerStatus(status: AndroidPowerStatus) {
  return `系统电池优化：${
    status.batteryOptimizationIgnored ? "不受限制" : "仍受限制，提醒可能延迟"
  }；后台运行：${
    status.backgroundRestricted ? "受限制" : "未发现限制"
  }；设备：${
    status.manufacturer || status.brand || "Android"
  } ${status.model}`.trim();
}

function getTaskReminderId(taskId: string, kind: ReminderKind) {
  let hash = 47;

  if (kind === "approaching") {
    hash = 17;
  } else if (kind === "urgent") {
    hash = 31;
  }

  for (const char of taskId) {
    hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  }

  return hash & 0x7fffffff;
}

function getTaskReminderIds(taskId: string) {
  return (["approaching", "urgent", "due"] as const).map((kind) =>
    getTaskReminderId(taskId, kind)
  );
}

async function cancelReminderIds(ids: number[]) {
  if (ids.length === 0) {
    return;
  }

  await LocalNotifications.cancel({
    notifications: ids.map((id) => ({ id }))
  });
}

function formatReminderLeadTime(totalMinutes: number) {
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
