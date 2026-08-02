import { NextResponse } from "next/server";
import { jsonError, validationError } from "@/lib/api-response";
import { getPrisma } from "@/lib/prisma";
import { requireUserSession } from "@/lib/task-auth";
import { TASK_ERROR_MESSAGES } from "@/lib/task-error-messages";
import {
  isValidTaskDateRange,
  normalizeOptionalDescription,
  taskIdSchema,
  updateTaskSchema
} from "@/lib/task-validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { response, session } = await requireUserSession();

  if (response) {
    return response;
  }

  const taskId = await parseTaskId(context);

  if (!taskId) {
    return jsonError(TASK_ERROR_MESSAGES.idInvalid, 400);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateTaskSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const prisma = getPrisma();
  const existingTask = await prisma.task
    .findFirst({
      where: {
        id: taskId,
        userId: session.user.id
      }
    })
    .catch(() => null);

  if (!existingTask) {
    return jsonError(TASK_ERROR_MESSAGES.notFound, 404);
  }

  const isRemovingDeadline = parsed.data.hasDeadline === false;
  const isUpdatingDeadline =
    parsed.data.hasDeadline === true ||
    parsed.data.startAt !== undefined ||
    parsed.data.dueAt !== undefined;

  const nextStartAt = parsed.data.startAt ?? existingTask.startAt ?? new Date();
  const nextDueAt = parsed.data.dueAt ?? existingTask.dueAt;

  if (!isRemovingDeadline && isUpdatingDeadline) {
    if (!nextDueAt) {
      return jsonError(TASK_ERROR_MESSAGES.dateInvalid, 400);
    }

    if (!isValidTaskDateRange(nextStartAt, nextDueAt)) {
      return jsonError(TASK_ERROR_MESSAGES.dateRangeInvalid, 400);
    }
  }

  if (
    parsed.data.title !== undefined &&
    parsed.data.title !== existingTask.title
  ) {
    const duplicateTask = await prisma.task.findFirst({
      where: {
        userId: session.user.id,
        title: parsed.data.title,
        NOT: {
          id: taskId
        }
      }
    });

    if (duplicateTask) {
      return jsonError(TASK_ERROR_MESSAGES.duplicateTitle, 409);
    }
  }

  const taskUpdateData = {
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(parsed.data.description !== undefined
      ? {
          description: normalizeOptionalDescription(parsed.data.description)
        }
      : {}),
    ...(isRemovingDeadline
      ? { startAt: null, dueAt: null }
      : {
          ...(parsed.data.startAt !== undefined ||
          (parsed.data.hasDeadline === true && !existingTask.startAt)
            ? { startAt: nextStartAt }
            : {}),
          ...(parsed.data.dueAt !== undefined
            ? { dueAt: parsed.data.dueAt }
            : {})
        })
  };

  const updateResult = await prisma.task
    .updateMany({
      where: {
        id: taskId,
        userId: session.user.id
      },
      data: taskUpdateData
    })
    .catch((error) =>
      isUniqueConstraintError(error) ? "duplicate-title" : null
    );

  if (updateResult === "duplicate-title") {
    return jsonError(TASK_ERROR_MESSAGES.duplicateTitle, 409);
  }

  if (!updateResult?.count) {
    return jsonError(TASK_ERROR_MESSAGES.notFound, 404);
  }

  const task = await prisma.task.findUnique({
    where: {
      id: taskId
    }
  });

  return NextResponse.json({ task });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { response, session } = await requireUserSession();

  if (response) {
    return response;
  }

  const taskId = await parseTaskId(context);

  if (!taskId) {
    return jsonError(TASK_ERROR_MESSAGES.idInvalid, 400);
  }

  const prisma = getPrisma();
  const task = await prisma.task
    .deleteMany({
      where: {
        id: taskId,
        userId: session.user.id
      }
    })
    .catch(() => null);

  if (!task?.count) {
    return jsonError(TASK_ERROR_MESSAGES.notFound, 404);
  }

  return NextResponse.json({ ok: true });
}

async function parseTaskId(context: RouteContext) {
  const params = await context.params;
  const parsed = taskIdSchema.safeParse(params.id);

  return parsed.success ? parsed.data : null;
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
