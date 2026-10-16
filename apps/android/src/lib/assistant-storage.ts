import { Preferences } from "@capacitor/preferences";
import { z } from "zod";
import type {
  AssistantMessage,
  TaskProposal,
  ThinkingEffort
} from "./task-assistant";

export const ASSISTANT_SETTINGS_EVENT =
  "ddl-reminder:assistant-settings-change";
export const TASKS_CHANGED_EVENT = "ddl-reminder:tasks-changed";
export const ASSISTANT_OPEN_EVENT = "ddl-reminder:assistant-open-conversation";
export const ASSISTANT_HISTORY_EVENT = "ddl-reminder:assistant-history-change";
const EFFORT_KEY = "ddl-reminder:assistant-effort";
const ENABLED_KEY = "ddl-reminder:assistant-enabled";
const HISTORY_KEY = "ddl-reminder:assistant-history";
const ARCHIVE_KEY = "ddl-reminder:assistant-conversations";
let historyQueue: Promise<void> = Promise.resolve();
const storedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  startAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]),
  createdAt: z.string(),
  updatedAt: z.string()
});
const storedProposalSchema = z.object({
  id: z.string(),
  operation: z.enum(["create", "update", "delete"]),
  before: storedTaskSchema.nullable(),
  after: storedTaskSchema.nullable(),
  input: z.record(z.string(), z.unknown())
});
const messageSchema = z
  .object({
    role: z.enum(["user", "assistant", "tool"]),
    content: z.string().nullable(),
    reasoning_content: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z
      .array(
        z.object({
          id: z.string(),
          type: z.literal("function"),
          function: z.object({ name: z.string(), arguments: z.string() })
        })
      )
      .optional()
  })
  .strict();
const entrySchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "notice"]),
    text: z.string(),
    proposal: storedProposalSchema.optional(),
    outcome: z.enum(["confirmed", "cancelled", "failed"]).optional(),
    detail: z.string().optional()
  })
  .strict();
const conversationSchema = z
  .object({
    version: z.literal(1),
    messages: z.array(messageSchema),
    entries: z.array(entrySchema)
  })
  .strict();
