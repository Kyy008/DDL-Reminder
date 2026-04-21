import { z } from "zod";
import { TASK_ERROR_MESSAGES } from "./task-error-messages";

export const taskIdSchema = z.string().min(1, TASK_ERROR_MESSAGES.idInvalid);

const optionalDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.date({ error: TASK_ERROR_MESSAGES.dateInvalid }).optional()
);

const updateTaskFieldsSchema = z.object({
  title: z.string().trim().min(1, TASK_ERROR_MESSAGES.titleRequired),
  description: z.string().trim().optional(),
  hasDeadline: z.boolean().optional(),
  startAt: optionalDateSchema,
  dueAt: optionalDateSchema
});

export const createTaskSchema = updateTaskFieldsSchema.superRefine(
  (data, context) => {
    if (data.hasDeadline === false) {
      return;
    }

    if (!data.dueAt) {
      context.addIssue({
        code: "custom",
        message: TASK_ERROR_MESSAGES.dateInvalid,
        path: ["dueAt"]
      });
      return;
    }

    const startAt = data.startAt ?? new Date();

    if (data.dueAt.getTime() <= startAt.getTime()) {
      context.addIssue({
        code: "custom",
        message: TASK_ERROR_MESSAGES.dateRangeInvalid,
        path: ["dueAt"]
      });
    }
  }
);

export const updateTaskSchema = updateTaskFieldsSchema
  .partial()
  .superRefine((data, context) => {
    if (data.hasDeadline === false) {
      return;
    }

    if (
      data.startAt &&
      data.dueAt &&
      data.dueAt.getTime() <= data.startAt.getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: TASK_ERROR_MESSAGES.dateRangeInvalid,
        path: ["dueAt"]
      });
    }
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export function normalizeOptionalDescription(description: string | undefined) {
  return description && description.length > 0 ? description : null;
}

export function isValidTaskDateRange(startAt: Date, dueAt: Date) {
  return dueAt.getTime() > startAt.getTime();
}
