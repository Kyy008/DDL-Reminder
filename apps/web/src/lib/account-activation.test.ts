import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateEmailVerificationToken,
  createEmailVerificationToken
} from "./account-activation";
import { hashAuthToken } from "./auth-crypto";

const mocks = vi.hoisted(() => {
  const prisma = {
    emailVerificationToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    user: {
      update: vi.fn()
    },
    $transaction: vi.fn()
  };

  return {
    prisma
  };
});

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => mocks.prisma
}));

describe("createEmailVerificationToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores a hashed activation token and returns a 24-hour activation link", async () => {
    const now = new Date("2026-04-20T01:00:00.000Z");
    mocks.prisma.emailVerificationToken.create.mockResolvedValue({});

    const result = await createEmailVerificationToken("user_1", now);

    expect(result.expiresAt.toISOString()).toBe("2026-04-21T01:00:00.000Z");
    expect(result.activationUrl).toBe(
      `http://localhost:3000/auth/activate?token=${encodeURIComponent(
        result.token
      )}`
    );
    expect(mocks.prisma.emailVerificationToken.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        tokenHash: hashAuthToken(result.token),
        expiresAt: result.expiresAt
      }
    });
  });
});

describe("activateEmailVerificationToken", () => {
  const now = new Date("2026-04-20T01:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns invalid without querying when the token is empty", async () => {
    await expect(activateEmailVerificationToken("", now)).resolves.toBe(
      "invalid"
    );

    expect(
      mocks.prisma.emailVerificationToken.findUnique
    ).not.toHaveBeenCalled();
  });

  it("returns invalid when the token hash is not found", async () => {
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

    await expect(
      activateEmailVerificationToken("missing-token", now)
    ).resolves.toBe("invalid");

    expect(mocks.prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith(
      {
        where: {
          tokenHash: hashAuthToken("missing-token")
        }
      }
    );
  });

  it("does not activate an already consumed token", async () => {
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: "verification_1",
      userId: "user_1",
      consumedAt: new Date("2026-04-20T00:00:00.000Z"),
      expiresAt: new Date("2026-04-21T00:00:00.000Z")
    });

    await expect(
      activateEmailVerificationToken("used-token", now)
    ).resolves.toBe("already-used");

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not activate an expired token", async () => {
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: "verification_1",
      userId: "user_1",
      consumedAt: null,
      expiresAt: new Date("2026-04-20T01:00:00.000Z")
    });

    await expect(
      activateEmailVerificationToken("expired-token", now)
    ).resolves.toBe("expired");

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("marks the user verified and consumes a valid token atomically", async () => {
    const userUpdate = Symbol("user-update");
    const tokenUpdate = Symbol("token-update");
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: "verification_1",
      userId: "user_1",
      consumedAt: null,
      expiresAt: new Date("2026-04-20T02:00:00.000Z")
    });
    mocks.prisma.user.update.mockReturnValue(userUpdate);
    mocks.prisma.emailVerificationToken.update.mockReturnValue(tokenUpdate);
    mocks.prisma.$transaction.mockResolvedValue([{}, {}]);

    await expect(
      activateEmailVerificationToken("valid-token", now)
    ).resolves.toBe("activated");

    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: {
        id: "user_1"
      },
      data: {
        emailVerifiedAt: now
      }
    });
    expect(mocks.prisma.emailVerificationToken.update).toHaveBeenCalledWith({
      where: {
        id: "verification_1"
      },
      data: {
        consumedAt: now
      }
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith([
      userUpdate,
      tokenUpdate
    ]);
  });
});
