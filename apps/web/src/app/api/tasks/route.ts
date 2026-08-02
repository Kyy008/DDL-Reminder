import { NextResponse } from "next/server";
import { jsonError, validationError } from "@/lib/api-response";
import { getPrisma } from "@/lib/prisma";
import { sendDueTaskRemindersForUser } from "@/lib/task-reminders";
import { requireUserSession } from "@/lib/task-auth";
import { TASK_ERROR_MESSAGES } from "@/lib/task-error-messages";
import {
  createTaskSchema,
  normalizeOptionalDescription
} from "@/lib/task-validation";

export async function GET() {
  const { response, session } = await requireUserSession();

  if (response) {
    return response;
  }

  const prisma = getPrisma();
  await sendDueTaskRemindersForUser({
    prisma,
    userId: session.user.id
  }).catch((error) => {
    console.error("Failed to process task reminders.", error);
  });

  const tasks = await prisma.task.findMany({
    where: {
      userId: session.user.id
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

  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const { response, session } = await requireUserSession();

  if (response) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const parsed = createTaskSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const prisma = getPrisma();
  const duplicateTask = await prisma.task.findFirst({
    where: {
      userId: session.user.id,
      title: parsed.data.title
    }
  });

  if (duplicateTask) {
    return jsonError(TASK_ERROR_MESSAGES.duplicateTitle, 409);
  }

  const hasDeadline = parsed.data.hasDeadline !== false;
  const task = await prisma.task
    .create({
      data: {
        title: parsed.data.title,
        description: normalizeOptionalDescription(parsed.data.description),
        startAt: hasDeadline ? (parsed.data.startAt ?? new Date()) : null,
        dueAt: hasDeadline ? parsed.data.dueAt : null,
        user: {
          connect: {
            id: session.user.id
          }
        }
      }
    })
    .catch((error) =>
      isUniqueConstraintError(error) ? "duplicate-title" : null
    );

  if (task === "duplicate-title") {
    return jsonError(TASK_ERROR_MESSAGES.duplicateTitle, 409);
  }

  if (!task) {
    return jsonError(TASK_ERROR_MESSAGES.createFailed, 500);
  }

  return NextResponse.json({ task }, { status: 201 });
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
