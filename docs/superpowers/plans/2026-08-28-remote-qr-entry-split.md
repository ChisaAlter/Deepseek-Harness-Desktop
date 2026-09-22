# Remote 扫码入口分流：App＝链接设备，浏览器＝web 端

Touching: `remote-settings` + `mobile-remote`（2026-08-28）

## 产品意图（用户原话大意）

「扫码链接手机端或者 web 端怎么说，我希望如果是 Android APP 扫码是链接设备，浏览器等其他设备扫码出 web 端。」

## 现状调查结论

**配对 URL / QR 内容**：只有一张码——`http://<preferredLanIp>:3180/#offer=<offer-v2>`（`generateLocalPairingOffer` → `encodeOfferToFragmentUrl`，`appBaseUrl` 固定为本机 mobile/web `:3180`，永不指中继 origin）。

**两条入口今天的真实行为（功能上已经分流）**：

| 扫码方 | 路径 | 结果 |
| --- | --- | --- |
| 手机相机 / 浏览器 | 打开 `:3180` SPA，`app.js` 启动块 `hasOfferFragment(location.hash)` → 自动 `connect()` 配对 | 直接进入 **web 端**（完整 mobile web 客户端，sticky 存浏览器 localStorage） |
| Android App 内扫码 | `classifyScan` 提取完整 offer URL → APK 内置同一 SPA（WebViewAssetLoader 安全 origin）配对 | **链接设备**（sticky 存 App 的 WebView origin，冷启动不再依赖 LAN 落地页） |

**上游对照（生产做法）**：上游 chisacode 同样是**一张码**，`appBaseUrl` 默认 `https://app.chisacode.sh`（托管 web app）；vendored 代码里 `chisacode://` 仅是桌面 Electron 的 app 协议，**没有**移动端 deep link / Universal Link。原生端拿 offer 的方式就是 App 内扫码（与本仓库 `mobile/android` 一致）。所以「一码、web 落地、App 自带扫码」就是上游形状——不需要第二张码或第二套协议。

**缺口（本轮要修的）**：

1. **没人告诉用户这个分流**。桌面弹窗只有 QR + 配对链接；`:3180` 落地页文案只说「扫桌面的二维码」。用户无法知道「App 内扫码＝链接设备、相机/浏览器扫码＝web 端」。
2. Android **系统相机**扫码永远进浏览器（web 端）：`mobile/android` manifest 没有任何 `VIEW` intent filter / 自定义 scheme，无法把 `http://<LAN>:3180/#offer=` 交给 App。且 intent filter 无法匹配 fragment，host 是动态 LAN IP，只能靠 `android:host="*"` + `android:port="3180"` 这类宽匹配——属于 App 侧改动，本 VM 无 Android SDK 无法构建验证（卡片既有 BLOCKED 记录），**本轮 defer**。

## 决策

- **保持一张 QR**（对齐上游；不发明第二套协议、不出第二张码）。
- 分流靠**现有双入口 + 明确文案**：
  - 桌面弹窗 QR 下新增一行分流说明（`scanSplitHint`）。
  - 设置 → 远程 `intro` 补一句同样口径。
  - `:3180` 落地页 lead 下新增静态分流说明行（浏览器打开本页＝web 端；装了 App 就在 App 内扫码＝链接设备）。
- 口径统一为：**「Android App 内扫码＝链接设备；手机相机 / 浏览器扫码＝打开 web 端」**。

## 变更清单

1. `ui-settings-remote`：`locales.ts` 新增 `scanSplitHint`（zh/en，en 键齐全由 `satisfies Record<RemoteLocaleKey>` 编译期锁）；`RemoteSection.tsx` 在 QR 与配对链接下渲染该行；`intro` 文案补分流口径。spec 断言 QR 展示时分流说明可见。
2. `mobile/web/index.html`：connect 屏 lead 下新增 `#entry-split-hint` 静态说明行。
3. 新增 `mobile/web/landing.test.js`：断言落地页含分流说明、`#offer=` 自动连入 web 端的启动接线仍在（tripwire，防止有人把浏览器路径改成「仅设备配对」）。
4. 卡片同步：`remote-settings`（弹窗文案 gate / last verified）、`mobile-remote`（不变式：一码两入口 + 文案义务；last verified）。

## 风险与回滚

- 全部为文案 + 只读断言，零行为改动；回滚 = revert 对应 commit。
- 不改 QR 内容、不改 offer 协议、不改 `:3180` 自动配对行为（mobile-remote QA 48 检查依赖它）。

## 第二批（已实施 2026-08-28）：App 侧系统相机 handoff

