# DDL-Reminder 项目计划

## 概述

DDL-Reminder 是一个可自托管的单用户 Web 应用，用来管理任务和对应的 DDL 时间。用户登录后，可以添加任务、查看所有进行中的任务、查看剩余时间、通过进度条跟踪 DDL 进度、标记任务完成，并在截止时间前后收到邮件提醒。

第一版重点服务个人工作流：足够安全，可以部署到公网；足够简单，便于维护；同时保留未来扩展为多用户系统或更复杂提醒系统的空间。

## 推荐技术栈

- 前端和全栈框架：Next.js App Router + TypeScript
- 样式：Tailwind CSS
- UI 组件：shadcn/ui 或 Radix UI primitives
- 数据库：PostgreSQL
- ORM 和数据库迁移：Prisma
- 输入校验：Zod
- 邮件发送：Nodemailer + SMTP 配置
- 部署：Docker Compose
- 运行服务：
  - `app`：Next.js Web 应用
  - `postgres`：PostgreSQL 数据库
  - `worker`：提醒扫描和邮件发送服务
- 反向代理：Nginx 或 Caddy，用于 HTTPS 和域名转发

## 数据库选择

第一版推荐使用 PostgreSQL。

原因：

- PostgreSQL 很适合处理时间查询、筛选、报表和未来统计功能。
- Prisma 对 PostgreSQL 的支持成熟稳定。
- 使用 Docker Compose 部署时，PostgreSQL 和 MySQL 对这个项目来说运维复杂度接近。
- PostgreSQL 更方便未来扩展标签、重复任务、更复杂的提醒规则、JSON 元数据、归档统计和仪表盘视图。

如果服务器上已经有现成的 MySQL，并且希望复用已有数据库环境，MySQL 也可以作为替代方案。届时主要需要调整 Prisma provider、`DATABASE_URL` 和 Docker Compose 里的数据库服务，大部分业务逻辑可以保持不变。

## 核心功能

### 登录认证

- 单用户密码登录。
- 第一版不开放注册。
- 通过环境变量配置登录密码，例如 `APP_PASSWORD`。
- 登录后使用安全的 HTTP-only cookie session。
- 所有任务页面和任务 API 都必须阻止未登录访问。

### 任务管理

用户可以：

- 创建任务，包含标题、DDL 时间、可选描述、可选开始时间。
- 编辑任务标题、描述、开始时间和 DDL 时间。
- 标记任务完成。
- 删除或归档任务。
- 查看所有进行中任务，默认按 DDL 从近到远排序。

### DDL 看板

主页面需要展示：

- 任务标题。
- 可选描述。
- DDL 时间。
- 剩余时间，显示为天、小时和分钟。
- DDL 进度条。
- 任务状态标签：
  - 正常
  - 临近截止
  - 今天截止
  - 已逾期
  - 已完成

进度计算方式：

```text
progress = (now - startAt) / (dueAt - startAt)
```

展示出来的进度需要限制在 `0%` 到 `100%` 之间。

如果用户没有提供 `startAt`，则使用任务创建时间作为开始时间。

### 邮件提醒

邮件提醒纳入第一版范围。

worker 服务需要：

- 每 5 分钟运行一次。
- 扫描未完成任务。
- 通过 SMTP 发送提醒邮件。
- 将已发送的提醒记录写入 `ReminderLog`。
- 避免同一个任务、同一种提醒类型重复发送。
- 单封邮件发送失败时记录错误，但不停止整个 worker。

初始提醒类型：

- DDL 前 24 小时提醒。
- DDL 前 1 小时提醒。
- 任务逾期后提醒一次。

SMTP 配置通过环境变量提供：

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`
- `MAIL_TO`

## 数据模型

### Task

字段：

- `id`
- `title`
- `description`
- `startAt`
- `dueAt`
- `status`
- `createdAt`
- `updatedAt`

推荐状态：

- `ACTIVE`
- `COMPLETED`
- `ARCHIVED`

UI 中展示的视觉状态，例如已逾期、今天截止，可以根据 `status`、`dueAt` 和当前时间动态计算。

### ReminderLog

字段：

- `id`
- `taskId`
- `reminderType`
- `sentAt`

推荐提醒类型：

- `DUE_IN_24H`
- `DUE_IN_1H`
- `OVERDUE`

需要在 `taskId` 和 `reminderType` 上添加唯一约束，防止重复发送同一种提醒。

### 可选 User 模型

第一版可以不做完整的 `User` 模型，因为应用只面向单用户。如果未来很可能支持多用户，可以提前加入一个简单的 `User` 模型，并让任务关联到一个默认用户。

第一版建议优先采用更简单的单用户方案，除非多用户支持已经是短期需求。

## API 设计

使用 Next.js Route Handlers。

推荐接口：

- `POST /api/login`
- `POST /api/logout`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/:id/complete`
- `POST /api/tasks/:id/archive`

输入校验使用 Zod。

校验规则：

- 任务标题不能为空。
- `dueAt` 必须是有效日期。
- 如果提供 `startAt`，它必须是有效日期。
- `dueAt` 必须晚于 `startAt`。
- 任务描述可选。

