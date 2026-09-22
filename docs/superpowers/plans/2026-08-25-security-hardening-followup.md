# 2026-08-25 安全审查后续加固计划（M-4 深化 / 凭据存储可观测 / L-2 / L-4 / 护栏补强）

`Touching: mobile-remote, desktop-launcher`。B（凭据存储可观测）落在 About 区（ui-settings-general，桌面 fork 包）与 `config.js`，属桌面自有代码的本地增强；C（L-2 / L-4）为不改产品契约的本地修复，在此显式声明。

承接 PR #43（`docs/superpowers/plans/2026-08-25-security-review-remediation.md`），本轮做上一轮明确推迟与审查建议项。**不回退** #43 的任何修复。

## A. M-4 深化：LAN 绑定地址可配置 + LAN 自签 TLS（桌面侧闭环）

### A1 绑定地址可配置（本轮完整落地）

- **现状**：`RemoteGateway.start` 硬编码 `listen(port, '0.0.0.0')`；整个网段可达。
- **改法**：
  1. `config.js`：新增 `remoteBindAddress`（默认 `'0.0.0.0'`，保持现行为）；`normalizeRemoteConfig` 校验为 `0.0.0.0` / 合法 IPv4 点分十进制，非法回落默认。
  2. `remote-patch.js`：接受 `remoteBindAddress`（IPv4 白名单校验，fail-closed）。
  3. `remote.js`：`listen(port, bindAddress)`；`sync()` 的 same 判定纳入 bindAddress（改绑定即重启监听）；`snapshot()` 增加 `bindAddress` 与 `bindOptions`（全部可选地址，UI 用），`urls` 按绑定收窄：`0.0.0.0` → 全部 LAN 地址（现行为）；`127.0.0.1` → 仅 loopback 配对 URL（`adb reverse` / 本机场景仍可用）；指定网卡 IP → 仅该地址。
  4. `relay-client.js`：`getLocal()` 返回 `{ port, host }`，本地回连用 `local.host || '127.0.0.1'`——绑定收窄到指定网卡后中继模式不失联。
  5. `ui-settings-remote`：远程弹窗 LAN 模式下新增「监听范围」radiogroup（整个局域网 / 仅本机 / 各网卡 IP），写 `saveRemote({ remoteBindAddress })`；zh/en 词典（`satisfies` 约束）。
- **验收**：remote.test.js 覆盖绑定收窄（loopback 绑定下外部地址不监听、urls 收窄、sync 换绑重启）；remote-patch/config 校验单测；UI spec 覆盖选择与回写。

### A2 LAN 自签 TLS（桌面侧能力 + 能力门禁；Android 跟进清单）

- **现状**：LAN 模式明文 HTTP；上一轮只加了常驻警示。
- **改法（桌面侧完整实现）**：
  1. 新增 `src/main/remote-tls.js`：零依赖（Node crypto）生成 ECDSA P-256 自签证书（SHA-256 签名、SAN 含 loopback+LAN 地址、有效期 10 年），私钥/证书持久化在 `userData/remote-tls/`，过期或损坏自动重生成；导出 `ensureTlsMaterial(dir)` → `{ key, cert, fingerprint256 }`（指纹 = 证书 DER 的 SHA-256 hex，供客户端 pin）。
  2. `config.js`：新增 `remoteLanTls`（默认 `false`，保持现行为与 Android 配对不破坏）；`remote-patch.js` 接受布尔。
  3. `remote.js`：`remoteLanTls && mode === 'lan'` 时以 `https.createServer({ key, cert })` 起网关（升级/代理路径不变；中继模式**不**套 TLS——中继链路已是端到端 HTTPS，且 RelayClient 以明文回连本地）。`snapshot()` 增加 `lanTls` 与 `tlsFingerprint`。
  4. `src/shared/lan.js` + `offer.js`：TLS 开启时配对/访问 URL 用 `https://`；`#offer=` 载荷附可选 `fp`（证书 SHA-256），`decodeOffer` 透传。浏览器（mobile/web SPA）首访需人工确认自签证书（浏览器插页），之后获得 secure context（扫码 `BarcodeDetector`/`getUserMedia` 反而解锁）；`wss:` 由 SPA 现有 `location.protocol` 推导自动生效。
  5. `ui-settings-remote`：LAN 模式下新增「传输加密」radiogroup（明文 HTTP / 自签 HTTPS）；TLS 开启时警示行替换为自签 HTTPS 提示（含「Android 客户端暂不校验自签证书，本轮请继续用明文或中继」的能力门禁文案）。
