import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => {
  const prisma = {
    task: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn()
    }
  };

  return {
    getPrisma: vi.fn(),
    prisma,
    requireUserSession: vi.fn(),
    sendDueTaskRemindersForUser: vi.fn()
  };
});

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma
}));

vi.mock("@/lib/task-auth", () => ({
  requireUserSession: mocks.requireUserSession
}));

vi.mock("@/lib/task-reminders", () => ({
  sendDueTaskRemindersForUser: mocks.sendDueTaskRemindersForUser
}));

describe("tasks route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.prisma.task.findFirst.mockResolvedValue(null);
    mocks.sendDueTaskRemindersForUser.mockResolvedValue(undefined);
    mocks.requireUserSession.mockResolvedValue({
      response: null,
      session: {
        user: {
          id: "user_1"
        }
      }
    });
  });

  it("lists only the current user's tasks in status and due-date order", async () => {
    const tasks = [
      {
        id: "task_1",
        userId: "user_1"
      }
    ];
    mocks.prisma.task.findMany.mockResolvedValue(tasks);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tasks });
    expect(mocks.prisma.task.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user_1"
      },
      orderBy: [
        {
          status: "asc"
        },
        {
          dueAt: "asc"
        }
      ]
    });
    expect(mocks.sendDueTaskRemindersForUser).toHaveBeenCalledWith({
      prisma: mocks.prisma,
      userId: "user_1"
    });
  });

  it("creates a task owned by the current user and normalizes empty descriptions", async () => {
    const task = {
      id: "task_1",
      userId: "user_1",
      title: "Submit report"
    };
    mocks.prisma.task.create.mockResolvedValue(task);

    const response = await POST(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Submit report",
          description: "",
          startAt: "2026-04-20T01:00:00.000Z",
          dueAt: "2026-04-20T02:00:00.000Z"
        })
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ task });
    expect(mocks.prisma.task.create).toHaveBeenCalledWith({
      data: {
        title: "Submit report",
        description: null,
        startAt: new Date("2026-04-20T01:00:00.000Z"),
        dueAt: new Date("2026-04-20T02:00:00.000Z"),
        user: {
          connect: {
            id: "user_1"
          }
        }
      }
    });
  });

  it("rejects duplicate task titles for the current user", async () => {
    mocks.prisma.task.findFirst.mockResolvedValue({
      id: "task_existing",
      userId: "user_1",
      title: "Submit report"
    });

    const response = await POST(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Submit report",
          startAt: "2099-04-20T01:00:00.000Z",
          dueAt: "2099-04-20T02:00:00.000Z"
        })
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "任务标题已存在。"
    });
    expect(mocks.prisma.task.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        title: "Submit report"
      }
    });
    expect(mocks.prisma.task.create).not.toHaveBeenCalled();
  });

  it("creates a task without a DDL", async () => {
    const task = {
      id: "task_1",
      userId: "user_1",
      title: "Read references",
      startAt: null,
      dueAt: null
    };
    mocks.prisma.task.create.mockResolvedValue(task);

    const response = await POST(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Read references",
          hasDeadline: false
        })
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ task });
    expect(mocks.prisma.task.create).toHaveBeenCalledWith({
      data: {
        title: "Read references",
        description: null,
        startAt: null,
        dueAt: null,
        user: {
          connect: {
            id: "user_1"
          }
        }
      }
    });
  });

  it("rejects invalid task payloads before writing", async () => {
    const response = await POST(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "",
          dueAt: "not-a-date"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "请求参数无效。"
    });
    expect(mocks.prisma.task.create).not.toHaveBeenCalled();
  });
});
