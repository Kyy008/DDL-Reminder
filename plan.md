# DDL-Reminder Project Plan

## Summary

DDL-Reminder is a self-hosted single-user web application for managing tasks and their DDL times. After logging in, the user can add tasks, view all active tasks, see remaining time, track DDL progress with progress bars, mark tasks as completed, and receive email reminders before or after deadlines.

The first version focuses on a practical personal workflow: secure enough for public deployment, simple enough to maintain, and structured so it can grow into a multi-user or richer reminder system later.

## Recommended Tech Stack

- Frontend and full-stack framework: Next.js App Router + TypeScript
- Styling: Tailwind CSS
- UI components: shadcn/ui or Radix UI primitives
- Database: PostgreSQL
- ORM and migrations: Prisma
- Validation: Zod
- Email: Nodemailer with SMTP configuration
- Deployment: Docker Compose
- Runtime services:
  - `app`: Next.js web application
  - `postgres`: PostgreSQL database
  - `worker`: reminder scanner and email sender
- Reverse proxy: Nginx or Caddy for HTTPS and domain routing

## Database Choice

Use PostgreSQL for the first version.

Reasons:

- PostgreSQL works very well with time-based queries, filtering, reporting, and future statistics features.
- Prisma support for PostgreSQL is mature and stable.
- With Docker Compose, PostgreSQL and MySQL have similar operational complexity for this project.
- PostgreSQL leaves more room for future features such as tags, recurring tasks, richer reminder rules, JSON metadata, archive statistics, and dashboard views.

MySQL is still a valid alternative if the server already has an existing MySQL setup that should be reused. In that case, the Prisma provider, `DATABASE_URL`, and Docker Compose database service can be changed, while most business logic remains the same.

## Core Features

### Authentication

- Single-user password login.
- No public registration in the first version.
- Configure the login password through an environment variable, for example `APP_PASSWORD`.
- Use a secure HTTP-only cookie session after login.
- Protect all task pages and task APIs from unauthenticated access.

### Task Management

The user can:

- Create a task with title, DDL time, optional description, and optional start time.
- Edit task title, description, start time, and DDL time.
- Mark a task as completed.
- Delete or archive a task.
- View all active tasks sorted by DDL time from nearest to farthest.

### DDL Dashboard

The main page should show:

- Task title.
- Optional description.
- DDL time.
- Remaining time in days, hours, and minutes.
- DDL progress bar.
- Task status label:
  - Normal
  - Approaching
  - Due today
  - Overdue
  - Completed

Progress calculation:

```text
progress = (now - startAt) / (dueAt - startAt)
```

The displayed progress should be clamped between `0%` and `100%`.

If the user does not provide `startAt`, use the task creation time as the start time.

### Email Reminders

Email reminders are included in the first version.

The worker service should:

- Run every 5 minutes.
- Scan incomplete tasks.
- Send reminder emails through SMTP.
- Write reminder send records into `ReminderLog`.
- Avoid duplicate reminders for the same task and reminder type.
- Continue running if one email fails, while logging the failure.

Initial reminder types:

- 24 hours before DDL.
- 1 hour before DDL.
- Once after the task becomes overdue.

SMTP configuration should be provided through environment variables:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`
- `MAIL_TO`

## Data Model

### Task

Fields:

- `id`
- `title`
- `description`
- `startAt`
- `dueAt`
- `status`
- `createdAt`
- `updatedAt`

Recommended statuses:

- `ACTIVE`
- `COMPLETED`
- `ARCHIVED`

The visual status shown in the UI, such as overdue or due today, can be computed from `status`, `dueAt`, and the current time.

### ReminderLog

Fields:

- `id`
- `taskId`
- `reminderType`
- `sentAt`

Recommended reminder types:

- `DUE_IN_24H`
- `DUE_IN_1H`
- `OVERDUE`

Add a unique constraint on `taskId` and `reminderType` to prevent duplicate reminders.

### Optional User Model

The first version can skip a full `User` model because it is single-user only. If future multi-user support is likely, add a simple `User` model early and associate tasks with a single default user.

For the first implementation, prefer the simpler single-user version unless multi-user support becomes a near-term requirement.

## API Design

Use Next.js Route Handlers.

Recommended endpoints:

- `POST /api/login`
- `POST /api/logout`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/:id/complete`
- `POST /api/tasks/:id/archive`

Input validation should use Zod.

Validation rules:

- Task title cannot be empty.
- `dueAt` must be a valid date.
- `startAt`, if provided, must be a valid date.
- `dueAt` must be later than `startAt`.
- Task description is optional.

## UI Plan

### Pages

- Login page.
- Main task dashboard page.
- Add/edit task UI, either as a dialog, drawer, or inline form.