## UI 规划

### 页面

- 登录页。
- 主任务看板页。
- 新增/编辑任务界面，可以使用弹窗、抽屉或内联表单。

### 主看板

看板需要以 PC 端 Web 使用体验为主，同时通过响应式布局保证手机端也清晰可用。

推荐区域：

- 顶部栏，包含应用名称和退出登录操作。
- 添加任务入口。
- 进行中任务列表。
- 已完成或已归档任务区域，第一版可选。

每个任务卡片需要展示：

- 标题。
- DDL 时间。
- 剩余时间。
- 进度条。
- 状态标签。
- 编辑操作。
- 完成操作。
- 删除或归档操作。

### 视觉方向

- PC 端 Web 优先，同时适配手机端响应式布局。
- 任务卡片清晰，尺寸稳定。
- 进度条需要容易读取，不能只依赖颜色表达状态。
- 避免过度装饰，整体应该像一个专注的个人工具。

## 部署计划

在服务器上使用 Docker Compose。

服务：

- `app`
  - 运行 Next.js 应用。
  - 使用 Next.js standalone 输出。
  - 依赖 PostgreSQL。
- `worker`
  - 运行提醒 worker 脚本。
  - 使用同一个数据库连接。
  - 使用 SMTP 环境变量。
- `postgres`
  - 存储应用数据。
  - 使用持久化 Docker volume。

生产启动时需要运行：

```bash
prisma migrate deploy
```

推荐部署文件：

- `Dockerfile`
- `compose.yaml`
- `.env.example`
- `README.md`

反向代理：

- 使用 Nginx 或 Caddy。
- 在代理层终止 HTTPS。
- 将请求转发到 Next.js app 容器。

## 环境变量

必需变量：

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

## 实施步骤

1. 初始化 Next.js + TypeScript 项目。
2. 添加 Tailwind CSS、ESLint 和 Prettier。
3. 添加 Prisma 并配置 PostgreSQL。
4. 创建初始 Prisma schema 和 migration。
5. 实现单用户登录和 cookie session。
6. 使用 Zod 校验实现任务 CRUD API。
7. 构建登录页。
8. 构建任务看板页。
9. 构建新增、编辑、完成、归档、删除任务交互。
10. 实现共享的日期和进度计算工具。
11. 实现邮件提醒 worker。
12. 添加 Dockerfile 和 Docker Compose 配置。
13. 添加 `.env.example` 和部署说明。
14. 为核心逻辑和 API 添加测试。
15. 进行本地和 Docker 环境验证。

## 测试计划

### 逻辑测试

- 剩余时间计算。
- 进度百分比计算。
- 进度限制在 `0%` 和 `100%` 之间。
- 今天截止状态。
- 临近截止状态。
- 已逾期状态。
- 已完成任务不应被视为逾期。
- 提醒去重逻辑。

### API 测试

- 未登录用户不能访问任务 API。
- 使用正确密码可以登录。
- 使用错误密码登录失败。
- 创建合法任务成功。
- 标题为空时创建失败。
- 日期无效时创建失败。
- `dueAt <= startAt` 时创建失败。
- 更新任务成功。
- 标记任务完成成功。
- 已完成任务会被提醒 worker 忽略。

### UI 验收测试

- 用户可以登录。
- 用户可以新增任务。
- 用户可以编辑任务。
- 用户可以标记任务完成。
- 用户可以删除或归档任务。
- 刷新页面后任务仍然持久化。
- PC 端可以舒适地浏览和管理多个任务。
- 手机端通过响应式布局清楚展示 DDL 时间、剩余时间和进度。

### 部署测试

- `docker compose up` 可以启动所有服务。
- 应用可以连接 PostgreSQL。
- 生产模式下 migration 可以成功运行。
- 容器重启后数据不丢失。
- worker 可以启动并输出扫描日志。
- SMTP 配置正确时可以成功发送提醒邮件。

## 推荐开发顺序

建议用小的纵向切片推进项目。目标是尽早得到一个可用的个人 DDL 看板，然后再补可靠性、提醒能力和部署加固。

### 阶段 1：项目基础

先搭建项目骨架。

任务：

- 初始化 Next.js + TypeScript 项目。
- 添加 Tailwind CSS。
- 添加 ESLint 和 Prettier。
- 添加 Prisma。
- 添加基础环境变量读取。
- 创建 `.env.example`。
- 创建一个最小首页，确认应用可以本地运行。

完成标准：

- `npm run dev` 可以成功启动。
- 浏览器可以本地打开应用。
- 项目有清晰的初始结构。

### 阶段 2：数据库和领域模型

先创建数据模型，再构建 UI 交互。

任务：

- 在 Prisma 中配置 PostgreSQL。
- 定义 `Task` 和 `ReminderLog` 模型。
- 添加任务状态和提醒类型枚举。
- 创建初始 migration。
- 添加共享的日期和进度计算工具函数。
- 为进度、剩余时间和计算状态添加逻辑测试。

