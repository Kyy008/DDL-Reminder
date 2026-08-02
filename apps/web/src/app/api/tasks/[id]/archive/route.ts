import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-response";
import { getPrisma } from "@/lib/prisma";
import { requireUserSession } from "@/lib/task-auth";
import { TASK_ERROR_MESSAGES } from "@/lib/task-error-messages";
import { taskIdSchema } from "@/lib/task-validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { response, session } = await requireUserSession();

  if (response) {
    return response;
  }

  const params = await context.params;
  const parsed = taskIdSchema.safeParse(params.id);

  if (!parsed.success) {
    return jsonError(TASK_ERROR_MESSAGES.idInvalid, 400);
  }

  const prisma = getPrisma();
  const updateResult = await prisma.task
    .updateMany({
      where: {
        id: parsed.data,
        userId: session.user.id
      },
      data: {
        status: "ARCHIVED"
      }
    })
    .catch(() => null);

  if (!updateResult?.count) {
    return jsonError(TASK_ERROR_MESSAGES.notFound, 404);
  }

  const task = await prisma.task.findUnique({
    where: {
      id: parsed.data
    }
  });

  return NextResponse.json({ task });
}
