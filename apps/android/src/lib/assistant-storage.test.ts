import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAssistantConversation,
  deleteAssistantConversation,
  getAssistantEnabled,
  getThinkingEffort,
  loadAssistantConversation,
  listAssistantConversations,
  startAssistantConversation,
  saveAssistantConversation,
  saveThinkingEffort,
  saveAssistantEnabled,
  trimAssistantConversation,
  type AssistantConversation
} from "./assistant-storage";
import { createTaskProposal } from "./task-assistant";
import { createEmptyLocalAppState, createTaskInState } from "./local-app-state";

const values = vi.hoisted(() => new Map<string, string>());
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({
      value: values.get(key) ?? null
    })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      values.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      values.delete(key);
    })
  }
}));
beforeEach(() => {
  values.clear();
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});
describe("assistant preferences and history", () => {
  it("preserves completion cards in history and restores unconfirmed ones as cancelled", async () => {
    const state = createTaskInState(
      createEmptyLocalAppState(),
      { title: "待完成", hasDeadline: false },
      { id: "complete-1" }
    ).state;
    const proposal = createTaskProposal(state, {
      operation: "complete",
      taskId: "complete-1"
    });
    const saved = await saveAssistantConversation({
      version: 1,
      messages: [],
      entries: [{ id: "complete-card", role: "assistant", text: "", proposal }]
    });
    const restored = await loadAssistantConversation(saved.id);
    expect(restored.entries[0].proposal).toMatchObject({
      operation: "complete",
      before: { status: "ACTIVE" },
      after: { status: "COMPLETED" }
    });
    expect(restored.entries[0].outcome).toBe("cancelled");
  });
  it("is disabled by default and only enables after explicit opt-in", async () => {
    expect(await getAssistantEnabled()).toBe(false);
    await saveAssistantEnabled(true);
    expect(await getAssistantEnabled()).toBe(true);
    await saveAssistantEnabled(false);
    expect(await getAssistantEnabled()).toBe(false);
  });
  it("defaults to high and saves actual effort choices", async () => {
    expect(await getThinkingEffort()).toBe("high");
    for (const effort of ["off", "low", "high", "max"] as const) {
      await saveThinkingEffort(effort);
      expect(await getThinkingEffort()).toBe(effort);
    }
    values.set("ddl-reminder:assistant-effort", "unexpected");
    expect(await getThinkingEffort()).toBe("high");
  });
  it("limits very large model context only at complete turn boundaries", () => {
    const conversation: AssistantConversation = {
      version: 1,
      messages: [],
      entries: []
    };
    for (let i = 0; i < 8; i++) {
      conversation.messages.push(
        { role: "user", content: `u${i}` },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `${i}`,
              type: "function",
              function: { name: "query_tasks", arguments: "{}" }
            }
          ]
        },
        { role: "tool", tool_call_id: `${i}`, content: "{}" },
        { role: "assistant", content: "done" }
      );
      conversation.entries.push(
        { id: `u${i}`, role: "user", text: `u${i}` },
        { id: `a${i}`, role: "assistant", text: "done" }
      );
    }
    const saved = trimAssistantConversation(
      conversation,
      JSON.stringify(conversation.messages.slice(8)).length
    );
    expect(saved.messages).toHaveLength(24);
    expect(saved.messages[0].content).toBe("u2");
    expect(saved.entries).toHaveLength(16);
  });
  it("restores pending previews as cancelled and never as executable approvals", async () => {
    const proposal = createTaskProposal(createEmptyLocalAppState(), {
      operation: "create",
      fields: { title: "未确认" }
    });
    await saveAssistantConversation({
      version: 1,
      messages: [],
      entries: [{ id: "preview", role: "assistant", text: "", proposal }]
    });
    expect((await loadAssistantConversation()).entries[0].outcome).toBe(
      "cancelled"
    );
  });
  it("rejects corrupt history without touching the original record or task data", async () => {
    values.set(
      "ddl-reminder:assistant-history",
      JSON.stringify({ version: 1, messages: [null], entries: [] })
    );
    values.set("ddl-reminder:local-app-state", "preserved");
    await expect(loadAssistantConversation()).rejects.toThrow();
    expect(values.get("ddl-reminder:local-app-state")).toBe("preserved");
    expect(values.has("ddl-reminder:assistant-history")).toBe(true);
  });
  it("clears only conversation history", async () => {
    values.set(
      "ddl-reminder:assistant-history",
      JSON.stringify({
        version: 1,
        messages: [{ role: "user", content: "old" }],
        entries: [{ id: "old", role: "user", text: "old" }]
      })
    );
    values.set("ddl-reminder:local-app-state", "preserved");
    await clearAssistantConversation();
    expect(values.has("ddl-reminder:assistant-history")).toBe(false);
    expect(values.get("ddl-reminder:local-app-state")).toBe("preserved");
    expect(await listAssistantConversations()).toHaveLength(0);
  });
  it("starts a new conversation by default and resumes only the explicitly selected one", async () => {
    const first = await startAssistantConversation();
    await saveAssistantConversation({
      ...first,
      messages: [{ role: "user", content: "第一条对话" }],
      entries: [{ id: "u1", role: "user", text: "第一条对话" }]
    });
    const second = await startAssistantConversation();
    expect(second.id).not.toBe(first.id);
    expect(second.entries).toHaveLength(0);
    await saveAssistantConversation({
      ...second,
      messages: [{ role: "user", content: "第二条对话" }],
      entries: [{ id: "u2", role: "user", text: "第二条对话" }]
    });
    expect(await listAssistantConversations()).toHaveLength(2);
    const restored = await loadAssistantConversation(first.id);
    expect(restored.entries[0].text).toBe("第一条对话");
    await clearAssistantConversation(first.id);
    expect(
      (await listAssistantConversations()).map((record) => record.id)
    ).toEqual([second.id]);
  });
  it("retains all visible history and all normal-sized model context", async () => {
    const record = await startAssistantConversation();
    for (let i = 0; i < 9; i++) {
      record.messages.push(
        { role: "user", content: `message ${i}` },
        { role: "assistant", content: "reply", reasoning_content: "preserved" }
      );
      record.entries.push(
        { id: `u${i}`, role: "user", text: `message ${i}` },
        { id: `a${i}`, role: "assistant", text: "reply" }
      );
    }
    await saveAssistantConversation(record);
    expect((await loadAssistantConversation(record.id)).messages).toHaveLength(
      18
    );
    expect(trimAssistantConversation(record).messages).toHaveLength(18);
  });
  it("deletes only the selected conversation and preserves the other active conversation and task data", async () => {
    const first = await saveAssistantConversation({
      version: 1,
      messages: [],
      entries: [{ id: "one", role: "user", text: "删除这一条" }]
    });
    await startAssistantConversation();
    const second = await saveAssistantConversation({
      version: 1,
      messages: [],
      entries: [{ id: "two", role: "user", text: "保留这一条" }]
    });
    values.set("ddl-reminder:local-app-state", "preserved");
    await deleteAssistantConversation(first.id);
    expect(
      (await listAssistantConversations()).map((record) => record.id)
    ).toEqual([second.id]);
    expect((await loadAssistantConversation()).id).toBe(second.id);
    expect(values.get("ddl-reminder:local-app-state")).toBe("preserved");
    await expect(loadAssistantConversation(first.id)).rejects.toThrow("不存在");
  });
  it("deletes the active conversation without resurrecting it on a late save", async () => {
    const record = await startAssistantConversation();
    const stale = {
      ...record,
      entries: [{ id: "u", role: "user" as const, text: "稍后完成的消息" }]
    };
    await deleteAssistantConversation(record.id);
    await expect(saveAssistantConversation(stale)).rejects.toThrow("已删除");
    expect(await listAssistantConversations()).toHaveLength(0);
    const next = await startAssistantConversation();
    expect(next.id).not.toBe(record.id);
    expect(next.entries).toHaveLength(0);
  });
  it("repeated deletes and unknown IDs do not delete other conversations", async () => {
    const saved = await saveAssistantConversation({
      version: 1,
      messages: [],
      entries: [{ id: "kept", role: "user", text: "保留" }]
    });
    await deleteAssistantConversation("does-not-exist");
    await deleteAssistantConversation("does-not-exist");
    expect(
      (await listAssistantConversations()).map((record) => record.id)
    ).toEqual([saved.id]);
  });
  it("does not replace a legacy record until migration was durably saved", async () => {
    const legacy = {
      version: 1,
      messages: [{ role: "user", content: "旧版聊天" }],
      entries: [{ id: "legacy", role: "user", text: "旧版聊天" }]
    };
    values.set("ddl-reminder:assistant-history", JSON.stringify(legacy));
    const records = await listAssistantConversations();
    expect(records[0].title).toBe("旧版聊天");
    expect(values.has("ddl-reminder:assistant-conversations")).toBe(true);
    expect(values.has("ddl-reminder:assistant-history")).toBe(false);
  });
});
