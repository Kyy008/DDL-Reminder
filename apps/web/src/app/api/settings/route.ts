import { NextResponse } from "next/server";
import { validationError } from "@/lib/api-response";
import { getPrisma } from "@/lib/prisma";
import { updateSettingsSchema } from "@/lib/settings-validation";
import { requireUserSession } from "@/lib/task-auth";

export async function GET() {
  const { response, session } = await requireUserSession();

  if (response) {
    return response;
  }

  const settings = await getUserSettings(session.user.id);

  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  const { response, session } = await requireUserSession();

  if (response) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const user = await getPrisma().user.update({
    where: {
      id: session.user.id
    },
    data: {
      emailReminderEnabled: parsed.data.emailReminderEnabled,
      approachingReminderMinutes: parsed.data.approachingReminderMinutes,
      urgentReminderMinutes: parsed.data.urgentReminderMinutes
    },
    select: {
      emailReminderEnabled: true,
      approachingReminderMinutes: true,
      urgentReminderMinutes: true
    }
  });

  return NextResponse.json({
    settings: {
      emailReminderEnabled: user.emailReminderEnabled,
      approachingReminderMinutes: user.approachingReminderMinutes,
      urgentReminderMinutes: user.urgentReminderMinutes
    }
  });
}

async function getUserSettings(userId: string) {
  const user = await getPrisma().user.findUnique({
    where: {
      id: userId
    },
    select: {
      emailReminderEnabled: true,
      approachingReminderMinutes: true,
      urgentReminderMinutes: true
    }
  });

  return {
    emailReminderEnabled: user?.emailReminderEnabled ?? true,
    approachingReminderMinutes: user?.approachingReminderMinutes ?? 2880,
    urgentReminderMinutes: user?.urgentReminderMinutes ?? 120
  };
}
