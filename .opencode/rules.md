# DDL-Reminder 项目开发规范

## 项目信息

- **项目名称**: DDL-Reminder (DDL = Deadline)
- **作者 ID**: NAPH130
- **技术栈**: Next.js 16 (App Router) + TypeScript 6 (strict) + Tailwind CSS 4 + Prisma 7 + PostgreSQL
- **运行时**: Node.js 22
- **测试框架**: Vitest
- **代码检查**: ESLint (eslint-config-next) + Prettier

---

## Git 规范

### 分支管理

| 分支 | 用途 | 说明 |
|------|------|------|
| `main` | 生产环境 | 仅通过 PR 合并，禁止直接推送 |
| `dev` | 开发主线 | 所有功能分支从此分支创建，合并回此分支 |

- 功能分支命名: `feat/<功能简述>` (如 `feat/add-dark-mode`)
- 修复分支命名: `fix/<问题简述>` (如 `fix/login-error`)
- 重构分支命名: `refactor/<重构内容>` (如 `refactor/auth-module`)
- 所有分支从 `dev` 创建，完成后通过 PR 合并回 `dev`

### 提交规范

严格遵循 **Conventional Commits** 格式:

```
<type>(<scope>): <message>
```

允许的类型:
- `feat`: 新功能
- `fix`: 问题修复
- `refactor`: 代码重构（不改变功能）
- `style`: 样式/UI 调整
- `chore`: 构建/工具/依赖变更
- `build`: 构建系统变更
- `docs`: 文档变更
- `test`: 测试相关

提交信息使用 **中文** 编写。

示例:
```
feat(task): 添加任务批量删除功能
fix(auth): 修复登录态过期未跳转的问题
refactor(task): 提取任务验证逻辑到独立模块
style(ui): 调整移动端导航栏间距
```

### PR 规范

- PR 标题遵循 Conventional Commits 格式
- PR 描述需包含变更摘要和测试说明
- 所有 PR 必须通过 CI（lint + test + build）后方可合并
- 使用 Squash Merge 合并到 `dev`

---

## 代码规范

### TypeScript

- 严格模式启用 (`strict: true`)
- 路径别名: `@/` -> `./src/*`
- 禁止使用 `any`，必须显式声明类型
- 使用 Zod 进行运行时数据验证

### Prettier

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "none"
}
```

- 强制分号
- 使用双引号
- 不使用尾随逗号

### ESLint

- 使用 `eslint-config-next` 的 `core-web-vitals` 和 `typescript` 规则预设
- 禁止引入未使用的变量
- 禁止引入未使用的模块

### 命名规范

- **组件文件**: `kebab-case` (如 `task-dashboard.tsx`, `logout-button.tsx`)
- **工具模块**: `kebab-case` (如 `auth-session.ts`, `task-validation.ts`)
- **API 路由**: Next.js App Router 默认的 `route.ts` / `page.tsx`
- **类型/接口**: `PascalCase`
- **变量/函数**: `camelCase`
- **常量**: `UPPER_SNAKE_CASE` 或 `camelCase`（遵循现有代码风格）

### 项目结构

```
src/
  app/           # Next.js App Router 页面和 API 路由
    page.tsx     # 首页
    layout.tsx   # 根布局
    globals.css  # 全局样式
    api/         # API 路由（auth, tasks, settings）
    login/       # 登录页
    register/    # 注册页
    manage/      # 任务管理页
    auth/        # 认证相关页面
  lib/           # 共享工具库
    *.ts         # 业务逻辑模块
    *.test.ts    # 对应模块的测试文件（同目录存放）
```

### 代码组织

- API 逻辑集中在 `src/lib/` 下的工具模块中，API 路由仅做调度
- 使用 `api-response.ts` 中的标准化响应格式（`jsonOk`, `jsonError`, `jsonServerError`）
- 错误消息集中管理在 `*-error-messages.ts` 或 `*-errors.ts` 中
- 数据库操作均通过 Prisma 进行，不直接写 SQL

---

## 环境变量

开发所需环境变量见 `.env.example`:

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `SESSION_SECRET` | 会话加密密钥 |
| `APP_URL` | 应用公网地址 |
| `SMTP_HOST` / `SMTP_PORT` / ... | 邮件服务配置 |
| `MAIL_FROM` | 发件人地址 |
| `TZ` | 时区（默认 Asia/Shanghai） |

---

## 常用命令

```bash
npm run dev           # 启动开发服务器
npm run build         # 生产构建
npm run lint          # 代码检查
npm test              # 运行测试
npm run test:watch    # 监听模式测试
npm run format        # 格式检查
npm run format:write  # 自动格式化
npm run db:migrate    # 数据库迁移
```