### Main Dashboard

The dashboard should prioritize the PC web experience first, while keeping a responsive layout that remains clear and usable on phones.

Recommended sections:

- Header with app name and logout action.
- Add task action.
- Active task list.
- Completed or archived task section, optional in v1.

Each task card should show:

- Title.
- DDL time.
- Remaining time.
- Progress bar.
- Status label.
- Edit action.
- Complete action.
- Delete or archive action.

### Visual Direction

- PC web-first layout, with responsive support for phone screens.
- Clear task cards with stable dimensions.
- Progress bars should be readable and not depend only on color.
- Avoid decorative complexity; the page should feel like a focused personal tool.

## Deployment Plan

Use Docker Compose on the server.

Services:

- `app`
  - Runs the Next.js application.
  - Uses Next.js standalone output.
  - Depends on PostgreSQL.
- `worker`
  - Runs the reminder worker script.
  - Uses the same database connection.
  - Uses SMTP environment variables.
- `postgres`
  - Stores application data.
  - Uses a persistent Docker volume.

Production startup should run:

```bash
prisma migrate deploy
```

Recommended deployment files:

- `Dockerfile`
- `compose.yaml`
- `.env.example`
- `README.md`

Reverse proxy:

- Use Nginx or Caddy.
- Terminate HTTPS at the proxy.
- Forward requests to the Next.js app container.

## Environment Variables

Required variables:

```env
DATABASE_URL=postgresql://ddl_reminder:ddl_reminder_password@postgres:5432/ddl_reminder
APP_PASSWORD=change-me
SESSION_SECRET=change-me-to-a-long-random-string
APP_URL=https://your-domain.example
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
MAIL_FROM=DDL Reminder <reminder@example.com>
MAIL_TO=you@example.com
TZ=Asia/Shanghai
```

## Implementation Steps

1. Initialize a Next.js + TypeScript project.
2. Add Tailwind CSS, ESLint, and Prettier.
3. Add Prisma and configure PostgreSQL.
4. Create the initial Prisma schema and migration.
5. Implement single-user login and cookie session handling.
6. Implement task CRUD APIs with Zod validation.
7. Build the login page.
8. Build the task dashboard page.
9. Build add/edit/complete/archive/delete task interactions.
10. Implement shared date and progress calculation utilities.
11. Implement the email reminder worker.
12. Add Dockerfile and Docker Compose configuration.
13. Add `.env.example` and deployment instructions.
14. Add tests for core logic and APIs.
15. Run local and Docker-based verification.

## Test Plan

### Logic Tests

- Remaining time calculation.
- Progress percentage calculation.
- Progress clamping to `0%` and `100%`.
- Due today status.
- Approaching status.
- Overdue status.
- Completed tasks should not be treated as overdue.
- Reminder deduplication logic.

### API Tests

- Unauthenticated users cannot access task APIs.
- Login succeeds with the correct password.
- Login fails with an incorrect password.
- Creating a valid task succeeds.
- Creating a task with an empty title fails.
- Creating a task with invalid dates fails.
- Creating a task where `dueAt <= startAt` fails.
- Updating a task works.
- Marking a task completed works.
- Completed tasks are ignored by the reminder worker.

### UI Acceptance Tests

- User can log in.
- User can add a task.
- User can edit a task.
- User can mark a task completed.
- User can delete or archive a task.
- Refreshing the page keeps tasks persisted.
- PC layout can scan and manage multiple tasks comfortably.
- Phone layout remains responsive and clearly shows DDL time, remaining time, and progress.

### Deployment Tests

- `docker compose up` starts all services.
- App can connect to PostgreSQL.
- Migrations run successfully in production mode.
- Data remains after container restart.
- Worker starts and logs scan activity.
- SMTP configuration sends a reminder email successfully.

## Recommended Development Order

Implement the project in small vertical slices. The goal is to get a working personal DDL dashboard as early as possible, then add reliability, reminders, and deployment hardening.

### Phase 1: Project Foundation

Set up the project skeleton first.

Tasks:

- Initialize the Next.js + TypeScript project.
- Add Tailwind CSS.
- Add ESLint and Prettier.
- Add Prisma.
- Add basic environment variable loading.
- Create `.env.example`.
- Create a minimal homepage to confirm the app runs locally.

Exit criteria:

- `npm run dev` starts successfully.
- The browser can open the app locally.
- The project has a clean initial structure.

### Phase 2: Database and Domain Model

Create the database model before building UI interactions.

Tasks:

- Configure PostgreSQL in Prisma.
- Define `Task` and `ReminderLog` models.
- Add task status and reminder type enums.
- Create the initial migration.
- Add shared date/progress utility functions.
- Add logic tests for progress, remaining time, and computed status.

