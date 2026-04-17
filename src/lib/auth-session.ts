import { cookies } from "next/headers";
import { getPrisma } from "@/lib/prisma";
import {
  addSeconds,
  generateAuthToken,
  hashAuthToken,
  SESSION_MAX_AGE_SECONDS
} from "./auth-crypto";

export const AUTH_SESSION_COOKIE = "ddl_session";

export type CurrentUser = {
  id: string;
  username: string;
  email: string;
};

export type CurrentSession = {
  id: string;
  token: string;
  user: CurrentUser;
};

export async function getCurrentSession(now = new Date()) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return getSessionByToken(token, now);
}

export async function getSessionByToken(token: string, now = new Date()) {
  const prisma = getPrisma();
  const session = await prisma.session.findUnique({
    where: {
      tokenHash: hashAuthToken(token)
    },
    include: {
      user: true
    }
  });

  if (!session || session.expiresAt <= now) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {
        // Expired sessions can be cleaned up opportunistically.
      });
    }

    return null;
  }

  if (!session.user.emailVerifiedAt) {
    return null;
  }

  await prisma.session
    .update({
      where: {
        id: session.id
      },
      data: {
        lastUsedAt: now
      }
    })
    .catch(() => {
      // A stale last-used timestamp should not fail the request.
    });

  return {
    id: session.id,
    token,
    user: {
      id: session.user.id,
      username: session.user.username,
      email: session.user.email
    }
  } satisfies CurrentSession;
}

export async function createSession(userId: string, now = new Date()) {
  const token = generateAuthToken();
  const expiresAt = addSeconds(now, SESSION_MAX_AGE_SECONDS);
  const session = await getPrisma().session.create({
    data: {
      userId,
      tokenHash: hashAuthToken(token),
      expiresAt,
      lastUsedAt: now
    }
  });

  return {
    session,
    cookie: buildSessionCookie(token)
  };
}

export async function deleteCurrentSession() {
  const session = await getCurrentSession();

  if (session) {
    await getPrisma().session.delete({ where: { id: session.id } });
  }

  return buildClearSessionCookie();
}

export function buildSessionCookie(token: string) {
  return {
    name: AUTH_SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS
    }
  };
}

export function buildClearSessionCookie() {
  return {
    name: AUTH_SESSION_COOKIE,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0
    }
  };
}
