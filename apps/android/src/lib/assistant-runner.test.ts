import { describe, expect, it, vi } from "vitest";
import { createEmptyLocalAppState, createTaskInState } from "./local-app-state";
import {
  runAssistantTurn,
  settleOutstandingTools,
  type AssistantRunnerDependencies
} from "./assistant-runner";
import type { AssistantMessage } from "./task-assistant";
import {
  createLocalTaskStore,
  createMemoryStorageBackend
} from "./local-task-store";

function tool(name: string, args: unknown, id = "tool-1"): AssistantMessage {
  return {
    role: "assistant",
    content: null,
    reasoning_content: "model thinking to replay",
    tool_calls: [
      {
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(args) }
      }
    ]
  };
}
function setup(replies: AssistantMessage[]) {
  const state = createTaskInState(
    createEmptyLocalAppState(),
    { title: "existing", hasDeadline: false },
    { id: "task-1" }
  ).state;
  const dependencies: AssistantRunnerDependencies = {
    complete: vi.fn(async () => replies.shift()!),
    getState: vi.fn(async () => state),
    review: vi.fn(async () => ({
      status: "cancelled" as const,
      message: "user cancelled"
    })),
    onText: vi.fn(),
    onStatus: vi.fn()
  };
  return dependencies;
}
describe("assistant tool loop", () => {
  it("waits for confirmation before completing and leaves a cancelled task active", async () => {
    const d = setup([
      tool("propose_task_change", { operation: "complete", taskId: "task-1" }),
      { role: "assistant", content: "已取消，任务仍未完成。" }
    ]);
    const result = await runAssistantTurn(
      [],
      "这个任务做完了",
      d,
      new AbortController().signal
    );
    expect(d.review).toHaveBeenCalledOnce();
    expect(vi.mocked(d.review).mock.calls[0][0]).toMatchObject({
      operation: "complete",
      before: { status: "ACTIVE" },
      after: { status: "COMPLETED" }
    });
    expect(JSON.parse(result.messages[2].content!).status).toBe("cancelled");
    expect((await d.getState()).tasks[0].status).toBe("ACTIVE");
  });
  it("reports completion only after the review applies it through the task store", async () => {
    const d = setup([
      tool("propose_task_change", { operation: "complete", taskId: "task-1" }),
      { role: "assistant", content: "已标记完成。" }
    ]);
    const store = createLocalTaskStore(
      createMemoryStorageBackend(await d.getState())
    );
    d.getState = () => store.getState();
    d.review = vi.fn<AssistantRunnerDependencies["review"]>(
      async (proposal) => {
        expect((await store.listTasks())[0].status).toBe("ACTIVE");
        const task = await store.confirmTaskProposal(proposal);
        return { status: "confirmed", task, message: "已标记完成。" };
      }
    );
    const result = await runAssistantTurn(
      [],
      "完成这个任务",
      d,
      new AbortController().signal
    );
    expect(result.error).toBeNull();
    expect(JSON.parse(result.messages[2].content!)).toMatchObject({
      status: "confirmed",
      task: { status: "COMPLETED" }
    });
    expect((await store.listTasks())[0].status).toBe("COMPLETED");
  });
  it("does not ask for approval during normal chat", async () => {
    const d = setup([{ role: "assistant", content: "你好" }]);
    const result = await runAssistantTurn(
      [],
      "hi",
      d,
      new AbortController().signal
    );
    expect(d.getState).not.toHaveBeenCalled();
    expect(d.review).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
  });
  it("queries read-only and replays reasoning_content in subsequent tool requests", async () => {
    const d = setup([
      tool("query_tasks", {}),
      { role: "assistant", content: "一个任务" }
    ]);
    const result = await runAssistantTurn(
      [],
      "查任务",
      d,
      new AbortController().signal
    );
    expect(d.review).not.toHaveBeenCalled();
    expect(result.messages[1].reasoning_content).toBe(
      "model thinking to replay"
    );
    expect(JSON.parse(result.messages[2].content!).tasks[0].id).toBe("task-1");
    expect(vi.mocked(d.complete).mock.calls[1][0][1].reasoning_content).toBe(
      "model thinking to replay"
    );
  });
  it("waits for a real review and forwards cancellation, without mutating state", async () => {
    const d = setup([
      tool("propose_task_change", { operation: "delete", taskId: "task-1" }),
      { role: "assistant", content: "已取消" }
    ]);
    const result = await runAssistantTurn(
      [],
      "删任务",
      d,
      new AbortController().signal
    );
    expect(d.review).toHaveBeenCalledOnce();
    expect(JSON.parse(result.messages[2].content!).status).toBe("cancelled");
    expect((await d.getState()).tasks).toHaveLength(1);
  });
  it("does not show a confirmation for unknown or invalid operations", async () => {
    const d = setup([
      tool("execute_shell", { command: "oops" }),
      tool(
        "propose_task_change",
        { operation: "delete", taskId: "invalid" },
        "tool-2"
      ),
      { role: "assistant", content: "无法操作" }
    ]);
    const result = await runAssistantTurn(
      [],
      "do",
      d,
      new AbortController().signal
    );
    expect(d.review).not.toHaveBeenCalled();
    expect(
      result.messages
        .filter((m) => m.role === "tool")
        .every((m) => JSON.parse(m.content!).status === "failed")
    ).toBe(true);
  });
  it("settles every unexecuted call after a network error or abort", () => {
    const reply = tool("query_tasks", {});
    reply.tool_calls!.push({ ...reply.tool_calls![0], id: "tool-2" });
    const messages = settleOutstandingTools([
      { role: "user", content: "查" },
      reply,
      { role: "tool", tool_call_id: "tool-1", content: "done" }
    ]);
    expect(messages.at(-1)?.tool_call_id).toBe("tool-2");
    expect(JSON.parse(messages.at(-1)!.content!).status).toBe("cancelled");
    expect(messages[2].content).toBe("done");
  });
  it("halts repeated tool loops and never silently executes an approval", async () => {
    const d = setup([]);
    d.complete = vi.fn(async () =>
      tool("query_tasks", {}, crypto.randomUUID())
    );
    const result = await runAssistantTurn(
      [],
      "查",
      d,
      new AbortController().signal
    );
    expect(result.error).toMatch(/已暂停/);
    expect(d.complete).toHaveBeenCalledTimes(10);
    expect(d.review).not.toHaveBeenCalled();
  });
  it("records a stopped turn with valid history", async () => {
    const controller = new AbortController();
    controller.abort();
    const d = setup([]);
    const result = await runAssistantTurn([], "hi", d, controller.signal);
    expect(result.error).toMatch(/已停止/);
    expect(d.complete).not.toHaveBeenCalled();
  });
});
