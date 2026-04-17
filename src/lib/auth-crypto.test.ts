import { describe, expect, it } from "vitest";
import {
  addSeconds,
  generateAuthToken,
  hashAuthToken,
  hashPassword,
  verifyPassword
} from "./auth-crypto";

describe("password hashing", () => {
  it("verifies the original password", async () => {
    const storedHash = await hashPassword("correct-password");

    await expect(verifyPassword("correct-password", storedHash)).resolves.toBe(
      true
    );
  });

  it("rejects an incorrect password", async () => {
    const storedHash = await hashPassword("correct-password");

    await expect(verifyPassword("wrong-password", storedHash)).resolves.toBe(
      false
    );
  });

  it("rejects malformed hashes", async () => {
    await expect(verifyPassword("password", "not-a-valid-hash")).resolves.toBe(
      false
    );
  });
});

describe("auth tokens", () => {
  it("generates different high entropy tokens", () => {
    const firstToken = generateAuthToken();
    const secondToken = generateAuthToken();

    expect(firstToken).not.toEqual(secondToken);
    expect(firstToken.length).toBeGreaterThanOrEqual(32);
  });

  it("hashes tokens with the provided secret", () => {
    const token = "raw-token";

    expect(hashAuthToken(token, "secret")).toEqual(
      hashAuthToken(token, "secret")
    );
    expect(hashAuthToken(token, "secret")).not.toEqual(
      hashAuthToken(token, "different-secret")
    );
  });
});

describe("addSeconds", () => {
  it("adds seconds without mutating the original date", () => {
    const now = new Date("2026-04-17T00:00:00.000Z");
    const later = addSeconds(now, 60);

    expect(later.toISOString()).toBe("2026-04-17T00:01:00.000Z");
    expect(now.toISOString()).toBe("2026-04-17T00:00:00.000Z");
  });
});