Exit criteria:

- Prisma can connect to PostgreSQL.
- Migration runs successfully.
- Core DDL calculations are tested without needing the UI.

### Phase 3: Authentication

Add login before exposing task APIs.

Tasks:

- Implement single-user password login using `APP_PASSWORD`.
- Add signed HTTP-only cookie session.
- Add logout.
- Add middleware or shared server-side guard for protected pages and APIs.
- Build the login page.

Exit criteria:

- Unauthenticated users are redirected to login.
- Correct password logs in successfully.
- Incorrect password is rejected.
- Logout clears the session.

### Phase 4: Task API

Build the task backend before the full dashboard UI.

Tasks:

- Implement `GET /api/tasks`.
- Implement `POST /api/tasks`.
- Implement `PATCH /api/tasks/:id`.
- Implement completion, archive, and delete actions.
- Validate all task inputs with Zod.
- Ensure completed and archived tasks are handled consistently.

Exit criteria:

- A logged-in user can create, read, update, complete, archive, and delete tasks through APIs.
- Invalid task input returns clear errors.
- Unauthenticated API requests are blocked.

### Phase 5: Main Dashboard UI

Build the real user experience once the API works.

Tasks:

- Build the authenticated task dashboard.
- Add task creation UI.
- Add task editing UI.
- Add task cards or table rows.
- Show DDL time, remaining time, computed status, and progress bar.
- Add complete, archive, and delete actions.
- Build the PC web layout first, then add responsive adaptations for phone screens.

Exit criteria:

- The user can manage tasks entirely from the web UI.
- Refreshing the page keeps data persisted.
- DDL status and progress are visually clear.
- The page works comfortably on PC web and remains usable on phone screens.

### Phase 6: Email Reminder Worker

Add the reminder system after the core app is usable.

Tasks:

- Implement the worker script.
- Scan incomplete active tasks every 5 minutes.
- Detect `DUE_IN_24H`, `DUE_IN_1H`, and `OVERDUE` reminder windows.
- Send email through Nodemailer SMTP.
- Write successful sends to `ReminderLog`.
- Use a unique constraint to prevent duplicates.
- Log failures without stopping the worker.

Exit criteria:

- The worker can find reminder candidates.
- A reminder email can be sent with valid SMTP settings.
- The same reminder type is not sent twice for the same task.
- Completed and archived tasks are ignored.

### Phase 7: Docker and Self-Hosted Deployment

Package the app for the target server after local behavior is stable.

Tasks:

- Add a production `Dockerfile`.
- Add `compose.yaml` with `app`, `worker`, and `postgres`.
- Add a persistent PostgreSQL volume.
- Run `prisma migrate deploy` during production startup.
- Document reverse proxy setup for Nginx or Caddy.
- Document backup expectations for PostgreSQL data.

Exit criteria:

- `docker compose up` starts the full stack.
- The app can connect to the database inside Docker.
- Data survives container restarts.
- The worker runs inside Docker.

### Phase 8: Final Hardening

Polish security, reliability, and documentation last.

Tasks:

- Review required environment variables.
- Ensure `SESSION_SECRET` is required in production.
- Check cookie security settings for HTTPS deployment.
- Add useful empty states and error messages.
- Add README instructions for local development and server deployment.
- Run the full test suite.
- Perform a manual end-to-end check.

Exit criteria:

- A fresh developer can follow the README to run the project.
- A server deployment has a clear path.
- The app handles common invalid states gracefully.
- Tests and manual checks pass.

### Recommended Milestones

Milestone 1 should be a login-protected dashboard where tasks can be created and persisted. This proves the core product.

Milestone 2 should add editing, completion, archive/delete, and polished status/progress display. This makes it genuinely useful day to day.

Milestone 3 should add the email worker. This turns the app from a passive tracker into an active reminder system.

Milestone 4 should add Docker Compose deployment and documentation. This makes it ready for the self-hosted server.

## Future Enhancements

- Task priority.
- Tags or categories.
- Search and filters.
- Recurring tasks.
- Calendar view.
- Browser notifications.
- WeChat, Telegram, or webhook reminders.
- Multi-user support.
- Shared task lists.
- Import/export as JSON or CSV.
- Statistics for completed and overdue tasks.

## Assumptions

- The first version is for personal use only.
- The app will be deployed to a self-managed server.
- The app should still require login because it may be exposed to the public internet.
- PostgreSQL is the default database.
- Email reminders are part of v1.
- Browser notifications and chat app reminders are out of scope for v1.
- Default timezone is `Asia/Shanghai`.
