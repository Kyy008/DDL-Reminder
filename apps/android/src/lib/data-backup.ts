import { Capacitor, registerPlugin } from "@capacitor/core";
import { getAndroidRecentsExcluded } from "./android-recents";
import {
  getAssistantEnabled,
  getThinkingEffort,
  readAssistantConversationForBackup
} from "./assistant-storage";
import {
  parseLocalAppState,
  serializeLocalAppState,
  type LocalAppState
} from "./local-app-state";
import { localTaskStore } from "./local-task-store";

type DataBackupPlugin = {
  exportBackup(options: {
    document: string;
  }): Promise<{ cancelled: boolean; uri?: string; bytes?: number }>;
};
const DataBackup = registerPlugin<DataBackupPlugin>("DataBackup");
export function createBackupDocument(state: LocalAppState, now = new Date()) {
  return {
    format: "ddl-reminder-backup",
    version: 1,
    exportedAt: now.toISOString(),
    state: parseLocalAppState(serializeLocalAppState(state))
  };
}
export async function exportLocalDataBackup() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android")
    throw new Error("请在 Android 应用中导出完整备份。");
  const document = {
    ...createBackupDocument(await localTaskStore.getState()),
    appearance: {
      theme: window.localStorage.getItem("ddl-reminder:theme-mode") ?? "dark",
      hideFromRecents: await getAndroidRecentsExcluded()
    },
    assistant: {
      enabled: await getAssistantEnabled(),
      effort: await getThinkingEffort(),
      conversation: await readAssistantConversationForBackup()
    }
  };
  return DataBackup.exportBackup({ document: JSON.stringify(document) });
}
