# DDL Reminder 移动端

这是 DDL Reminder 的 Android 和 iOS 应用。无需登录，任务和设置都保存在当前设备上，不会自动同步到 Web 版。

Android APK 可以在主仓库的 [Releases](https://github.com/Kyy008/DDL-Reminder/releases) 页面下载。iOS 版目前从源码构建并通过 Xcode 安装到自己的设备。

## 可以做什么

- 添加、编辑、完成和删除任务
- 截止时间可以留空，也可以精确设置到分钟
- 通过日历和时间线查看任务
- 使用系统本地通知提醒
- 支持深浅色主题和自定义壁纸

Android 版另外提供精确闹钟、自启动、后台运行和电池优化设置入口，也可以隐藏系统最近任务中的应用卡片。iOS 版遵循系统的通知与后台规则，不显示这些 Android 专属选项。

## 准备开发环境

两端都需要 Node.js 22。

- Android：JDK 21、Android SDK 36、Build Tools 36.0.0
- iOS：macOS 与 Xcode；最低系统版本为 iOS 15.4

iOS 原生依赖由 Swift Package Manager 管理，不需要安装 CocoaPods。

先安装 JavaScript 依赖并运行公共检查：

```bash
cd apps/mobile
npm ci
npm run lint
npm test
```

## Android

生成 Debug APK：

```bash
npm run android:apk
```

APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。只需要把网页资源同步到原生工程时运行 `npm run android:sync`；需要在 Android Studio 中调试时运行 `npm run android:open`。

Android 正式版由 GitHub Actions 使用仓库密钥签名。向 `main` 上的提交推送 `android-v*` 标签后，流水线会完成测试、签名校验并发布 APK。签名私钥不得提交到仓库。

## iOS

构建无签名的模拟器版本：

```bash
npm run ios:build
```

这个命令会构建公共网页资源、同步 Capacitor iOS 工程，再使用 Xcode 完成通用 iOS Simulator 构建。只同步资源时运行 `npm run ios:sync`。

在模拟器或真机上调试时打开 Xcode：

```bash
npm run ios:open
```

这个命令会先重新构建并同步网页资源，再打开 Xcode，避免原生工程里残留旧页面。

第一次安装到 iPhone 或 iPad 时，需要在 Xcode 的 `Signing & Capabilities` 中选择自己的开发团队，然后选择已连接的设备运行。证书和描述文件由本机 Xcode 管理，不需要提交到仓库。

## 通知没有出现时

先确认系统通知权限没有关闭。Android 厂商还可能限制后台运行，请在应用的“自启动与后台”页面检查自启动、电池优化和通知权限；这些开关通常需要手动确认。iOS 的通知送达与后台行为由系统统一管理。

## 项目关系

移动端由 [@Mark8924](https://github.com/Mark8924) 基于 DDL Reminder Web 版改造，与 Web 端共同维护在 [Kyy008/DDL-Reminder](https://github.com/Kyy008/DDL-Reminder) 仓库中。Android 和 iOS 共用 `apps/mobile` 中的 React 代码，各自保留独立的原生工程。
