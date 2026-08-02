import { beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_ERROR_MESSAGES } from "@/lib/task-error-messages";
import { DELETE, PATCH } from "./route";

const mocks = vi.hoisted(() => {
  const prisma = {
    task: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn()
    }
  };

  return {
    getPrisma: vi.fn(),
    prisma,
    requireUserSession: vi.fn()
  };
});

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma
}));

vi.mock("@/lib/task-auth", () => ({
  requireUserSession: mocks.requireUserSession
}));

const routeContext = {
  params: Promise.resolve({
    id: "task_1"
  })
};

describe("task detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.requireUserSession.mockResolvedValue({
      response: null,
      session: {
        user: {
          id: "user_1"
        }
      }
    });
  });

  it("rejects due-date-only updates that would cross the existing start time", async () => {
    mocks.prisma.task.findFirst.mockResolvedValue({
      id: "task_1",
      userId: "user_1",
      startAt: new Date("2026-04-20T02:00:00.000Z"),
      dueAt: new Date("2026-04-20T03:00:00.000Z")
    });

    const response = await PATCH(
      new Request("http://localhost/api/tasks/task_1", {
        method: "PATCH",
        body: JSON.stringify({
          dueAt: "2026-04-20T01:00:00.000Z"
        })
      }),
      routeContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: TASK_ERROR_MESSAGES.dateRangeInvalid
    });
    expect(mocks.prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("updates only tasks owned by the current user", async () => {
    const updatedTask = {
      id: "task_1",
      userId: "user_1",
      title: "Updated title"
    };
    mocks.prisma.task.findFirst.mockResolvedValueOnce({
      id: "task_1",
      userId: "user_1",
      title: "Old title",
      startAt: new Date("2026-04-20T01:00:00.000Z"),
      dueAt: new Date("2026-04-20T03:00:00.000Z")
    });
    mocks.prisma.task.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.task.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.task.findUnique.mockResolvedValue(updatedTask);

    const response = await PATCH(
      new Request("http://localhost/api/tasks/task_1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "  Updated title  "
        })
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ task: updatedTask });
    expect(mocks.prisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: "task_1",
        userId: "user_1"
      },
      data: {
        title: "Updated title"
      }
    });
  });

  it("rejects updating a task to a duplicate title", async () => {
    mocks.prisma.task.findFirst.mockResolvedValueOnce({
      id: "task_1",
      userId: "user_1",
      title: "Old title",
      startAt: new Date("2026-04-20T01:00:00.000Z"),
      dueAt: new Date("2026-04-20T03:00:00.000Z")
    });
    mocks.prisma.task.findFirst.mockResolvedValueOnce({
      id: "task_2",
      userId: "user_1",
      title: "Updated title"
    });

    const response = await PATCH(
      new Request("http://localhost/api/tasks/task_1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated title"
        })
      }),
      routeContext
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: TASK_ERROR_MESSAGES.duplicateTitle
    });
    expect(mocks.prisma.task.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        userId: "user_1",
        title: "Updated title",
        NOT: {
          id: "task_1"
        }
      }
    });
    expect(mocks.prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("removes a task DDL", async () => {
    const updatedTask = {
      id: "task_1",
      userId: "user_1",
      title: "Updated title",
      startAt: null,
      dueAt: null
    };
    mocks.prisma.task.findFirst.mockResolvedValue({
      id: "task_1",
      userId: "user_1",
      startAt: new Date("2026-04-20T01:00:00.000Z"),
      dueAt: new Date("2026-04-20T03:00:00.000Z")
    });
    mocks.prisma.task.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.task.findUnique.mockResolvedValue(updatedTask);

    const response = await PATCH(
      new Request("http://localhost/api/tasks/task_1", {
        method: "PATCH",
        body: JSON.stringify({
          hasDeadline: false
        })
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ task: updatedTask });
    expect(mocks.prisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: "task_1",
        userId: "user_1"
      },
      data: {
        startAt: null,
        dueAt: null
      }
    });
  });

  it("returns not found without updating when the task is not owned by the user", async () => {
    mocks.prisma.task.findFirst.mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://localhost/api/tasks/task_1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated title"
        })
      }),
      routeContext
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: TASK_ERROR_MESSAGES.notFound
    });
    expect(mocks.prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("deletes only tasks owned by the current user", async () => {
    mocks.prisma.task.deleteMany.mockResolvedValue({ count: 1 });

    const response = await DELETE(
      new Request("http://localhost/api/tasks/task_1", {
        method: "DELETE"
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.prisma.task.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "task_1",
        userId: "user_1"
      }
    });
  });
});
