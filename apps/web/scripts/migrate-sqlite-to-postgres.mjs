import { randomBytes, randomUUID, scrypt } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import pg from "pg";

const scryptAsync = promisify(scrypt);
const { Pool } = pg;

const sqliteDatabaseUrl =
  process.env.SQLITE_DATABASE_URL || "file:./data/ddl-reminder.db";
const postgresDatabaseUrl = requiredEnv("DATABASE_URL");
const ownerEmail = requiredEnv("MIGRATION_OWNER_EMAIL").trim().toLowerCase();
const ownerUsername = requiredEnv("MIGRATION_OWNER_USERNAME").trim();
const ownerPassword = requiredEnv("MIGRATION_OWNER_PASSWORD");

if (!ownerUsername) {
  throw new Error("MIGRATION_OWNER_USERNAME is required.");
}

const sqlitePath = resolveSqlitePath(sqliteDatabaseUrl);
const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new Pool({ connectionString: postgresDatabaseUrl });

try {
  const tasks = sqlite
    .prepare('SELECT * FROM "Task" ORDER BY "createdAt"')
    .all();
  const reminderLogs = sqlite
    .prepare('SELECT * FROM "ReminderLog" ORDER BY "sentAt"')
    .all();

  await withTransaction(async (client) => {
    const ownerId = await findOrCreateOwner(client);

    for (const task of tasks) {
      await client.query(
        `
          INSERT INTO "Task"
            ("id", "userId", "title", "description", "startAt", "dueAt", "status", "createdAt", "updatedAt")
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          task.id,
          ownerId,
          task.title,
          task.description,
          task.startAt,
          task.dueAt,
          task.status,
          task.createdAt,
          task.updatedAt
        ]
      );
    }

    for (const reminderLog of reminderLogs) {
      await client.query(
        `
          INSERT INTO "ReminderLog"
            ("id", "taskId", "reminderType", "sentAt")
          VALUES
            ($1, $2, $3, $4)
        `,
        [
          reminderLog.id,
          reminderLog.taskId,
          reminderLog.reminderType,
          reminderLog.sentAt
        ]
      );
    }
  });

  console.log(
    `Migrated ${tasks.length} tasks and ${reminderLogs.length} reminder logs to ${ownerEmail}.`
  );
} finally {
  sqlite.close();
  await pool.end();
}

async function findOrCreateOwner(client) {
  const existingByEmail = await client.query(
    'SELECT "id", "username" FROM "User" WHERE "email" = $1',
    [ownerEmail]
  );

  if (existingByEmail.rows[0]) {
    const owner = existingByEmail.rows[0];

    if (owner.username !== ownerUsername) {
      throw new Error(
        "MIGRATION_OWNER_EMAIL already exists with a different username."
      );
    }

    await client.query(
      'UPDATE "User" SET "emailVerifiedAt" = COALESCE("emailVerifiedAt", NOW()), "updatedAt" = NOW() WHERE "id" = $1',
      [owner.id]
    );

    return owner.id;
  }

  const existingByUsername = await client.query(
    'SELECT "id" FROM "User" WHERE "username" = $1',
    [ownerUsername]
  );

  if (existingByUsername.rows[0]) {
    throw new Error(
      "MIGRATION_OWNER_USERNAME already exists with a different email."
    );
  }

  const ownerId = randomUUID();
  const passwordHash = await hashPassword(ownerPassword);

  await client.query(
    `
      INSERT INTO "User"
        ("id", "username", "email", "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, NOW(), NOW(), NOW())
    `,
    [ownerId, ownerUsername, ownerEmail, passwordHash]
  );

  return ownerId;
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await callback(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const key = await scryptAsync(password, salt, 64);

  return `scrypt$${salt}$${key.toString("base64url")}`;
}

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("SQLITE_DATABASE_URL must use the file: scheme.");
  }

  const rawPath = databaseUrl.slice("file:".length);

  if (!rawPath) {
    throw new Error("SQLITE_DATABASE_URL must include a file path.");
  }

  return path.resolve(rawPath);
}

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
