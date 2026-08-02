# DDL-Reminder-Android

Android DDL 任务提醒工具。无需登录，所有数据都保存在手机上。

APK 可以在 [Releases](https://github.com/Mark8924/DDL-Reminder-Android/releases) 下载。

## 功能

- 添加、编辑、完成和删除任务
- 截止时间可选，设置时精确到分钟
- 通过日历和时间线查看任务
- 使用 Android 本地通知提醒，手机重启后自动恢复
- 提供精确闹钟、自启动、后台运行和电池优化设置入口
- 支持深浅色主题和自定义壁纸
- 可隐藏最近任务中的应用卡片

## 从源码构建

需要 Node.js 22、JDK 21、Android SDK 36 和 Build Tools 36.0.0。

```bash
npm ci
npm run android:apk
```

APK 会生成在：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

开发网页界面时运行 `npm run dev`；修改完成后可用
`npm run android:sync` 同步到 Android 工程。

## 通知说明

不同厂商对后台运行的限制不同。如果提醒没有按时出现，请在应用的“自启动与后台”页面检查自启动、电池优化和通知权限。这些开关通常只能手动确认。

## 来源

这个 Android 版本最初基于 [Kyy008/DDL-Reminder](https://github.com/Kyy008/DDL-Reminder) 改造，目前在这个仓库单独维护。