- **能力门禁（不假装端到端完成）**：Android 原生客户端（OkHttp）默认拒绝自签证书——`remoteLanTls` 默认关，开启时 UI 明示 Android 不可用。**Android 跟进清单**（后续轮）：
  1. `mobile/android` 解析 offer `fp` 字段；
  2. OkHttp 自定义 TrustManager/HostnameVerifier：仅当服务器叶证书 SHA-256 == `fp` 时放行（pin 优先于系统信任）；
  3. wss/https scheme 从配对 URL 透传；
  4. `:protocol:test` 补指纹校验用例（错误指纹拒连）。
- **验收**：remote-tls 单测（生成→`crypto.X509Certificate` 解析、持久化复用、过期重生成、HTTPS 服务端指纹往返）；remote.test.js 增 TLS 网关用例（https + token 登录 + 代理、指纹进 offer）；lan/offer 单测；UI spec；卡片/handbook 更新。

## B. 凭据存储模式可观测（safeStorage 回退可见）

- **现状**：`credentials.json` 在无钥匙串的 Linux 明文回退，用户与支持无从判断。
- **改法**：`config.js` 导出 `credentialStorageMode()`（`'encrypted' | 'plaintext'`，即 `canEncryptCredentials()` 的公开面）；`ipc.js` `configPayload` 附 `credentialStorage`；`ui-settings-general` About 区渲染一行凭据存储状态（加密 = 系统钥匙串；明文 = 回退警示），zh/en 词典，tokens/ui-primitives 之内不新增皮肤。
- **验收**：config-credentials 单测覆盖两种模式；about-section spec 断言两种文案渲染。

## C. 审查遗留 Low

### L-2 `dsh.js` 就绪探测尊重 `config.host`

- **现状**：`attachOutput` 只匹配 `127.0.0.1|localhost`，自定义 host 下 `webReady` 永假 → 假「启动超时」。
- **改法**：新增纯函数 `matchReadyUrl(line, host)`：接受 loopback 别名 + 配置 host（正则转义）；通配地址（`0.0.0.0` / `::`）归一为 `127.0.0.1` 再入 `baseUrl`（可达性探测与 BrowserView 加载都不能连通配地址，Windows 上 `0.0.0.0` 直接失败）。`_start` 的 expectedUrl 同样归一。
- **验收**：dsh.test.js 覆盖自定义 host 匹配、通配归一、原 loopback 行为不回归。

### L-4 `workspace-fs.writeFile` 拦 `.git` 内部写入

