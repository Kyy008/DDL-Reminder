import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
export const EMAIL_VERIFICATION_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24;

const PASSWORD_HASH_VERSION = "scrypt";
const PASSWORD_KEY_LENGTH = 64;

export function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is required.");
  }

  return secret;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scryptAsync(
    password,
    salt,
    PASSWORD_KEY_LENGTH
  )) as Buffer;

  return `${PASSWORD_HASH_VERSION}$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [version, salt, expectedHash, extra] = storedHash.split("$");

  if (
    version !== PASSWORD_HASH_VERSION ||
    !salt ||
    !expectedHash ||
    extra !== undefined
  ) {
    return false;
  }

  const key = (await scryptAsync(
    password,
    salt,
    PASSWORD_KEY_LENGTH
  )) as Buffer;

  return safeEqual(key.toString("base64url"), expectedHash);
}

export function generateAuthToken() {
  return randomBytes(32).toString("base64url");
}

export function hashAuthToken(token: string, secret = getSessionSecret()) {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

export function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
