# 手机远程

中文 · 扫桌面 **远程** 弹窗里的二维码。浏览器与 Android 都运行 `mobile/web` 的 dshd 远程 SPA；Android 原生层负责扫码、粘贴、返回、媒体选择与生命周期承载，不另写聊天 UI。它们都不是官方四栏 `dsh web`。

**0.2.9 发布范围（2026-09-06）：** 本次仅交付 Windows x64 桌面安装包，不发布 Android APK。本文是源码能力说明，Web 第二客户端与 Android 未纳入本次实机放行范围，不能据此视为手机全流程验收通过。见[中英文发布说明](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/releases/tag/v0.2.9)。

**后续交互改造（2026-09-06，本地候选已构建，验收未完成）：** 上述发布范围保留为历史记录，不豁免本轮 T1 公网 Web、适用 T2 LAN 与 T3 Android 验收。当前修订的 debug APK 已构建，JVM 测试与源码资源审计通过，但不能记为真机 Pass。行为以[手机远程 feature card](../docs/features/mobile-remote.md)为准，候选身份见[打包记录](../tools/mobile-web-qa/results/2026-09-06-interaction/packaging.md)。

**浏览器证据边界：** 早期候选的 60/60 受控 DOM 检查覆盖六种尺寸，动画 snap 状态只证明当时的 DOM/几何，不是动效时序或真机证据。之后源码已修改，最终源复测因 T3 Code preview 的 evaluate/snapshot/navigate 工具超时未完成，**不得宣称最新修订 60/60 Pass**；公网与物理设备也未验收。详见[本轮证据](../tools/mobile-web-qa/results/2026-09-06-interaction/README.md)。

## Web

1. 手动开启桌面远程。未配置时默认「服务器」，「局域网」可手动选择；已保存的模式和地址保持不变。页面地址以桌面生成的配对链接为准，offer 内的中继端点只承载 dshd WebSocket，不是 SPA 页面。
2. 用系统相机扫码，或在 SPA 内用 `BarcodeDetector` + `getUserMedia` 扫码/粘贴完整 `#offer=` URL。
3. SPA 解析 offer v2 后创建浏览器版 `DaemonClient`，通过中继与桌面 daemon 端到端加密通信。首次配对取得的 `deviceSecret` 保存在该 SPA origin 的 localStorage；没有 hash 的后续启动会 sticky 重连。
4. 配对后是桌面 `dsh web` 的同协议第二客户端：daemon 白名单 host 隧道转发 `session.list` / `workspace.list` / `session.history` / `session.prompt` / `session.cancel`，审批走 `respond` → `POST /api/respond`。新会话走 `session.create`，支持已有工作区、无工作目录，以及 `host.listDirectory` / `host.createDirectory` / `workspace.create` 浏览和登记目录；不是 ACP `fetchAgents` / `createAgent`。
5. 模型与思考档走 `session.models` / `session.selectModel`；权限、Plan 与斜杠命令走 Typert `commands/execute`，不能作为聊天文本发送。草稿、附件与异步结果保留设备/会话归属。
6. Git 走 daemon 隧道 `shell:git-*` 到桌面 Electron Git dispatch，不是 ACP checkout/file RPC。支持 Init、分支搜索/切换/跟踪、**创建并检出分支**、Commit/Push/PR 组合动作、Pull、Publish 与 View PR；具体白名单与恢复边界见 feature card。Files / Diff / MCP / 技能仍显示冻结说明，不提供假文件列表；打开电脑路径与受限设置不开放。
7. 权限、模型、附件来源与行菜单用短面板；目录浏览和 Git 表单用全屏任务，设置按目录/详情分层。屏幕返回、浏览器返回和 Android 返回共用网页导航决策；交互样式与动效见[设计语言](../docs/design-language.md#手机远程交互)及[手机动效 inventory](../docs/motion.md#手机交互-inventory)。
8. 开发测试：`node --test "mobile/web/**/*.test.js"`；构建资源与 QA 服务测试：`node --test tools/mobile-web-qa/server.test.mjs tools/mobile-web-qa/runtime-assets.test.mjs`。命令从仓库根目录执行。

应用内扫码的降级（如实呈现，不 vendor 第三方解码库）：

- LAN `http://192.168.x.x:3180` 不是 secure context，取不到相机——按钮不渲染，提示用系统相机扫码或粘贴链接。应用内扫码只在安全 origin（例如 Android asset origin）可用。
- iOS Safari / Firefox 没有 `BarcodeDetector`——同样降级为粘贴。
- 相机权限被拒（`NotAllowedError`）→ 权限说明屏，指引浏览器站点设置，可改用粘贴。
- 扫到异 origin 的配对码 → `location.replace` 整页跳转到二维码里的本机 SPA 地址，token 留在 `#offer=`，不进查询串。

中继能看到连接元数据，但会话内容由 daemon/client 密钥端到端加密。服务器模式使用应用配置的默认地址或用户显式保存的地址；不要把任意公共服务当成可信替代端点。

## Android

工程在 `mobile/android/`（`applicationId` `ai.deepseek.harness.mobile`，`minSdk` 26）。CameraX 扫描或粘贴同一条 offer v2 URL；严格校验后，`WebViewAssetLoader` 从 `https://appassets.androidplatform.net` 加载 APK 内置的同一份 SPA。Android 不另写协议客户端，也不保存 offer/deviceSecret；后者由稳定 WebView origin 的 localStorage 管理。

本机需 Android SDK。当前工程 `compileSdk`/`targetSdk` 为 36。

```text
cd mobile/android
./gradlew test
./gradlew :app:assembleDebug
```

JVM 测试覆盖 offer/handoff、返回决策和媒体请求归属，不代替 WebView、IME 或相机实机测试。原生返回在键盘打开时先收键盘，再请求当前可信 asset 页的导航决策；相册/拍照使用系统活动和受控 URI，前台恢复通知共享 SPA 检查连接。

Gradle 构建前生成确定性运行资源图，将同一份 `mobile/web` 运行文件逐字节放入 assets，排除测试、开发入口与 sourcemap；构建后须[解包核对清单及 SHA-256](../tools/mobile-web-qa/README.md)。当前 Android 候选为 versionCode `2` / versionName `0.1.1`，包名与 asset origin 不变，不修改桌面版本。

完整验收仍需真实桌面 daemon、中继与设备：扫码 → 配对 → 已有/新建工作区会话 → 模型/权限/审批 → Git → 返回/键盘/媒体选择 → 前后台与冷启动 sticky 重连 → 桌面解除配对。debug 候选不等于正式更新包；生产签名一致性及保留配对/草稿的覆盖升级尚未验证，不得卸载或清数据来制造升级成功。历史验收保留，新轮次未测项不得继承为 Pass。
