import {
  DEFAULT_APPROACHING_THRESHOLD_MS,
  DEFAULT_URGENT_THRESHOLD_MS,
  ReminderTypeLike,
  shouldSendReminder
} from "./deadline";
import { sendTaskDeadlineReminderEmail } from "./mailer";
import { getPrisma } from "./prisma";
import { ReminderTypeValue } from "./task-constants";

type TaskReminderClient = {
  user: {
    findUnique: (args: {
      where: {
        id: string;
      };
      select: {
        emailReminderEnabled: true;
        approachingReminderMinutes: true;
        urgentReminderMinutes: true;
      };
    }) => Promise<{
      emailReminderEnabled: boolean;
      approachingReminderMinutes: number;
      urgentReminderMinutes: number;
    } | null>;
  };
  task: {
    findMany: (args: {
      where: {
        userId: string;
        status: "ACTIVE";
        dueAt: {
          gte: Date;
        };
      };
      select: {
        id: true;
        title: true;
        dueAt: true;
        createdAt: true;
        status: true;
        user: {
          select: {
            email: true;
            username: true;
          };
        };
        reminderLogs: {
          select: {
            reminderType: true;
          };
        };
      };
    }) => Promise<ReminderTask[]>;
  };
  reminderLog: {
    create: (args: {
      data: {
        taskId: string;
        reminderType: ReminderTypeValue;
        sentAt: Date;
      };
    }) => Promise<unknown>;
    deleteMany: (args: {
      where: {
        taskId: string;
        reminderType: ReminderTypeValue;
      };
    }) => Promise<unknown>;
  };
};

type ReminderTask = {
  id: string;
  title: string;
  dueAt: Date | null;
  createdAt: Date;
  status: string;
  user: {
    email: string;
    username: string;
  };
  reminderLogs: Array<{
    reminderType: string;
  }>;
};

type PendingReminderInput = {
  approachingThresholdMs?: number;
  createdAt: Date;
  dueAt: Date | null;
  now?: Date;
  sentReminderTypes: Iterable<string>;
  status: string;
  urgentThresholdMs?: number;
};

export async function sendDueTaskRemindersForUser({
  now = new Date(),
  prisma = getPrisma(),
  userId
}: {
  now?: Date;
  prisma?: TaskReminderClient;
  userId: string;
}) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId
    },
    select: {
      emailReminderEnabled: true,
      approachingReminderMinutes: true,
      urgentReminderMinutes: true
    }
  });

  if (!user?.emailReminderEnabled) {
    return;
  }

  const approachingThresholdMs = user.approachingReminderMinutes * 60 * 1000;
  const urgentThresholdMs = user.urgentReminderMinutes * 60 * 1000;

  const tasks = (await prisma.task.findMany({
    where: {
      userId,
      status: "ACTIVE",
      dueAt: {
        gte: now
      }
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      createdAt: true,
      status: true,
      user: {
        select: {
          email: true,
          username: true
        }
      },
      reminderLogs: {
        select: {
          reminderType: true
        }
      }
    }
  })) as ReminderTask[];

  for (const task of tasks) {
    const reminderType = getPendingDeadlineReminderType({
      approachingThresholdMs,
      createdAt: task.createdAt,
      dueAt: task.dueAt,
      now,
      sentReminderTypes: task.reminderLogs.map((log) => log.reminderType),
      status: task.status,
      urgentThresholdMs
    });

    if (!reminderType || !task.dueAt) {
      continue;
    }

    const reserved = await reserveReminderLog(prisma, {
      now,
      reminderType,
      taskId: task.id
    });

    if (!reserved) {
      continue;
    }

    try {
      await sendTaskDeadlineReminderEmail({
        dueAt: task.dueAt,
        email: task.user.email,
        reminderType,
        taskTitle: task.title,
        username: task.user.username
      });
    } catch (error) {
      await releaseReminderLog(prisma, {
        reminderType,
        taskId: task.id
      });
      console.error("Failed to send task deadline reminder.", error);
    }
  }
}

export function getPendingDeadlineReminderType({
  approachingThresholdMs = DEFAULT_APPROACHING_THRESHOLD_MS,
  createdAt,
  dueAt,
  now = new Date(),
  sentReminderTypes,
  status,
  urgentThresholdMs = DEFAULT_URGENT_THRESHOLD_MS
}: PendingReminderInput): ReminderTypeValue | null {
  if (status !== "ACTIVE" || !dueAt) {
    return null;
  }

  const remainingMs = dueAt.getTime() - now.getTime();

  if (remainingMs < 0) {
    return null;
  }

  const initialRemainingMs = dueAt.getTime() - createdAt.getTime();
  const normalizedSentReminderTypes = Array.from(
    sentReminderTypes
  ) as ReminderTypeLike[];

  if (
    remainingMs < urgentThresholdMs &&
    initialRemainingMs >= urgentThresholdMs &&
    shouldSendReminder(normalizedSentReminderTypes, "DUE_IN_2H")
  ) {
    return "DUE_IN_2H";
  }

  if (
    remainingMs < approachingThresholdMs &&
    remainingMs >= urgentThresholdMs &&
    initialRemainingMs >= approachingThresholdMs &&
    shouldSendReminder(normalizedSentReminderTypes, "DUE_IN_48H")
  ) {
    return "DUE_IN_48H";
  }

  return null;
}

async function reserveReminderLog(
  prisma: TaskReminderClient,
  {
    now,
    reminderType,
    taskId
  }: {
    now: Date;
    reminderType: ReminderTypeValue;
    taskId: string;
  }
) {
  return prisma.reminderLog
    .create({
      data: {
        taskId,
        reminderType,
        sentAt: now
      }
    })
    .then(() => true)
    .catch((error) =>
      isUniqueConstraintError(error) ? false : Promise.reject(error)
    );
}

async function releaseReminderLog(
  prisma: TaskReminderClient,
  {
    reminderType,
    taskId
  }: {
    reminderType: ReminderTypeValue;
    taskId: string;
  }
) {
  await prisma.reminderLog.deleteMany({
    where: {
      taskId,
      reminderType
    }
  });
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
