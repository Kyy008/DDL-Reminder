import { describe, expect, it, vi } from "vitest";
import { createEmptyLocalAppState, createTaskInState } from "./local-app-state";
import {
  runAssistantTurn,
  settleOutstandingTools,
  type AssistantRunnerDependencies,
  type ProposalOutcome
} from "./assistant-runner";
import type { AssistantMessage, TaskProposal } from "./task-assistant";
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

function batch(
  calls: Array<{ name?: string; args: unknown }>
): AssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: calls.flatMap(
      ({ name = "propose_task_change", args }, index) =>
        tool(name, args, `batch-${index}`).tool_calls!
    )
  };
}

async function setupBatch(replies: AssistantMessage[], count = 3) {
  const dependencies = setup(replies);
  let state = await dependencies.getState();
  for (let index = 2; index <= count; index++) {
    state = createTaskInState(
      state,
      { title: `existing ${index}`, hasDeadline: false },
      { id: `task-${index}` }
    ).state;
  }
  const store = createLocalTaskStore(createMemoryStorageBackend(state));
  dependencies.getState = () => store.getState();
  return { dependencies, store };
}

describe("assistant tool loop", () => {
  it("shows mixed operations one at a time and waits for each independent confirmation", async () => {
    const { dependencies: d, store } = await setupBatch([
      batch([
        { args: { operation: "complete", taskId: "task-1" } },
        { args: { operation: "delete", taskId: "task-2" } },
        {
          args: {
            operation: "update",
            taskId: "task-3",
            fields: { title: "edited third task" }
          }
        }
      ]),
      { role: "assistant", content: "三项操作分别确认完毕。" }
    ]);
    const reviews: Array<{
      proposal: TaskProposal;
      resolve: (result: ProposalOutcome) => void;
    }> = [];
    d.review = vi.fn(
      (proposal) =>
        new Promise<ProposalOutcome>((resolve) =>
          reviews.push({ proposal, resolve })
        )
    );
    const running = runAssistantTurn(
      [],
      "完成第一个，删除第二个，修改第三个",
      d,
      new AbortController().signal
    );
    for (let index = 0; index < 3; index++) {
      await vi.waitFor(() => expect(reviews).toHaveLength(index + 1));
      // The next confirmation and model response cannot start early.
      expect(d.complete).toHaveBeenCalledOnce();
      const tasks = await store.listTasks();
      expect(tasks.find((task) => task.id === "task-1")?.status).toBe(
        index === 0 ? "ACTIVE" : "COMPLETED"
      );
      expect(tasks.some((task) => task.id === "task-2")).toBe(index < 2);
      expect(tasks.find((task) => task.id === "task-3")?.title).toBe(
        "existing 3"
      );
      const task = await store.confirmTaskProposal(reviews[index].proposal);
      reviews[index].resolve({ status: "confirmed", task, message: "已确认" });
    }
    const result = await running;
    expect(result.error).toBeNull();
    expect(d.review).toHaveBeenCalledTimes(3);
    expect(
      result.messages
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(message.content!).status)
    ).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(
      (await store.listTasks()).find((task) => task.id === "task-3")?.title
    ).toBe("edited third task");
  });

  it.each(["complete", "delete", "create"] as const)(
    "independently confirms two consecutive %s operations in one turn",
    async (operation) => {
      const { dependencies: d, store } = await setupBatch([
        batch(
          [1, 2].map((index) => ({
            args:
              operation === "create"
                ? { operation, fields: { title: `new ${index}`, dueAt: null } }
                : { operation, taskId: `task-${index}` }
          }))
        ),
        { role: "assistant", content: "两项都已确认。" }
      ]);
      d.review = vi.fn<AssistantRunnerDependencies["review"]>(
        async (proposal) => ({
          status: "confirmed",
          task: await store.confirmTaskProposal(proposal),
          message: "已确认"
        })
      );
      const result = await runAssistantTurn(
        [],
        "处理两项任务",
        d,
        new AbortController().signal
      );
      expect(result.error).toBeNull();
      expect(d.review).toHaveBeenCalledTimes(2);
      expect(vi.mocked(d.review).mock.calls[0][0].id).not.toBe(
        vi.mocked(d.review).mock.calls[1][0].id
      );
      const tasks = await store.listTasks();
      if (operation === "create") {
        expect(tasks.map((task) => task.title)).toEqual(
          expect.arrayContaining(["new 1", "new 2"])
        );
        expect(tasks).toHaveLength(5);
      } else if (operation === "delete") {
        expect(tasks.map((task) => task.id)).toEqual(["task-3"]);
      } else {
        expect(
          tasks
            .filter((task) => task.status === "COMPLETED")
            .map((task) => task.id)
        ).toEqual(["task-1", "task-2"]);
        expect(tasks.find((task) => task.id === "task-3")?.status).toBe(
          "ACTIVE"
        );
      }
    }
  );

  it("continues to the next requested task after cancelling only the first card", async () => {
    const { dependencies: d, store } = await setupBatch([
      batch([
        { args: { operation: "delete", taskId: "task-1" } },
        { args: { operation: "delete", taskId: "task-2" } }
      ]),
      { role: "assistant", content: "第一项取消，第二项已删除。" }
    ]);
    d.review = vi.fn<AssistantRunnerDependencies["review"]>(
      async (proposal) => {
        if (proposal.before?.id === "task-1")
          return { status: "cancelled", message: "只取消当前项" };
        return {
          status: "confirmed",
          message: "已删除",
          task: await store.confirmTaskProposal(proposal)
        };
      }
    );
    const result = await runAssistantTurn(
      [],
      "删除两个任务",
      d,
      new AbortController().signal
    );
    expect(result.error).toBeNull();
    expect(d.review).toHaveBeenCalledTimes(2);
    expect((await store.listTasks()).map((task) => task.id)).toEqual([
      "task-1",
      "task-3"
    ]);
    expect(
      result.messages
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(message.content!).status)
    ).toEqual(["cancelled", "confirmed"]);
  });

  it("uses fresh state for a later operation on the same task across model rounds", async () => {
    const { dependencies: d, store } = await setupBatch([
      tool(
        "propose_task_change",
        { operation: "complete", taskId: "task-1" },
        "finish"
      ),
      tool("query_tasks", { keyword: "existing" }, "refresh"),
      tool(
        "propose_task_change",
        {
          operation: "update",
          taskId: "task-1",
          fields: { description: "完成后的备注" }
        },
        "edit"
      ),
      { role: "assistant", content: "已完成并补上备注。" }
    ]);
    d.review = vi.fn<AssistantRunnerDependencies["review"]>(
      async (proposal) => {
        if (proposal.operation === "update") {
          expect(proposal.before?.status).toBe("COMPLETED");
          expect(proposal.before).toEqual((await store.listTasks())[0]);
        }
        return {
          status: "confirmed",
          message: "已确认",
          task: await store.confirmTaskProposal(proposal)
        };
      }
    );
    const result = await runAssistantTurn(
      [],
      "先完成第一个任务，再补备注",
      d,
      new AbortController().signal
    );
    expect(result.error).toBeNull();
    expect(d.review).toHaveBeenCalledTimes(2);
    expect((await store.listTasks())[0]).toMatchObject({
      status: "COMPLETED",
      description: "完成后的备注"
    });
    expect(
      JSON.parse(
        result.messages.find((message) => message.tool_call_id === "refresh")!
          .content!
      ).tasks[0].status
    ).toBe("COMPLETED");
  });

  it("does not let a failed item prevent reviewing a later independent task", async () => {
    const { dependencies: d, store } = await setupBatch([
      batch([
        { args: { operation: "delete", taskId: "missing-task" } },
        { args: { operation: "complete", taskId: "task-2" } }
      ]),
      { role: "assistant", content: "第一项失败，第二项已完成。" }
    ]);
    d.review = vi.fn<AssistantRunnerDependencies["review"]>(
      async (proposal) => ({
        status: "confirmed",
        message: "已确认",
        task: await store.confirmTaskProposal(proposal)
      })
    );
    const result = await runAssistantTurn(
      [],
      "处理两项",
      d,
      new AbortController().signal
    );
    expect(result.error).toBeNull();
    expect(d.review).toHaveBeenCalledOnce();
    expect(
      result.messages
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(message.content!).status)
    ).toEqual(["failed", "confirmed"]);
    expect(
      (await store.listTasks()).find((task) => task.id === "task-2")?.status
    ).toBe("COMPLETED");
  });

  it("stops the remaining cards while preserving an already confirmed operation", async () => {
    const controller = new AbortController();
    const { dependencies: d, store } = await setupBatch([
      batch(
        [1, 2, 3].map((index) => ({
          args: { operation: "complete", taskId: `task-${index}` }
        }))
      )
    ]);
    d.review = vi.fn<AssistantRunnerDependencies["review"]>(
      async (proposal) => {
        if (proposal.before?.id === "task-1")
          return {
            status: "confirmed",
            message: "已完成",
            task: await store.confirmTaskProposal(proposal)
          };
        controller.abort();
        return { status: "cancelled", message: "停止其余操作" };
      }
    );
    const result = await runAssistantTurn(
      [],
      "完成三个任务",
      d,
      controller.signal
    );
    expect(result.error).toMatch(/已停止/);
    expect(d.review).toHaveBeenCalledTimes(2);
    expect(d.complete).toHaveBeenCalledOnce();
    expect((await store.listTasks()).map((task) => task.status)).toEqual([
      "COMPLETED",
      "ACTIVE",
      "ACTIVE"
    ]);
    expect(
      result.messages
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(message.content!).status)
    ).toEqual(["confirmed", "cancelled", "cancelled"]);
  });

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
