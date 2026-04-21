WITH duplicate_tasks AS (
  SELECT
    "id",
    "title",
    row_number() OVER (
      PARTITION BY "userId", "title"
      ORDER BY "createdAt", "id"
    ) AS duplicate_rank
  FROM "Task"
)
UPDATE "Task"
SET "title" = duplicate_tasks."title" || ' (' || left(duplicate_tasks."id", 8) || ')'
FROM duplicate_tasks
WHERE "Task"."id" = duplicate_tasks."id"
  AND duplicate_tasks.duplicate_rank > 1;

CREATE UNIQUE INDEX "Task_userId_title_key" ON "Task"("userId", "title");
