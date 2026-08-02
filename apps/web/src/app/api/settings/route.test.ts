import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "./route";

const mocks = vi.hoisted(() => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn()
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

describe("settings route", () => {
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

  it("returns the current user's email reminder setting", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      emailReminderEnabled: false,
      approachingReminderMinutes: 1440,
      urgentReminderMinutes: 30
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      settings: {
        emailReminderEnabled: false,
        approachingReminderMinutes: 1440,
        urgentReminderMinutes: 30
      }
    });
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        id: "user_1"
      },
      select: {
        emailReminderEnabled: true,
        approachingReminderMinutes: true,
        urgentReminderMinutes: true
      }
    });
  });

  it("updates the current user's email reminder setting", async () => {
    mocks.prisma.user.update.mockResolvedValue({
      emailReminderEnabled: false,
      approachingReminderMinutes: 1440,
      urgentReminderMinutes: 30
    });

    const response = await PATCH(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          emailReminderEnabled: false,
          approachingReminderMinutes: 1440,
          urgentReminderMinutes: 30
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      settings: {
        emailReminderEnabled: false,
        approachingReminderMinutes: 1440,
        urgentReminderMinutes: 30
      }
    });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: {
        id: "user_1"
      },
      data: {
        emailReminderEnabled: false,
        approachingReminderMinutes: 1440,
        urgentReminderMinutes: 30
      },
      select: {
        emailReminderEnabled: true,
        approachingReminderMinutes: true,
        urgentReminderMinutes: true
      }
    });
  });

  it("rejects invalid settings payloads", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          emailReminderEnabled: "no"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "请求参数无效。"
    });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});
