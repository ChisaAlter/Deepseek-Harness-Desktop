# Feature: 远程设置

| Field | Value |
| --- | --- |
| **id** | `remote-settings` |
| **status** | `active` |
| **last verified** | 2026-08-30 — 外出 QR 改公网 `/dshd/`；modeHint 区分 LAN/外出；config 拒 `:8411` 作 SPA。 |

## User paths

1. 设置 → 「远程」（`remote`）→ **网关**：选 **局域网 / 外出**（文案区分；扫码传输都经中继）；中继主机默认内置 `125.124.85.212:8411`。**无宿主令牌墙**。
2. 设置 → 「远程」→ **消息渠道**：桌面内置 `@xmanrui/dsh-im` 完整 IM UI（九渠 + AI Office）；无商店品牌头。
3. 侧栏底部手机图标打开配对弹窗：开关 → 中继状态；中继已连接才显示扫码二维码 / 复制链接 / 刷新配对码 → 已配对设备 / 解除配对。

## Invariants

- 设置 section id `remote`；子 slot `settings.remote.tab`：`gateway`（order 0）、`channels`（order 10）。
- **配对协议 = dshd offer**（实现为 vendored ChisaCode offer v2）：全量 `createChisaCodeDaemon` 跑在 `chisacode-daemon-runner.mjs` 子进程（**禁止**回迁主进程）；主进程 `ChisaCodeRemote` 只是进程管理面 + file-backed 配对/快照；QR `appBaseUrl`：局域网 = `preferredLanIp():3180`，外出 = `DEFAULT_PUBLIC_APP_BASE_URL`（`/dshd/`），**禁止**把中继 `:8411` 当 SPA。用户可见文案称 dshd daemon / dshd 配对，不出现 ChisaCode 品牌名。
- **daemon 子进程契约**：runner 在 `asarUnpack`；stdout 只有 JSON 行（控制行 + pino json）；stdin `stop` 与 stdin 关闭都必须优雅停（孤儿零容忍）；意外退出必须落 `snapshot.error` 并保留弹窗重试；不做自动退避重启循环（对齐上游）。
- **DSHD_* 命名桥**：桌面对外只有 `DSHD_CHISACODE_HOME`（打包需 `DSHD_ALLOW_ENV_HOME=1`，同 dsh-home 守卫）与 `DSHD_DSH_VENDOR_DIR`；`CHISACODE_*` 只允许出现在 daemon 子进程 env 注入处，主进程自身 env 与 PTY / `dsh web` 子进程永不携带；字面量 `DSHD_HOME` 属 dsh-home 卡，不可占用。DEEPSEEK 凭据只经 `official-deepseek-env` 白名单入子进程 env，launch JSON 永不含密钥。
- `snapshot.relayConnected` / `relayError` 反映真实 relay control；未连接时弹窗明示且不展示配对码。
- 源码启动若缺 `dist` 会构建 ChisaCode server；pack/dist 额外组装并验证 production daemon 依赖，禁止靠构建机残留产物。
- 侧栏 QR 仅客户端 `qrSvg(pairingUrl)`（`includeQr: false`）。
- 外出中继禁止 `chisacode.sh` / 上游 `account_id`。AGPL：`AGPL-SHIPPING.md`。内置 `125…:8411` 可作为 **传输默认**，不可作 SPA；公网 SPA 走 nginx `/dshd/` 路径，是另一条 landing path。
- 粘性：`deviceSecret` 直至用户解除配对；刷新 QR 只换短期 pairing token。
- dsh-im 桌面内置：insert 在自有 overlay `desktop-plugins/dsh-im/desktop-dsh-im.patch.yml`，`--patch` 叠加（full+skip）；`cordis.patch.yml` 不写受管块（只 strip 迁移）；禁插件 / Recovery 不可关（IPC 返回 `desktop-builtin`，config 归一化剔除别名）；vendor 运行时缺损 fail start（skip 修不了）。
- 渠道主操作 36px（飞书扫码无 `size=small`）。
- **断管不崩**：vendored `resolveDshVendorDir` 的 `execSync` 必须携带显式 `stdio`（tripwire 在 `remote-epipe.test.js`）；主进程 stdout/stderr 常驻 `stdio-guard`（断管类流错误吞掉，uncaughtException 仅吞断管写入、其余复刻 Electron 默认对话框）。
- 弹窗失败态可见：启动中 `startingHint`；持久失败人话（端口占用 / 通用）；On 对 `!listening` 或无 pairingUrl 可重试；打开弹窗立刻 refresh 且缺码时至多一次 sync 自愈；弹窗无 raw relay code、无裸 `#offer=` 文本；`HarnessController` 关停走 `stopDaemon()`，引导期 sync 失败必进 dsh 日志。
- `qa:remote` 必含 `cold.openShowsQr` / `cold.noBareOfferText` / `cold.copyAndRotateControls`；第二 Electron 冷 boot（`DSH_QA_REMOTE=cold`，开窗前禁止 `setRemote`）；QR 只认 `[data-dsh-remote-qr]`；中继未连时这三条断言「无码 + 无复制/刷新 + 有 status」。`prestart-ensure` 校验 `copyLink` / `data-dsh-remote-copy-link`。
- 桌面 harness 完备（12 个 dsh vendor 包均有 `lib/index.js`）时才向**子进程**注入 `CHISACODE_DSH_VENDOR_DIR`；优先级 `DSHD_DSH_VENDOR_DIR` > 继承的 `CHISACODE_DSH_VENDOR_DIR` > 完备自带目录 > 不设（子进程内保留已加固的 npm 全局回退）。
- `dsh-acp-demo` shim 仅在 harness acp-demo 构建产物存在时物化（`<home>/bin`，prepend 子进程 PATH）；产物缺失时 provider 如实显示不可用，禁止伪造可用性。

## Allowed touch

- `vendor/chisacode-remote/`、`src/main/chisacode-remote.js`、`src/main/chisacode-daemon-runner.mjs`、`src/main/index.js`、`src/main/mobile-web-server.js`、`src/main/stdio-guard.js`
- `vendor/deepseek-harness/packages/client/ui-settings-remote/`
- `src/main/remote-patch.js`、`config.js`、`src/shared/lan.js`、`ipc.js` / preload Remote IPC
- `src/main/dsh-im-desktop.js`、`harness-controller.js`、`plugin-forensics.js`
- `vendor/dsh-im/`、本卡、[mobile-remote](mobile-remote.md)、[_kill-http-remote](_kill-http-remote.md)

## Do not touch

- 自研中继冒充移植；daemon/hello 切片
- 恢复 HTTP 宿主令牌墙
- 把中继 IP 填进 `remoteAppBaseUrl` / QR 落地
- 把 dsh-im 退回可禁用户插件

## Gates

| Kind | What |
| --- | --- |
| Automated | `chisacode-remote.test.js`；`chisacode-daemon-runner.test.js`（runner 协议 + dist-gated 真实 daemon 端到端）；`remote-epipe.test.js`；`stdio-guard.test.js`；`lan.test.js`；dsh-im-desktop / skip-compose；ui-settings-remote specs |
| Manual | 中继已连接 → 扫码配对 → sticky 重连 → 解除；Windows 打包机：子进程隔离下配对 + 强杀主进程无孤儿 daemon；dev 机（harness 已构建）：手机端 dsh provider 建会话 |

## Sources

- Plan：gateway_product_redo / fix_qr_pairing / [2026-08-28-remote-epipe-hardening](../superpowers/plans/2026-08-28-remote-epipe-hardening.md)
- Vendored：`vendor/chisacode-remote/DESKTOP-FORK.md`
