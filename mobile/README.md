# 手机远程

中文 · 扫桌面 **远程** 弹窗里的二维码。浏览器与 Android 都运行 `mobile/web` 的 dshd 远程 SPA；Android 原生层只负责扫码、粘贴和安全承载 APK 内置资产。它们都不是官方四栏 `dsh web`。

## Web

1. 桌面打开远程，选择局域网或外出。桌面总是在本机 `:3180` 提供 SPA；offer 内的中继端点只承载 dshd WebSocket。
2. 用系统相机扫码，或在 SPA 内用 `BarcodeDetector` + `getUserMedia` 扫码/粘贴完整 `#offer=` URL。
3. SPA 解析 offer v2 后创建浏览器版 `DaemonClient`，通过中继与桌面 daemon 端到端加密通信。首次配对取得的 `deviceSecret` 保存在该 SPA origin 的 localStorage；没有 hash 的后续启动会 sticky 重连。
4. 会话列表/时间线/发送/停止/审批，以及手机“新会话”，都直接走 daemon RPC。新会话复用已有 agent 的 `provider`/`cwd`；空目录时从最近工作区与 ready provider 发现默认值。
5. Git 状态、提交、拉取、推送、创建 PR、切换已有分支和根目录文件列表走 daemon checkout/file RPC。普通分支创建与打开电脑设置没有协议能力，UI 会禁用并提示到电脑端完成。
6. 开发测试：`node --test "mobile/web/**/*.test.js"`。

应用内扫码的降级（如实呈现，不 vendor 第三方解码库）：

- LAN `http://192.168.x.x:3180` 不是 secure context，取不到相机——按钮不渲染，提示用系统相机扫码或粘贴链接。应用内扫码只在安全 origin（例如 Android asset origin）可用。
- iOS Safari / Firefox 没有 `BarcodeDetector`——同样降级为粘贴。
- 相机权限被拒（`NotAllowedError`）→ 权限说明屏，指引浏览器站点设置，可改用粘贴。
- 扫到异 origin 的配对码 → `location.replace` 整页跳转到二维码里的本机 SPA 地址，token 留在 `#offer=`，不进查询串。

中继能看到连接元数据，但会话内容由 daemon/client 密钥端到端加密。不要把任何公共服务当作产品默认中继或 SPA 地址。

## Android

工程在 `mobile/android/`（`applicationId` `ai.deepseek.harness.mobile`，`minSdk` 26）。CameraX 扫描或粘贴同一条 offer v2 URL；严格校验后，`WebViewAssetLoader` 从 `https://appassets.androidplatform.net` 加载 APK 内置的同一份 SPA。Android 不另写协议客户端，也不保存 offer/deviceSecret；后者由稳定 WebView origin 的 localStorage 管理。

本机需 Android SDK。当前工程 `compileSdk`/`targetSdk` 为 36。

```text
cd mobile/android
./gradlew test
./gradlew :app:assembleDebug
```

JVM 测试覆盖 offer 校验与原生 handoff；APK 构建会把 `mobile/web` 复制进 assets。完整验收仍需真实桌面 daemon 和中继：扫码 → 配对 → 新建会话 → Git/文件 → 冷启动 sticky 重连 → 桌面解除配对。
