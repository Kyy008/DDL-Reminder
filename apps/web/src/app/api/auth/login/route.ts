import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth-session";
import {
  isEmailIdentifier,
  loginSchema,
  normalizeEmail,
  normalizeUsername
} from "@/lib/auth-validation";
import { verifyPassword } from "@/lib/auth-crypto";
import { jsonError, validationError } from "@/lib/api-response";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth-error-messages";
import { getPrisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const identifier = parsed.data.identifier;
  const user = await getPrisma().user.findUnique({
    where: isEmailIdentifier(identifier)
      ? {
          email: normalizeEmail(identifier)
        }
      : {
          username: normalizeUsername(identifier)
        }
  });

  if (
    !user ||
    !(await verifyPassword(parsed.data.password, user.passwordHash))
  ) {
    return jsonError(AUTH_ERROR_MESSAGES.invalidCredentials, 401);
  }

  if (!user.emailVerifiedAt) {
    return jsonError(AUTH_ERROR_MESSAGES.emailNotActivated, 403);
  }

  const { cookie } = await createSession(user.id);
  const response = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email
    }
  });
  response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
}
