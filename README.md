# DDL-Reminder-Android

一款本地运行的 Android DDL 任务管理与通知提醒应用。项目使用 Next.js 构建界面，通过 Capacitor 打包为原生 Android App；任务、设置和壁纸信息保存在设备本地，不依赖账号、服务器或云数据库。

## 功能

- 创建、编辑、完成和删除任务，并显示临近截止、紧急和已完成状态
- 支持不设置截止时间，以及精确到分钟的日期时间选择
- 任务日历、按日任务详情和近期任务时间线
- 手机横屏时以等宽双栏展示任务日历与竖向近期任务
- Android 本地通知、精确闹钟检测和提醒重建
- 针对荣耀、华为、小米、OPPO/一加/realme、vivo/iQOO、三星、魅族、华硕及 Pixel/AOSP 提供后台运行设置指引
- 自定义壁纸、浅色/深色主题和系统栏配色
- 所有应用数据均保存在本机

## 技术栈

- Next.js 16、React 19、TypeScript
- Tailwind CSS 4
- Capacitor 8
- Android SDK 36、Java 21、Gradle
- Vitest、ESLint、Prettier

## 环境要求

- Node.js 22 或更高版本
- JDK 21
- Android SDK 36 与 Build Tools 36.0.0
- Android Studio（可选，用于调试原生工程）

## 本地开发

```bash
npm ci
npm run dev
```

常用检查：

```bash
npm run lint
npm test
npm run format
npm run build
```

## Android 构建

同步 Web 资源到 Android 工程：

```bash
npm run android:sync
```

在 Android Studio 中打开：

```bash
npm run android:open
```

生成调试 APK：

```bash
npm run android:apk
```

APK 输出位置：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

仓库不包含签名密钥、发布版 APK、本机 SDK 路径或用户数据。正式发布前请自行配置 release signing。

可下载的调试 APK 位于 GitHub Releases。历史 APK 仅作为二进制归档保存；除当前版本外，它们不代表本仓库中存在一一对应的源码快照。

## 通知可靠性

Android 厂商对自启动、后台活动、电池优化和通知样式的设置入口并不统一。App 会识别设备厂商并尽量打开对应页面；厂商自启动开关通常无法由第三方 App 读取，因此这一步仍需用户手动确认。

## 项目结构

```text
src/app/                         页面与交互组件
src/lib/                         本地数据、通知和 Android 桥接封装
android/app/src/main/java/       Capacitor 原生插件与 Android 逻辑
android/app/src/main/res/        Android 图标、启动图和资源
public/                          Web 静态资源
.github/workflows/ci.yml         自动化检查与 Android 构建
```

## 项目关系

本仓库由早期 [Kyy008/DDL-Reminder](https://github.com/Kyy008/DDL-Reminder) 项目沿 Android 本地化方向演进而来，作为独立 Android 仓库维护，不共享原仓库的 Git 提交历史。Android 本地存储、原生通知、厂商后台设置适配、壁纸处理及移动端布局均在本仓库中继续开发。
