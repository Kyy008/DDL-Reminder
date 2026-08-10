# DDL Reminder

DDL Reminder 是一个任务截止时间管理项目，包含 Web 版和使用本地数据的 Android、iOS 应用。

## 应用

| 应用          | 目录                           | 数据方式                    | 主要维护者                               |
| ------------- | ------------------------------ | --------------------------- | ---------------------------------------- |
| Web           | [`apps/web`](apps/web)         | 账号、PostgreSQL 与邮件提醒 | [@Kyy008](https://github.com/Kyy008)     |
| Android / iOS | [`apps/mobile`](apps/mobile)   | 设备本地存储与系统通知      | [@Mark8924](https://github.com/Mark8924) |

Web 版和移动端共用产品名称与主要交互，但数据和发布流程彼此独立。移动端无需登录，也不会自动同步 Web 端任务；Android 与 iOS 共用 React 页面，各自保留原生工程。

## Web

```bash
cd apps/web
npm ci
npm run dev
```

部署和环境变量说明见 [`apps/web/DEPLOY.md`](apps/web/DEPLOY.md)。

## 移动端

```bash
cd apps/mobile
npm ci
```

```bash
# 构建 Android Debug APK
npm run android:apk

# 在 macOS 上构建无签名的 iOS 模拟器版本
npm run ios:build
```

环境要求、真机运行和通知设置见 [`apps/mobile/README.md`](apps/mobile/README.md)。Android APK 通过仓库的 [Releases](https://github.com/Kyy008/DDL-Reminder/releases) 页面发布。

## 自动检查与发布

- `Web CI`：检查、测试并构建 Web 应用；`main` 上成功后部署服务器。
- `Android CI`：检查、测试并生成 Android Debug APK。
- `iOS CI`：检查、测试并完成无签名的 iOS 模拟器构建。
- `Android Release`：推送 `android-v*` 标签时创建带签名 APK 的正式版本。

## 分支约定

- Web：`feature/web-*`、`fix/web-*`
- 移动端：`feature/mobile-*`、`fix/mobile-*`
- 仓库结构与自动化：`feature/repo-*`、`fix/ci-*`

所有改动通过 Pull Request 合并到 `main`。