export type ChatEntry = {
  id: string;
  role: "user" | "assistant" | "notice";
  text: string;
  proposal?: TaskProposal;
  outcome?: "confirmed" | "cancelled" | "failed";
  detail?: string;
};
export type AssistantConversation = {
  version: 1;
  id?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messages: AssistantMessage[];
  entries: ChatEntry[];
};
export type ConversationRecord = AssistantConversation & {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
const recordSchema = conversationSchema.extend({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
const archiveSchema = z
  .object({
    version: z.literal(1),
    activeId: z.string().nullable(),
    conversations: z.array(recordSchema)
  })
  .strict();
type ConversationArchive = {
  version: 1;
  activeId: string | null;
  conversations: ConversationRecord[];
};
export const EMPTY_CONVERSATION: AssistantConversation = {
  version: 1,
  messages: [],
  entries: []
};

export async function getThinkingEffort(): Promise<ThinkingEffort> {
  const value = (await Preferences.get({ key: EFFORT_KEY })).value;
  return value === "off" || value === "low" || value === "max" ? value : "high";
}
export async function getAssistantEnabled() {
  return (await Preferences.get({ key: ENABLED_KEY })).value === "true";
}
export async function saveAssistantEnabled(enabled: boolean) {
  await Preferences.set({ key: ENABLED_KEY, value: String(enabled) });
  window.dispatchEvent(new Event(ASSISTANT_SETTINGS_EVENT));
}
export async function saveThinkingEffort(effort: ThinkingEffort) {
  await Preferences.set({ key: EFFORT_KEY, value: effort });
  window.dispatchEvent(new Event(ASSISTANT_SETTINGS_EVENT));
}
export function trimAssistantConversation(
  conversation: AssistantConversation,
  maxContextCharacters = 600_000
): AssistantConversation {
  const userIndices = conversation.messages.flatMap((m, index) =>
    m.role === "user" ? [index] : []
  );
  let start = 0;
  let characters = JSON.stringify(conversation.messages).length;
  // Keep normal conversations in full. Only very large model requests drop
  // oldest complete turns; never cut a tool batch or delete visible history.
  for (
    let i = 0;
    i < userIndices.length - 1 && characters > maxContextCharacters;
    i++
  ) {
    const next = userIndices[i + 1];
    characters -=
      JSON.stringify(conversation.messages.slice(start, next)).length - 1;
    start = next;
  }
  return {
    ...conversation,
    messages: conversation.messages.slice(start),
    entries: conversation.entries
  };
}
function enqueueHistory<Result>(action: () => Promise<Result>) {
  const result = historyQueue.then(action);
  historyQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
function emptyRecord(): ConversationRecord {
  const time = new Date().toISOString();
  return {
    ...EMPTY_CONVERSATION,
    id: crypto.randomUUID(),
    title: "新对话",
    createdAt: time,
    updatedAt: time
  };
}
async function writeArchive(archive: ConversationArchive) {
  await Preferences.set({ key: ARCHIVE_KEY, value: JSON.stringify(archive) });
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(ASSISTANT_HISTORY_EVENT));
}
async function readArchiveImmediately(): Promise<ConversationArchive> {
  const stored = (await Preferences.get({ key: ARCHIVE_KEY })).value;
  if (stored) {
    const parsed = archiveSchema.safeParse(JSON.parse(stored));
    if (!parsed.success)
      throw new Error(
        "历史对话未能读取，原记录仍保留。请先导出备份，任务数据不受影响。"
      );
    return parsed.data;
  }
  const legacy = (await Preferences.get({ key: HISTORY_KEY })).value;
  const archive: ConversationArchive = {
    version: 1,
    activeId: null,
    conversations: []
  };
  if (legacy) {
    const previous = conversationSchema.safeParse(JSON.parse(legacy));
    if (!previous.success)
      throw new Error("旧对话未能读取，原记录仍保留，请先导出备份。");
    if (previous.data.entries.length || previous.data.messages.length) {
      const record = { ...emptyRecord(), ...previous.data };
      record.title =
        previous.data.entries
          .find((entry) => entry.role === "user")
          ?.text.slice(0, 48) || "之前的对话";
      archive.conversations.push(record);
      archive.activeId = record.id;
    }
    // Remove only the obsolete duplicate after its replacement is durable.
    await writeArchive(archive);
    await Preferences.remove({ key: HISTORY_KEY });
  }
  return archive;
}
function restoreRecord(record: ConversationRecord): ConversationRecord {
  return {
    ...record,
    entries: record.entries.map((entry) =>
      entry.proposal && !entry.outcome
        ? { ...entry, outcome: "cancelled", detail: "上次未确认的操作已取消。" }
        : entry
    )
  };
}
export function loadAssistantConversation(
  id?: string
): Promise<ConversationRecord> {
  return enqueueHistory(async () => {
    const archive = await readArchiveImmediately();
    let record = archive.conversations.find(
      (item) => item.id === (id ?? archive.activeId)
    );
    if (!record) {
      if (id) throw new Error("这条对话不存在，可能已经被清空。");
      record = emptyRecord();
      archive.conversations.push(record);
    }
    archive.activeId = record.id;
    await writeArchive(archive);
    return restoreRecord(record);
  });
}
export function startAssistantConversation(): Promise<ConversationRecord> {
  return enqueueHistory(async () => {
    const archive = await readArchiveImmediately();
    const current = archive.conversations.find(
      (item) => item.id === archive.activeId
    );
    if (current && !current.entries.length && !current.messages.length)
      return current;
    const record = emptyRecord();
    archive.conversations.push(record);
    archive.activeId = record.id;
    await writeArchive(archive);
    return record;
  });
}
export function listAssistantConversations() {
  return enqueueHistory(async () =>
    (await readArchiveImmediately()).conversations
      .filter((record) => record.entries.length || record.messages.length)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(restoreRecord)
  );
}
export function saveAssistantConversation(
  conversation: AssistantConversation
): Promise<ConversationRecord> {
  return enqueueHistory(async () => {
    const archive = await readArchiveImmediately();
    const prior = archive.conversations.find(
      (item) => item.id === (conversation.id ?? archive.activeId)
    );
    const record: ConversationRecord = {
      ...(prior ?? emptyRecord()),
      ...conversation,
      id: conversation.id ?? prior?.id ?? crypto.randomUUID(),
      title:
        conversation.entries
          .find((entry) => entry.role === "user")
          ?.text.slice(0, 48) || "新对话",
      updatedAt: new Date().toISOString()
    };
    archive.conversations = [
      ...archive.conversations.filter((item) => item.id !== record.id),
      record
    ];
    archive.activeId = record.id;
    await writeArchive(archive);
    return record;
  });
}
export function clearAssistantConversation(
  id?: string
): Promise<ConversationRecord> {
  return enqueueHistory(async () => {
    const archive = await readArchiveImmediately();
    const targetId = id ?? archive.activeId;
    archive.conversations = archive.conversations.filter(
      (record) => record.id !== targetId
    );
    const replacement = emptyRecord();
    archive.conversations.push(replacement);
    archive.activeId = replacement.id;
    await writeArchive(archive);
    return replacement;
  });
}

// Preserve the original chat record even if it is corrupt. A damaged chat must
// not stop the user from backing up otherwise valid task data.
export async function readAssistantConversationForBackup(): Promise<unknown> {
  await historyQueue;
  const archive = (await Preferences.get({ key: ARCHIVE_KEY })).value;
  const legacy = (await Preferences.get({ key: HISTORY_KEY })).value;
  const parse = (value: string | null): unknown => {
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return { unparsedRecord: value };
    }
  };
  return { archive: parse(archive), legacy: parse(legacy) };
}
