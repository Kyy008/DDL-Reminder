# DDL Reminder Android

Android DDL 任务提醒工具。无需登录，任务保存在手机上，不与 Web 端自动同步。

APK 可以在主仓库的 [Releases](https://github.com/Kyy008/DDL-Reminder/releases) 下载。

## 功能

- 添加、编辑、完成和删除任务
- 截止时间可选，设置时精确到分钟
- 通过日历和时间线查看任务
- 使用 Android 本地通知提醒，手机重启后自动恢复
- 提供精确闹钟、自启动、后台运行和电池优化设置入口
- 支持深浅色主题和自定义壁纸
- 可隐藏最近任务中的应用卡片
- 可在主界面打开对话助手，聊天、查询任务或标记完成；改动任务前先展示确认卡片，确认后才执行
- 导出包含任务、设置、壁纸和已保存对话的 ZIP 备份，不包含 API 密钥

## 对话助手

对话助手默认关闭，可在设置里开启。开启后，仅在“查看任务”主界面右下角显示
“聊聊任务”；日历、添加任务和设置页不显示入口。默认使用 DeepSeek V4.1 Flash，
思考强度为 High，也可以在设置里选 Off、Low 或 Max。普通聊天和查询不会弹确认；
修改会列出修改前后内容，新增、删除和标记完成也必须点确认才会执行。
任务标记完成后会保留在已完成列表中，不再安排该任务的后续提醒。

公开版不带 API 密钥，请在设置里填写自己的 DeepSeek 密钥。只有发消息后才会联网；
消息和助手按需查询到的任务会发送至 DeepSeek。密钥在 Android Keystore 保护下
加密保存在本机，不会显示在对话中，也不随备份导出。

每次正常打开聊天都会开始新对话，空对话随机显示两条预选问题。历史对话保存在本机，
可在设置中查看、继续聊或单独删除。删除会再确认一次，不会影响任务。
助手回复支持 Markdown 表格、粗体、斜体、列表、代码和 LaTeX 公式；宽表格和长公式可横向滚动。
普通对话会带上原来的上下文；很长时只向模型发送近期的完整轮次，
更早的记录仍保留在历史中，不会因此删除。
清空只删除当前对话，不会删除任务或其他对话。备份通过系统文件选择器保存，附带 SHA-256
校验和；目前只提供导出，暂未提供一键导入。

如果自己构建仅供私用的预置密钥版本，可以在设置 `DEEPSEEK_API_KEY` 后运行
`npm run android:private`。也可以用 `npm run android:private -- --from-zshrc`，
读取本机 `.zshrc` 中唯一的字面量密钥配置（不会执行该文件）。
这种 APK 里的密钥可以被提取，**不要上传或分发私用 APK**。普通构建不读取这项密钥，
公开 CI 也禁止私用构建。

## 从源码构建

需要 Node.js 22、JDK 21、Android SDK 36 和 Build Tools 36.0.0。

先进入 Android 应用目录：

```bash
cd apps/android
```

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

## 正式发布

正式版本由 GitHub Actions 使用仓库加密密钥完成签名。向 `main` 上的提交推送
`android-v*` 标签后，流水线会执行测试与检查，并发布已签名的 APK。
签名私钥不得提交到仓库。

## 通知说明

不同厂商对后台运行的限制不同。如果提醒没有按时出现，请在应用的“自启动与后台”页面检查自启动、电池优化和通知权限。这些开关通常只能手动确认。

## 项目关系

这个 Android 版本由 [@Mark8924](https://github.com/Mark8924) 基于 DDL Reminder Web 版改造，现与 Web 端共同维护在 [Kyy008/DDL-Reminder](https://github.com/Kyy008/DDL-Reminder) 仓库中。Android 代码位于 `apps/android`，并保留原仓库提交历史。