- **现状**：`writeFile` 可写 `.git/hooks/…` 等（`listDir` 早已隐藏 `.git`，写侧无对称防护）。
- **改法**：新增 `isGitInternalPath(relativePath)`（任一路径段等于 `.git`，大小写不敏感，`/`、`\` 都算分隔）；`writeFile` 命中即 fail（不触盘）。读侧维持现状（面板本就见不到 `.git` 条目）。
- **验收**：workspace-fs 单测：`.git/config`、`a/.git/hooks/x`、`.GIT\\x` 拒绝；`a.git/x`、`.gitignore` 放行。

## D. H-1 / M-3 回归护栏补强（代码级，非 Windows 也正确分支）

- H-1：静态断言 `src/main/index.js` 永不引用 `globalShortcut` 且 `attachDevToolsShortcut` 挂在 `app.on('web-contents-created')`（devtools-shortcut.test.js 增补）。
- M-3：静态断言 `ipc.js` 的 `shell:install-update` / `shell:install-release` 与 `index.js` 冷启动闸门都接 `confirmUnverified`（确认框 fail-closed：`defaultId: 1` / `cancelId: 1`）；update.test.js 增补非 Windows 分支（`launchUninstaller` 在 linux/darwin 源码运行 → `source-run-no-install`；packaged → settings/未找到，绝不 spawn）。
- **验收**：全部为可在本环境跑绿的 node:test 单测。

## 明确不做 / 仍推迟

- Android 客户端 TLS 指纹校验（见 A2 跟进清单）——需 Gradle/真机验证，本环境无法闭环。
- 中继协议重设计、HarnessController 并发重写、BrowserView → WebContentsView：与上一轮一致，不动。
- LAN mDNS/证书自动信任分发：超出「自签 + 指纹」模型，不做。

## 测试策略

- 每模块 `node --test src/main/<module>.test.js`；vendor `ui-settings-remote` / `ui-settings-general` 用各自 vitest 项目跑；收尾全量 `npm test`。
- 本环境无显示器/非 Windows：UI 变更静态 + 组件测试验证；TLS 网关用真实 https 服务器 + fetch 指纹校验在单测内闭环。

## 执行结果（回填）

A1 / A2 / B / C（L-2、L-4）/ D 全部按计划落地，无回退 #43 内容；A2 的 Android 证书固定按计划保持为跟进清单（能力门禁 + 文档，不假装端到端完成）。

- **A1**：`remoteBindAddress` 全链（config 归一 → remote-patch 白名单 → `listen(port, bindAddress)` → `sync()` 换绑重启 → snapshot `bindAddress`/`addresses`/urls 收窄 → relay `getLocal().host` 回连）；UI「监听范围」radiogroup（全部网卡 / 仅本机 / 各网卡 IP）。
- **A2**：零依赖 `src/main/remote-tls.js`（ECDSA P-256 自签证书 + 最小 DER 编码，持久于 `userData/remote-tls`，过期/损坏重生成）；`remoteLanTls` 默认关；LAN 网关按开关起 `https.createServer`；配对 URL 换 `https` + offer `fp` 透传；中继模式不套 TLS。UI「传输加密」radiogroup + `lanTlsHint`（短指纹 + 浏览器插页/Android 不支持双门禁文案）；警示矩阵改为「明文 + 非仅本机」才出 `lanPlaintextWarning`，仅本机出 `bindLoopbackHint`。
- **B**：`credentialStorageMode()` → `configPayload.credentialStorage` → About 区一行状态（明文回退带 `role="status"`），zh/en 词典。
- **C L-2**：`connectHost` / `readyUrlPattern` 导出；`attachOutput` 按配置 host 匹配就绪行并把通配主机重写为可连接地址；`expectedUrl` / `probePort` / `findFreePort` 通配归一（实现取名与计划草案 `matchReadyUrl`/`isGitInternalPath` 略有出入，语义一致）。
- **C L-4**：`touchesGitDir`（任一段 `.git`，大小写不敏感，`/`、`\` 均为分隔）拦截写入；`.gitignore`、`.github/**` 照常；surfaces-work-loops 卡补 invariant。
- **D**：devtools-shortcut.test.js 静态断言（index.js 无 `globalShortcut`、`web-contents-created` + `attachDevToolsShortcut` + 门禁读真实 `app.isPackaged`）；update.test.js 静态断言（两条 IPC 通道 + 冷启动闸门接 `confirmUnverified`、对话框 `defaultId/cancelId=1`、`response===0` 才放行）+ `installUpdate` 无确认 fail-closed + 非 Windows 分支（linux/darwin：不查注册表、不 spawn，packaged → `uninstaller-not-found`、源码 → `source-run-no-install`）。
- **文档**：mobile-remote 卡（invariants 重写 + Allowed touch 补 `remote-tls.js`/`remote-patch.js`/`relay-client.js`/`lan.js`/`offer.js` + last verified）、handbook mobile-remote 模块（安全边界改为收窄手段矩阵 + Android 跟进清单）、desktop-launcher 卡与 surfaces-work-loops 卡 last verified。`.cursor/rules` 无 mobile-remote 条目，无需同步。

**测试**：全量 `npm test`（node:test，src + mobile/web）**1056 tests / 1053 pass / 0 fail / 3 skipped**（skip 为仓内既有平台条件跳过）；vendor vitest `ui-settings-remote` + `ui-settings-general` **27 passed**（含绑定范围、TLS 开关、警示矩阵、About 凭据行）。

**环境局限**：无显示器 / 非 Windows / 无 Android Gradle——UI 以组件测试与静态断言验证，TLS 网关以真实 `https` 服务器 + 指纹校验在单测内闭环；Windows 卸载与确认框无法动态点按，以静态断言 + 依赖注入单测护栏。
