# DDL Reminder

DDL Reminder 是同时提供 Web 服务与 Android 本地应用的任务截止时间管理项目。

## 应用

| 应用    | 目录                           | 数据方式                    | 主要维护者                               |
| ------- | ------------------------------ | --------------------------- | ---------------------------------------- |
| Web     | [`apps/web`](apps/web)         | 账号、PostgreSQL 与邮件提醒 | [@Kyy008](https://github.com/Kyy008)     |
| Android | [`apps/android`](apps/android) | 设备本地存储与系统通知      | [@Mark8924](https://github.com/Mark8924) |

两个应用共享产品名称和主要交互，但拥有独立的数据与发布流程。Android 版无需登录，也不会自动同步 Web 端任务。

## Web 开发

```bash
cd apps/web
npm ci
npm run dev
```

部署和环境变量说明见 [`apps/web/DEPLOY.md`](apps/web/DEPLOY.md)。

## Android 开发

```bash
cd apps/android
npm ci
npm run android:apk
```

详细说明见 [`apps/android/README.md`](apps/android/README.md)。APK 通过仓库的 [Releases](https://github.com/Kyy008/DDL-Reminder/releases) 页面发布。

## 自动化

- `Web CI`：检查、测试并构建 Web 应用；`main` 上成功后部署服务器。
- `Android CI`：检查、测试并生成 Android Debug APK 构建产物。
- `Android Release`：推送 `android-v*` 标签时创建带 APK 和 SHA-256 文件的预发布版本。

## 分支约定

- Web：`feature/web-*`、`fix/web-*`
- Android：`feature/android-*`、`fix/android-*`
- 仓库结构与自动化：`feature/repo-*`、`fix/ci-*`

所有改动通过 Pull Request 合并到 `main`。
