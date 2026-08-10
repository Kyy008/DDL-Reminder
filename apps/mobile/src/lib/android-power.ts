import { Capacitor, registerPlugin } from "@capacitor/core";

export type AndroidVendorFamily =
  | "asus"
  | "honor"
  | "huawei"
  | "meizu"
  | "oplus"
  | "other"
  | "pixel"
  | "samsung"
  | "vivo"
  | "xiaomi";

export type AndroidPowerStatus = {
  batteryOptimizationIgnored: boolean;
  backgroundRestricted: boolean;
  brand: string;
  manufacturer: string;
  model: string;
  sdkInt: number;
  vendorFamily: AndroidVendorFamily;
  vendorSettingsAvailable: boolean;
  vendorSettingsLabel: string;
};

type OpenSettingsResult = {
  component?: string;
  destination?:
    | "app-details"
    | "battery-optimization"
    | "notification-channel"
    | "vendor";
  fallbackUsed?: boolean;
  label?: string;
  opened: boolean;
  vendorFamily?: AndroidVendorFamily;
};

type AndroidPowerPlugin = {
  getStatus: () => Promise<AndroidPowerStatus>;
  requestIgnoreBatteryOptimizations: () => Promise<
    OpenSettingsResult & { alreadyAllowed?: boolean }
  >;
  openAppSettings: () => Promise<OpenSettingsResult>;
  openVendorBackgroundSettings: () => Promise<OpenSettingsResult>;
  openNotificationChannelSettings: (options: {
    channelId: string;
  }) => Promise<OpenSettingsResult>;
};

const AndroidPower = registerPlugin<AndroidPowerPlugin>("AndroidPower");

export async function getAndroidPowerStatusText() {
  const status = await getAndroidPowerStatus();

  if (!status) {
    return null;
  }

  return `系统电池优化：${
    status.batteryOptimizationIgnored ? "不受限制" : "仍受限制，提醒可能延迟"
  }；后台运行：${
    status.backgroundRestricted ? "受限制" : "未发现限制"
  }；设备：${
    status.manufacturer || status.brand || "Android"
  } ${status.model}`.trim();
}

export async function getAndroidPowerStatus() {
  if (!isAndroidNativePlatform()) {
    return null;
  }

  return AndroidPower.getStatus();
}

export async function requestAndroidBackgroundProtection() {
  if (!isAndroidNativePlatform()) {
    return "请在 Android 版 App 中使用这项功能。";
  }

  const result = await AndroidPower.requestIgnoreBatteryOptimizations();

  if (result.alreadyAllowed) {
    return "DDL-Reminder 已不受系统电池优化影响，不用再设置。";
  }

  return "电池优化设置已打开。请找到 DDL-Reminder，选择“不允许优化”。自启动和后台运行还需要另外设置。";
}

export async function openAndroidVendorBackgroundSettings() {
  if (!isAndroidNativePlatform()) {
    return "请在 Android 版 App 中使用这项功能。";
  }

  const result = await AndroidPower.openVendorBackgroundSettings();

  if (result.destination === "vendor") {
    return `${result.label ?? "后台管理"}已打开。请允许 DDL-Reminder 自启动、关联启动和后台运行。App 无法读取这项设置，完成后请手动确认。`;
  }

  return "这台手机没有可直接打开的自启动页面，已改为打开应用信息。请在“电池”或“后台活动”中允许 DDL-Reminder 后台运行。";
}

export async function openAndroidAppSettings() {
  if (!isAndroidNativePlatform()) {
    return "请在 Android 版 App 中使用这项功能。";
  }

  await AndroidPower.openAppSettings();

  return "应用设置已打开。请确认“通知”和“闹钟和提醒”都已允许。";
}

export async function openAndroidNotificationChannelSettings(
  channelId: string
) {
  if (!isAndroidNativePlatform()) {
    return "请在 Android 版 App 中使用这项功能。";
  }

  await AndroidPower.openNotificationChannelSettings({ channelId });

  return "通知设置已打开。请打开“任务提醒”，并按需开启声音、振动、横幅和锁屏显示。";
}

function isAndroidNativePlatform() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function getAndroidVendorGuidance(
  status: AndroidPowerStatus | null
): string {
  if (!status) {
    return "请在 Android 版 App 中查看后台设置步骤。";
  }

  const guidanceByVendor: Record<AndroidVendorFamily, string> = {
    honor: "荣耀 MagicOS：选择“手动管理”，再打开自启动、关联启动和后台活动。",
    huawei:
      "华为 HarmonyOS/EMUI：选择“手动管理”，再打开自启动、关联启动和后台活动。",
    xiaomi: "小米 HyperOS/MIUI：打开自启动，并把省电策略设为“无限制”。",
    oplus: "OPPO/一加/realme：打开自启动、关联启动和后台运行。",
    vivo: "vivo/iQOO：打开自启动，并允许高耗电后台运行。",
    samsung:
      "三星 One UI：在“后台使用限制”中把 DDL-Reminder 加入“从不休眠的应用”。",
    meizu: "魅族 Flyme：允许 DDL-Reminder 后台运行和自启动。",
    asus: "华硕 ZenUI/ROG UI：在自启动和省电管理中允许 DDL-Reminder 运行。",
    pixel: "Pixel/AOSP 没有单独的自启动开关，完成电池优化设置即可。",
    other:
      "没有找到这台手机专用的设置入口。请在应用信息的“电池”或“后台活动”中允许 DDL-Reminder 后台运行。"
  };

  return guidanceByVendor[status.vendorFamily];
}