完成标准：

- Prisma 可以连接 PostgreSQL。
- migration 可以成功运行。
- 核心 DDL 计算不依赖 UI 也有测试覆盖。

### 阶段 3：登录认证

在暴露任务 API 前先加登录。

任务：

- 使用 `APP_PASSWORD` 实现单用户密码登录。
- 添加签名的 HTTP-only cookie session。
- 添加退出登录。
- 为受保护页面和 API 添加 middleware 或共享服务端 guard。
- 构建登录页。

完成标准：

- 未登录用户会被重定向到登录页。
- 正确密码可以登录。
- 错误密码会被拒绝。
- 退出登录会清除 session。

### 阶段 4：任务 API

在完整看板 UI 前先实现任务后端。

任务：

- 实现 `GET /api/tasks`。
- 实现 `POST /api/tasks`。
- 实现 `PATCH /api/tasks/:id`。
- 实现完成、归档和删除操作。
- 使用 Zod 校验所有任务输入。
- 确保已完成和已归档任务的处理逻辑一致。

完成标准：

- 已登录用户可以通过 API 创建、读取、更新、完成、归档和删除任务。
- 非法任务输入会返回清晰错误。
- 未登录 API 请求会被阻止。

### 阶段 5：主看板 UI

API 可用后，再构建真正的用户体验。

任务：

- 构建登录后的任务看板。
- 添加任务创建 UI。
- 添加任务编辑 UI。
- 添加任务卡片或表格行。
- 展示 DDL 时间、剩余时间、计算状态和进度条。
- 添加完成、归档和删除操作。
- 先构建 PC 端 Web 布局，再补充手机端响应式适配。

完成标准：

- 用户可以完全通过 Web UI 管理任务。
- 刷新页面后数据仍然持久化。
- DDL 状态和进度展示清晰。
- 页面在 PC 端 Web 上体验舒适，在手机端也保持可用。

### 阶段 6：邮件提醒 Worker

核心应用可用后，再添加提醒系统。

任务：

- 实现 worker 脚本。
- 每 5 分钟扫描未完成的进行中任务。
- 检测 `DUE_IN_24H`、`DUE_IN_1H` 和 `OVERDUE` 提醒窗口。
- 通过 Nodemailer SMTP 发送邮件。
- 将发送成功的提醒写入 `ReminderLog`。
- 使用唯一约束防止重复发送。
- 记录失败日志，但不停止 worker。

完成标准：

- worker 可以找到需要提醒的任务。
- SMTP 配置有效时可以发送提醒邮件。
- 同一任务的同一种提醒不会发送两次。
- 已完成和已归档任务会被忽略。

### 阶段 7：Docker 和自托管部署

本地行为稳定后，再打包到目标服务器。

任务：

- 添加生产环境 `Dockerfile`。
- 添加包含 `app`、`worker` 和 `postgres` 的 `compose.yaml`。
- 添加持久化 PostgreSQL volume。
- 生产启动时运行 `prisma migrate deploy`。
- 记录 Nginx 或 Caddy 反向代理配置方式。
- 记录 PostgreSQL 数据备份预期。

完成标准：

- `docker compose up` 可以启动完整服务。
- 应用可以在 Docker 内连接数据库。
- 容器重启后数据仍然存在。
- worker 可以在 Docker 内运行。

### 阶段 8：最终加固

最后处理安全、可靠性和文档。

任务：

- 检查所有必需环境变量。
- 确保生产环境必须提供 `SESSION_SECRET`。
- 检查 HTTPS 部署下的 cookie 安全设置。
- 添加有用的空状态和错误提示。
- 添加本地开发和服务器部署 README。
- 运行完整测试套件。
- 进行手动端到端检查。

完成标准：

- 新开发者可以按照 README 跑起项目。
- 服务器部署路径清晰。
- 应用可以优雅处理常见异常状态。
- 测试和手动检查通过。

### 推荐里程碑

里程碑 1：完成受登录保护的任务看板，任务可以创建并持久化。这能证明核心产品成立。

里程碑 2：补充编辑、完成、归档/删除，以及更完整的状态和进度展示。这会让应用真正适合日常使用。

里程碑 3：加入邮件 worker。应用从被动追踪工具变成主动提醒系统。

里程碑 4：加入 Docker Compose 部署和文档。应用可以部署到自托管服务器。

## 未来增强

- 任务优先级。
- 标签或分类。
- 搜索和筛选。
- 重复任务。
- 日历视图。
- 浏览器通知。
- 微信、Telegram 或 webhook 提醒。
- 多用户支持。
- 共享任务列表。
- JSON 或 CSV 导入导出。
- 已完成和已逾期任务统计。

## 假设

- 第一版只面向个人使用。
- 应用会部署到自己管理的服务器。
- 因为应用可能暴露在公网，所以仍然需要登录保护。
- PostgreSQL 是默认数据库。
- 邮件提醒属于 v1 范围。
- 浏览器通知和聊天软件提醒不属于 v1 范围。
- 默认时区是 `Asia/Shanghai`。
