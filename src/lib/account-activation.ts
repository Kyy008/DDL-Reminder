import { appConfig } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import {
  addSeconds,
  EMAIL_VERIFICATION_TOKEN_MAX_AGE_SECONDS,
  generateAuthToken,
  hashAuthToken
} from "./auth-crypto";

export type ActivationResult =
  | "activated"
  | "already-used"
  | "expired"
  | "invalid";

export async function createEmailVerificationToken(
  userId: string,
  now = new Date()
) {
  const token = generateAuthToken();
  const expiresAt = addSeconds(now, EMAIL_VERIFICATION_TOKEN_MAX_AGE_SECONDS);

  await getPrisma().emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashAuthToken(token),
      expiresAt
    }
  });

  return {
    token,
    expiresAt,
    activationUrl: `${appConfig.appUrl}/auth/activate?token=${encodeURIComponent(
      token
    )}`
  };
}

export async function activateEmailVerificationToken(
  token: string,
  now = new Date()
): Promise<ActivationResult> {
  if (!token) {
    return "invalid";
  }

  const prisma = getPrisma();
  const verificationToken = await prisma.emailVerificationToken.findUnique({
    where: {
      tokenHash: hashAuthToken(token)
    }
  });

  if (!verificationToken) {
    return "invalid";
  }

  if (verificationToken.consumedAt) {
    return "already-used";
  }

  if (verificationToken.expiresAt <= now) {
    return "expired";
  }

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: verificationToken.userId
      },
      data: {
        emailVerifiedAt: now
      }
    }),
    prisma.emailVerificationToken.update({
      where: {
        id: verificationToken.id
      },
      data: {
        consumedAt: now
      }
    })
  ]);

  return "activated";
}
