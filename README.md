# DDL-Reminder-Android

这是一个给 Android 用的 DDL 任务提醒 App。任务、设置和壁纸都只保存在手机里，不需要登录，也不依赖服务器或云数据库。

## 现在能做什么

- 创建、编辑、完成和删除任务，并区分临近截止、紧急和已完成状态
- 截止时间可以不填，也可以精确设置到某一分钟
- 用日历查看每天的任务，也可以在时间线里查看近期任务
- 使用 Android 本地通知提醒任务，并在手机重启后重新安排提醒
- 检查精确闹钟权限，并根据手机品牌给出自启动、后台运行和电池优化设置指引
- 更换背景壁纸，切换浅色或深色主题，并让系统栏颜色跟随界面
- 可以隐藏系统最近任务里的 App 卡片，不影响任务提醒

## 它是怎么做的

界面使用 Next.js 16、React 19、TypeScript 和 Tailwind CSS 4，之后通过 Capacitor 8 打包成 Android App。通知、闹钟、厂商设置入口和壁纸处理等功能由 Android 原生代码完成。

Android 工程目前使用 SDK 36、Build Tools 36.0.0 和 JDK 21。项目里的测试与代码检查使用 Vitest、ESLint 和 Prettier。

## 想在电脑上跑起来

先准备好 Node.js 22 或更高版本。只看网页界面时，运行：

```bash
npm ci
npm run dev
```

平时可以用下面这些命令检查代码：

```bash
npm run lint
npm test
npm run format
npm run build
```

如果要编译 Android App，还需要 JDK 21、Android SDK 36 和 Build Tools 36.0.0。Android Studio 不是必需的，但调试原生工程时会方便一些。

## 打包 Android App

把最新的网页资源同步到 Android 工程：

```bash
npm run android:sync
```

用 Android Studio 打开原生工程：

```bash
npm run android:open
```

直接生成调试 APK：

```bash
npm run android:apk
```

生成的文件在：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

仓库里不会提交签名密钥、本机 SDK 路径、用户数据或编译出来的 APK。要发布正式版本，需要自己配置 release signing。

想直接安装的话，可以去 GitHub Releases 下载已经测试过的调试 APK。里面也保留了几个旧版本方便存档，但只有当前版本能和仓库里的源码一一对应。

## 关于通知

不同品牌的 Android 手机会把自启动、后台活动、电池优化和通知设置放在不同位置。App 会识别手机品牌，并尽量打开对应的设置页面。不过，第三方 App 通常读不到厂商的自启动开关，所以这一步仍然需要自己确认。

## 目录大概这样

```text
src/app/                         页面与交互组件
src/lib/                         本地数据、通知和 Android 桥接封装
android/app/src/main/java/       Capacitor 原生插件与 Android 逻辑
android/app/src/main/res/        Android 图标、启动图和资源
public/                          Web 静态资源
.github/workflows/ci.yml         GitHub Actions 检查与 Android 构建
```

## 关于这个仓库

这个项目一开始是在 [Kyy008/DDL-Reminder](https://github.com/Kyy008/DDL-Reminder) 的基础上做的，后来逐渐改成了纯本地的 Android App。现在这个仓库单独维护，也没有沿用原仓库的 Git 提交历史。Android 本地存储、原生通知、不同品牌手机的后台设置、壁纸和移动端布局等功能，都是在这里继续做的。