把分流从「口径」升级为「系统级选择」：系统相机扫同一张码时，Android 弹选择器——**用 App 打开＝链接设备，用浏览器打开＝web 端**。

### 范围 / 非目标

- 范围：`mobile/android` manifest `VIEW` intent filter、`MainActivity` 冷/热启动 intent 提取、复用现有 `pair()` handoff、纯 JVM 校验逻辑 + 测试、manifest tripwire。
- 非目标：不自造 scheme（上游无移动端 deep link）；不加 `autoVerify` App Links（LAN IP 无法验证，且选择器本身就是想要的 UX）；不改 QR 内容 / offer 协议 / `:3180` 浏览器自动连入。

### 设计

- **Intent filter**：`VIEW` + `DEFAULT` + `BROWSABLE`，`data android:scheme="http" android:host="*" android:port="3180"`。fragment 进不了 intent filter、LAN IP 动态 → 宽 host 匹配是唯一解；安全闸门下移到 App 内。
- **闸门**：`protocol` 模块新增 `PairingIntent.fromViewIntent(action, dataString)`（纯 JVM）——仅 `ACTION_VIEW` + `OfferCodec.parsePairingLink` 全语法通过才算配对链接（http/https、无 userInfo、fragment 严格 `^offer=[A-Za-z0-9_-]+$`、offer v2 可解码）。与 App 内扫码/粘贴完全同一套语法，无第二协议。
- **handoff**：`DshViewModel.openPairingLink()` —— 合法 → 走既有 `pair()`（进内置 SPA WebView 配对）；`:3180` 垃圾链接 → Connect 屏提示「没有配对密钥」，且**绝不**把已连接的 Web 会话踢回 Connect。非 VIEW 启动零副作用。
- **冷/热启动**：`onCreate` 在 `setContent` 前处理 `intent`；`android:launchMode="singleTask"` + `onNewIntent`（含 `setIntent`）复用实例，不堆叠 Activity。
- **安全评估（宽 host 匹配）**：intent data 只被解析、永不加载——WebView 只载 APK 内置 SPA（WebViewAssetLoader origin），恶意 `http://evil:3180/#offer=` 最坏等价于扫恶意二维码（同一信任模型，用户主动触发）；offer 是公开材料 + 一次性 bootstrap token，无凭据外泄面。

### 验收标准

1. 系统相机扫桌面 QR → Android 弹「用 App 打开 / 用浏览器打开」；选 App 直接进配对 WebView，选浏览器进 `:3180` web 端（原路径不回归）。
2. App 已开且在 Web 会话中时点击垃圾 `:3180` 链接：不被踢出会话。
3. `LAUNCHER` 正常启动行为不变。

### 测试与验证

- 本 VM 装了 JDK 17 + Android SDK（compileSdk 36）后全部可跑：`:protocol:test` 9/9（`OfferTest` 5 + `PairingIntentTest` 4）、`:app:testDebugUnitTest` 5/5（含 VIEW handoff 3 例）、`:app:assembleDebug` 成功且 merged manifest 复核（VIEW+BROWSABLE、host=`*`、port=3180、无 `android:autoVerify`、singleTask）。
- `mobile/web/landing.test.js` 新增 manifest tripwire（node 环境即可跑）。
- **真机 Manual gate（BLOCKED，无真机/模拟器）**：见 Gates。

### 回滚

revert 对应 commit 即可——不涉及协议/存储迁移；卸掉 intent filter 后系统相机回落为「全走浏览器」，App 内扫码不受影响。

- 若未来上游给移动端引入正式 scheme / App Link，跟随上游，不自造。

## Gates

| Kind | What |
| --- | --- |
| Automated | `remote-section.client.spec.tsx`（分流说明随 QR 可见）；`mobile/web/landing.test.js`（落地页口径 + 浏览器 web 端自动连入 tripwire + Android manifest VIEW/:3180/无 autoVerify tripwire）；locale 键齐全编译期锁；`:protocol:test`（`PairingIntentTest` 宽匹配下拒非法语法）；`:app:testDebugUnitTest`（VIEW handoff 配对 / 垃圾链接提示 / 不踢 Web 会话） |
| Manual（真机） | ① 系统相机扫码 → 选择器出现，选 App＝直接进配对 WebView，选浏览器＝web 端；② 冷启动（App 未运行时点链接）与热启动（App 在前台/后台再扫）都能配对且不堆叠 Activity；③ App 在 Web 会话中点垃圾 `:3180` 链接不被踢出；④ 浏览器扫码 → 进 web 端且落地页可见分流说明；⑤ Android App 内扫码 → 链接设备；⑥ 桌面弹窗可见分流说明 |
