import { describe, expect, it } from "vitest";
import {
  createEmptyLocalAppState,
  createTaskInState,
  completeTaskInState,
  archiveTaskInState,
  deleteTaskInState,
  updateTaskInState
} from "./local-app-state";
import {
  createLocalTaskStore,
  createMemoryStorageBackend
} from "./local-task-store";
import {
  applyTaskProposalInState,
  ASSISTANT_TOOLS,
  createTaskProposal,
  queryAssistantTasks
} from "./task-assistant";
import { getTaskReminderPlans } from "./local-reminder-scheduler";

const now = new Date("2030-01-02T04:00:00Z");
const initial = () =>
  createTaskInState(
    createEmptyLocalAppState(),
    { title: "读书", description: "第三章", dueAt: "2030-01-03T04:00:00Z" },
    { id: "task-1", now }
  ).state;

describe("task assistant proposals", () => {
  it("advertises completion as a model tool operation", () => {
    const tool = ASSISTANT_TOOLS.find(
      (tool) => tool.function.name === "propose_task_change"
    );
    expect(tool?.function.parameters.properties).toHaveProperty(
      "operation.enum",
      ["create", "update", "delete", "complete"]
    );
  });
  it("previews completion with before/after status without mutating a task", () => {
    const state = initial(),
      snapshot = JSON.stringify(state);
    const proposal = createTaskProposal(
      state,
      { operation: "complete", taskId: "task-1" },
      now
    );
    expect(proposal.before?.status).toBe("ACTIVE");
    expect(proposal.after).toEqual({
      ...state.tasks[0],
      status: "COMPLETED",
      updatedAt: now.toISOString()
    });
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(
      getTaskReminderPlans(state.tasks[0], state.settings, now).length
    ).toBeGreaterThan(0);
    expect(getTaskReminderPlans(proposal.after!, state.settings, now)).toEqual(
      []
    );
  });
  it("completes only the confirmed task and preserves its other fields and other tasks", () => {
    const state = createTaskInState(
      initial(),
      { title: "保留的任务", hasDeadline: false },
      { id: "task-2", now }
    ).state;
    const proposal = createTaskProposal(
      state,
      { operation: "complete", taskId: "task-1" },
      now
    );
    proposal.input = { title: "未确认的标题", status: "ARCHIVED", dueAt: null };
    const confirmedAt = new Date(now.getTime() + 1000);
    const result = applyTaskProposalInState(state, proposal, confirmedAt);
    expect(result.state.tasks).toHaveLength(2);
    expect(result.task).toEqual({
      ...state.tasks[0],
      status: "COMPLETED",
      updatedAt: confirmedAt.toISOString()
    });
    expect(result.state.tasks[1]).toEqual(state.tasks[1]);
    expect(state.tasks[0].status).toBe("ACTIVE");
  });
  it("allows completing overdue tasks and tasks without deadlines", () => {
    const overdue = new Date("2030-01-05T00:00:00Z");
    const state = initial();
    const proposal = createTaskProposal(
      state,
      { operation: "complete", taskId: "task-1" },
      overdue
    );
    expect(
      applyTaskProposalInState(state, proposal, overdue).task?.status
    ).toBe("COMPLETED");
    const noDeadline = createTaskInState(
      createEmptyLocalAppState(),
      { title: "无截止", hasDeadline: false },
      { id: "task-none", now }
    ).state;
    expect(
      createTaskProposal(
        noDeadline,
        { operation: "complete", taskId: "task-none" },
        now
      ).after?.dueAt
    ).toBeNull();
  });
  it("rejects missing IDs, mixed edits and attempts to complete non-active tasks", () => {
    const state = initial();
    for (const args of [
      { operation: "complete" },
      { operation: "complete", taskId: "made-up" },
      {
        operation: "complete",
        taskId: "task-1",
        fields: { title: "偷偷修改" }
      },
      { operation: "complete", taskId: "task-1", fields: { dueAt: null } },
      {
        operation: "complete",
        taskId: "task-1",
        fields: { status: "COMPLETED" }
      }
    ])
      expect(() => createTaskProposal(state, args, now)).toThrow();
    expect(() =>
      createTaskProposal(
        completeTaskInState(state, "task-1", { now }).state,
        { operation: "complete", taskId: "task-1" },
        now
      )
    ).toThrow("已经完成");
    expect(() =>
      createTaskProposal(
        archiveTaskInState(state, "task-1", { now }).state,
        { operation: "complete", taskId: "task-1" },
        now
      )
    ).toThrow("已归档");
  });
  it("rejects completion after the task was edited, completed, archived or deleted", () => {
    const state = initial();
    const proposal = createTaskProposal(
      state,
      { operation: "complete", taskId: "task-1" },
      now
    );
    for (const changed of [
      updateTaskInState(state, "task-1", { title: "已修改" }, { now }).state,
      completeTaskInState(state, "task-1", { now }).state,
      archiveTaskInState(state, "task-1", { now }).state,
      deleteTaskInState(state, "task-1").state
    ])
      expect(() => applyTaskProposalInState(changed, proposal, now)).toThrow(
        "发生变化"
      );
  });
  it("rejects tampered completion previews instead of applying unreviewed edits", () => {
    const state = initial();
    const proposal = createTaskProposal(
      state,
      { operation: "complete", taskId: "task-1" },
      now
    );
    proposal.after = { ...proposal.after!, title: "不是原任务的标题" };
    expect(() => applyTaskProposalInState(state, proposal, now)).toThrow(
      "完成信息有误"
    );
  });
  it("serializes completion and rejects duplicate confirmations", async () => {
    const store = createLocalTaskStore(createMemoryStorageBackend(initial()));
    const proposal = createTaskProposal(
      await store.getState(),
      { operation: "complete", taskId: "task-1" },
      now
    );
    const results = await Promise.allSettled([
      store.confirmTaskProposal(proposal),
      store.confirmTaskProposal(proposal)
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected"
    ]);
    expect(await store.listTasks()).toHaveLength(1);
    expect((await store.listTasks())[0].status).toBe("COMPLETED");
  });
  it("creates a preview without changing storage or the supplied state", () => {
    const state = initial();
    const before = JSON.stringify(state);
    const proposal = createTaskProposal(
      state,
      {
        operation: "create",
        fields: { title: "交作业", dueAt: "2030-01-04T12:00:00+08:00" }
      },
      now
    );
    expect(proposal.after?.title).toBe("交作业");
    expect(proposal.after?.dueAt).toBe("2030-01-04T04:00:00.000Z");
    expect(JSON.stringify(state)).toBe(before);
  });
  it("allows tasks without deadlines and requires a title", () => {
    expect(
      createTaskProposal(
        initial(),
        { operation: "create", fields: { title: "随手记" } },
        now
      ).after?.dueAt
    ).toBeNull();
    expect(() =>
      createTaskProposal(
        initial(),
        { operation: "create", fields: { description: "无标题" } },
        now
      )
    ).toThrow();
  });
  it("preserves unspecified fields in edit previews and clearly removes deadlines", () => {
    const proposal = createTaskProposal(
      initial(),
      {
        operation: "update",
        taskId: "task-1",
        fields: { description: "第四章" }
      },
      now
    );
    expect(proposal.before?.description).toBe("第三章");
    expect(proposal.after?.description).toBe("第四章");
    expect(proposal.after?.title).toBe("读书");
    expect(proposal.after?.dueAt).toBe(proposal.before?.dueAt);
    expect(
      createTaskProposal(
        initial(),
        { operation: "update", taskId: "task-1", fields: { dueAt: null } },
        now
      ).after?.startAt
    ).toBeNull();
  });
  it("rejects unknown fields, fabricated IDs and past deadlines", () => {
    expect(() =>
      createTaskProposal(
        initial(),
        { operation: "update", taskId: "made-up", fields: { title: "x" } },
        now
      )
    ).toThrow();
    expect(() =>
      createTaskProposal(
        initial(),
        {
          operation: "create",
          fields: { title: "x", command: "delete everything" }
        },
        now
      )
    ).toThrow();
    expect(() =>
      createTaskProposal(
        initial(),
        {
          operation: "create",
          fields: { title: "x", dueAt: "2030-01-01T04:00:00Z" }
        },
        now
      )
    ).toThrow(/晚于/);
    expect(() =>
      createTaskProposal(
        initial(),
        {
          operation: "update",
          taskId: "task-1",
          fields: { dueAt: "2030-01-02T04:00:00" }
        },
        now
      )
    ).toThrow();
  });
  it("does not apply stale edits or deletes", () => {
    const state = initial();
    const proposal = createTaskProposal(
      state,
      { operation: "delete", taskId: "task-1" },
      now
    );
    const changed = updateTaskInState(
      state,
      "task-1",
      { title: "已手工修改" },
      { now: new Date(now.getTime() + 1000) }
    ).state;
    expect(() => applyTaskProposalInState(changed, proposal, now)).toThrow(
      /发生变化/
    );
    expect(
      applyTaskProposalInState(state, proposal, now).state.tasks
    ).toHaveLength(0);
  });
  it("validates deadlines again after a delayed confirmation", () => {
    const state = initial();
    const create = createTaskProposal(
      state,
      {
        operation: "create",
        fields: { title: "x", dueAt: "2030-01-02T05:00:00Z" }
      },
      now
    );
    expect(() =>
      applyTaskProposalInState(state, create, new Date("2030-01-02T06:00:00Z"))
    ).toThrow();
    const update = createTaskProposal(
      state,
      {
        operation: "update",
        taskId: "task-1",
        fields: { dueAt: "2030-01-02T05:00:00Z" }
      },
      now
    );
    expect(() =>
      applyTaskProposalInState(state, update, new Date("2030-01-02T06:00:00Z"))
    ).toThrow(/已经过去/);
  });
  it("applies only the displayed fields, not hidden unreviewed input", () => {
    const state = initial();
    const proposal = createTaskProposal(
      state,
      {
        operation: "update",
        taskId: "task-1",
        fields: { title: "确认看到的标题" }
      },
      now
    );
    proposal.input = { title: "不应执行的隐藏输入" };
    expect(applyTaskProposalInState(state, proposal, now).task?.title).toBe(
      "确认看到的标题"
    );
  });
  it("serializes confirmation with manual edits and rejects duplicate confirmations", async () => {
    const store = createLocalTaskStore(createMemoryStorageBackend(initial()));
    const proposal = createTaskProposal(
      await store.getState(),
      { operation: "delete", taskId: "task-1" },
      now
    );
    await store.confirmTaskProposal(proposal);
    await expect(store.confirmTaskProposal(proposal)).rejects.toThrow(
      /已经执行/
    );
    expect(await store.listTasks()).toHaveLength(0);
  });
  it("catches conflicts inside the mutation queue without overwriting", async () => {
    const store = createLocalTaskStore(createMemoryStorageBackend(initial()));
    const proposal = createTaskProposal(
      await store.getState(),
      { operation: "delete", taskId: "task-1" },
      now
    );
    const manual = store.updateTask("task-1", { description: "手动编辑" });
    await expect(store.confirmTaskProposal(proposal)).rejects.toThrow(
      /发生变化/
    );
    await manual;
    expect((await store.listTasks())[0].description).toBe("手动编辑");
  });
});
describe("assistant queries", () => {
  it("filters and paginates without changing any tasks", () => {
    let state = initial();
    state = createTaskInState(
      state,
      { title: "Read English", hasDeadline: false },
      { id: "task-2", now }
    ).state;
    const before = JSON.stringify(state);
    expect(
      queryAssistantTasks(state, { keyword: "read" }).tasks.map(
        (task) => task.id
      )
    ).toEqual(["task-2"]);
    expect(
      queryAssistantTasks(state, { dueBefore: "2030-01-04T00:00:00Z" }).total
    ).toBe(1);
    expect(queryAssistantTasks(state, { limit: 1 }).hasMore).toBe(true);
    expect(
      queryAssistantTasks(state, { limit: 1, offset: 1 }).tasks[0].id
    ).toBe("task-2");
    expect(JSON.stringify(state)).toBe(before);
  });
});
