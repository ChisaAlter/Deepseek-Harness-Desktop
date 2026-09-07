# 2026-09-06 Android 最终本地候选打包

状态：收到主任务最后审查修复通知后已重新完整构建并补打最新 Web 资源，JVM 测试及最终源码的 APK 资源审计通过；不是生产部署、真机验收或保留数据升级 Pass。最终浏览器复测因 T3 Code preview 工具超时未完成，详见[主任务证据](README.md)。后续源码变化必须重新构建并审计。本记录不修改历史基线结果。

## 构建

- 时间：2026-09-06 23:17:43（Asia/Shanghai）生成最终 APK；资源及 fake-client 排除检查于 23:18:47 完成。此前 23:11、23:14 候选均因后续源码修改而被重建替代，不作为最终交付。
- 工作目录：`C:/Ai/Deepseek-Harness-Desktop/mobile/android`。
- JDK：`C:/Program Files/Microsoft/jdk-17.0.18.8-hotspot`。
- SDK：`C:/Users/48818/AppData/Local/Android/Sdk`，由 `ANDROID_HOME` / `ANDROID_SDK_ROOT` 指定。
- 完整 JVM/构建结果：`BUILD SUCCESSFUL in 55s`，46 个任务全部实际执行，JVM 报告完成于 23:15:03。随后检测到 `app.js` 再次落盘修改，补跑 `:app:assembleDebug`：`BUILD SUCCESSFUL in 3s`，4 个任务执行、34 个 up-to-date；staging、assets 合并/压缩与 APK 打包重新执行，Kotlin 编译保持 up-to-date。
- 使用带引号的非增量 Kotlin 参数、进程内编译与 `--rerun-tasks`，不复用上轮测试结论；未修改依赖或根桌面版本。

```powershell
.\gradlew.bat :protocol:test :app:testDebugUnitTest :app:assembleDebug "-Pkotlin.incremental=false" "-Pkotlin.compiler.execution.strategy=in-process" --rerun-tasks --no-parallel --console=plain
# 检测到后续 Web 变更后补跑，未把 up-to-date 编译冒充重新执行 JVM 测试：
.\gradlew.bat :app:assembleDebug "-Pkotlin.incremental=false" "-Pkotlin.compiler.execution.strategy=in-process" --no-parallel --console=plain
```

编译仅报告两处既有弃用警告：`RemoteWebScreen.kt` 的 `getWindowInsetsController` 与 `ScanScreen.kt` 的 `setTargetResolution`；未因此修改 Kotlin 或升级库。

## 测试

| 测试集 | 数量 | 失败 / 错误 / 跳过 |
| --- | --- | --- |
| App：DshViewModelTest | 6 | 0 / 0 / 0 |
| App：RemoteWebBackTest | 12 | 0 / 0 / 0 |
| App：RemoteWebNavigationTest | 2 | 0 / 0 / 0 |
| App：WebFileRequestTest | 8 | 0 / 0 / 0 |
| Protocol：OfferTest | 6 | 0 / 0 / 0 |
| Protocol：PairingIntentTest | 4 | 0 / 0 / 0 |

合计 app JVM **28/28**、protocol **10/10**，本轮实际执行。报告源：`mobile/android/app/build/test-results/testDebugUnitTest/` 与 `mobile/android/protocol/build/test-results/test/`。

工具回归 `node --test tools/mobile-web-qa/server.test.mjs tools/mobile-web-qa/runtime-assets.test.mjs` 本轮 **20/20** 通过，无失败或跳过。未启动独立浏览器。

## APK 身份

| 项目 | 值 |
| --- | --- |
| APK | `mobile/android/app/build/outputs/apk/debug/app-debug.apk` |
| applicationId | `ai.deepseek.harness.mobile` |
| variant | `debug` |
| versionCode / versionName | `2` / `0.1.1`（旧本地候选 `1` / `0.1.0`） |
| 大小 | 35,348,633 bytes |
| APK SHA-256 | `67f176677e2daadd4248563d2d1615c44662cd97f3324cff4421b6612f553bcb` |
| 签名证书 DN | `C=US, O=Android, CN=Android Debug` |
| 签名证书 SHA-256 | `d309640f2dd361550038a172b81a294cb8a7f847cf569eca3d5f650840b7db52` |

SDK 36.0.0 的 `apksigner verify --print-certs` 成功，证书与旧本地 debug APK 一致；版本由构建输出 `output-metadata.json` 核对。没有比对用户生产安装的证书，因此不能断言生产覆盖升级兼容。包名和 WebView asset origin 不变，不代表已验证配对/草稿保留。

## 运行资源

[apk-audit.json](apk-audit.json) 的 `pass=true`：当前源码图与 APK 解压后全部运行资源逐字节/SHA-256 一致，内嵌清单也完全一致，`missing`、`changed`、`unexpected` 均为空。

主任务已独立复核同一 APK，结果亦为 `pass=true`；确认 APK SHA-256 为 `67f176677e2daadd4248563d2d1615c44662cd97f3324cff4421b6612f553bcb`，`app.js` 为 208,157 bytes / `7020170dface27c74c0a10766a0ee53e85f63aada321373183b24c6d48c070aa`。

- Web 运行文件：**45** 个，合计 **1,075,225 bytes**。
- 内嵌 `mobile-web-runtime-manifest.json`：6,959 bytes，SHA-256 `23e0a1303421505134ba6a55793bf8ee8172cb3a27c3f8ae514c32873c05a7ce`。
- APK assets 共 **49** 个文件：45 个 Web 运行文件 + 1 份清单 + 3 个明确列出的 MLKit 原生模型文件。
- 正式 `chisacode/daemon-client.bundle.js` 与源码完全相同，SHA-256 `512bbb267ededb6786769cc4ad42642b10dc1a74a262a50de4463752eb2eca83`。
- 额外检查 APK 中开发文件路径、与 QA fake-client 完全相同的文件，以及 JS/HTML/CSS 中的 `__qa`、`QAFAKE`、`fake-daemon-client` 标记：均未发现。没有测试、开发入口或 sourcemap。

主任务通知本次追加修复为分支/Push/PR 单锁串行、按 path 缓存 workspace、焦点排除 mask；打包侧核验以下最新落盘文件与 APK 内容完全一致，行为验收仍由主任务记录：

| 最新源文件 | bytes | SHA-256 |
| --- | --- | --- |
| `mobile/web/app.js` | 208,157 | `7020170dface27c74c0a10766a0ee53e85f63aada321373183b24c6d48c070aa` |
| `mobile/web/git/stack.js` | 1,155 | `7b3354452131ab39011b2610b330fbe3b13d0dcdfb24356be5bcd663ea41e517` |

```powershell
node tools/mobile-web-qa/runtime-assets.mjs audit --apk mobile/android/app/build/outputs/apk/debug/app-debug.apk --report tools/mobile-web-qa/results/2026-09-06-interaction/apk-audit.json
```

## 尚未验收

未安装、部署、卸载或清理应用数据；未使用生产私钥。公网/物理设备、Android WebView/IME/相机、同签名保留数据升级未验收。60/60 六尺寸受控 DOM 检查属于早期候选，snap 状态也不是动效时序或真机证据；后续源码变更后的最终复测因 T3 Code preview evaluate/snapshot/navigate 工具超时未完成，不得宣称最新修订 60/60 Pass。完整边界以[主任务证据](README.md)为准。

APK 输出路径会被后续构建覆盖，应以本记录哈希识别候选。主任务通知任何 Web/Android 源码变更后，重新执行构建和资源审计，并同步本记录，不能仅更新清单来把旧 APK 标成新源码。
