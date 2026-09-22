# Remote popover UX — 审查缺陷弥补（2026-08-29）

Touching: `mobile-remote`, `remote-settings`

工作树：`wip/remote-pairing-ensure` @ `e60e6dc8` + 本轮未提交改动。

## 环境

| Item | Value |
| --- | --- |
| OS | Windows 10.0.26200 (`DESKTOP-TFK2NTA`) |
| Node | v24.15.0 |
| Chrome | `C:\Users\48818\AppData\Local\Google\Chrome\Application\chrome.exe` |
| SHA | `e60e6dc8`（工作树含本轮未提交改动） |
| Relay (6-D/6-E) | vendored wrangler local DO：`127.0.0.1:8788` |
| Product relay | `125.124.85.212:8411` → HTTP/WS **503**（观察；不作假绿） |

## 构建

```bash
pnpm --filter @deepseek-ai/dsh-client-ui-settings-remote run bundle
node scripts/prestart-ensure.mjs   # fail-closed：lib/client.js 必须含 copyLink + data-dsh-remote-copy-link
```

本机 `lib/client.js` 已含 `copyLink`、`data-dsh-remote-copy-link`、`data-dsh-remote-qr`、`FlipText`。`lib/` 不入库。

---

## 6-A — 单测 / Vitest

| Gate | Result | Evidence |
| --- | --- | --- |
| `node --test src/main/chisacode-remote.test.js src/main/remote-gate-qa.test.js src/main/qa-gate.test.js` | **38 pass / 1 skip** | 含 `ensurePairing unblocks after sync succeeds`；QR 选择器不得含 `/配对/`；`qaRemoteMode` 只认 `1`/`cold` |
| `pnpm exec vitest run packages/client/ui-settings-remote/tests` | **43/43** | 打开后可见 QR/`data-dsh-remote-qr`（不数 mock calls）；On 在 heal 后仍 `EADDRINUSE` 时继续 `save({ remoteEnabled: true })`，文案 `errorPortInUse` |

---

## 6-B — Electron `qa:remote`（两轮 boot）

```bash
npm run qa:remote
# = prestart-ensure && run-remote-gate-qa（Boot 1 DSH_QA_REMOTE=1；Boot 2 DSH_QA_REMOTE=cold，开窗前禁止 setRemote）
```

日志：`docs/qa/results/2026-08-29/qa-remote.log`

**11/11 Pass**

| Boot | Cases |
| --- | --- |
| 1 · `remoteEnabled:false` + `DSH_QA_REMOTE=1` | `neg.*` + `rem.*`（含 `rem.qrVisible` 只认 `[data-dsh-remote-qr] svg`） |
| 2 · `remoteEnabled:true` + `DSH_QA_REMOTE=cold` | `cold.openShowsQr` / `cold.noBareOfferText` / `cold.copyAndRotateControls` |

`cold.copyAndRotateControls`：点击 `[data-dsh-remote-copy-link]` 后主进程 `clipboard.readText()` 断言 LAN host（非 loopback）+ `#offer=`；弹窗 `innerText` 无裸 `#offer=`。`clipboardOffer=true`。

QR **不**用文案「配对」或任意 `svg` 兜底。

---

## 6-C — `mobile-web-qa`（假 daemon 回归）

```bash
# Windows 需 CHROME_PATH
node tools/mobile-web-qa/run-qa.mjs
```

**48/48 Pass**（`docs/qa/results/2026-08-29/mobile-web-qa.log`）

回归，**不是**真中继 / **不是** 6-E。不得把 48/48 抄进下表。

---

## 6-D — 真 E2E + LAN-IP

### 产品默认中继（对照）

本轮未重跑产品中继 e2e。此前同日与 boot 日志仍见 `125.124.85.212:8411` **503**。不作假绿。

### 本地 relay（交付口径）

```bash
node tools/remote-web-qa/run-e2e.mjs --relay 127.0.0.1:8788 --screenshots docs/qa/results/2026-08-29/e2e-shots-local
```

**9/9 Pass**（`docs/qa/results/2026-08-29/remote-web-e2e-local.log`）

- pairing origin 实测 `http://192.168.53.56:3180/#offer=…`（非 loopback）
- 落地页入口分流、E2EE 配对、垃圾 offer、`stopDaemon` 断线

**复制链接**以 **6-B 剪贴板断言**为准（`cold.copyAndRotateControls` / `clipboardOffer=true`）。浏览器 `goto(pairingUrl)` 只证明扫码同 URL 可打开，**不**写成「复制链接」。

截图：`e2e-shots-local/01-landing-entry-split.png` … `05-disconnected.png`。

---

## 6-E — 真配对后操作表

前置：本地 relay + 真 daemon E2EE。Harness 在启动前种临时 **git** 仓 + `projects/projects.json` / `workspaces.json`。

```bash
node tools/remote-web-qa/run-ops.mjs --relay 127.0.0.1:8788 --screenshots docs/qa/results/2026-08-29/ops-shots
```

日志：`remote-web-ops.log` · 矩阵：`ops-shots/ops-matrix.json`  
空 pane「先打开一个会话」= **Blocked**，不得 Pass。

| ID | 步骤 | Result | 证据 / 说明 |
| --- | --- | --- | --- |
| E0 | 真配对进 web 端 | Pass | `E0-paired-home.png` |
| E1 | 工作区→provider→createAgent 出新会话行 | **Blocked** | 工作区已列出并选中（`dsh-ops-repo-*`）；**无 ready provider**（`E1-no-provider.png`）。不得 Pass。 |
| E2 | 发出去 + 停止或用户行 | **Blocked** | 无活会话/流（无 provider） |
| E3 | 改权限后 UI 与 snapshot 一致 | **Blocked** | 无会话可改 mode |
| E4 | 改模型后 UI 与 snapshot 一致 | **Blocked** | 无会话可改 model |
| E5 | 对 E1 会话点 ⋯，确认后列表变 | **Blocked** | 无 agent 行 |
| E6 | 长历史上翻 | **Blocked** | 无足够时间线 |
| E7 | 审批 | **Blocked** | 无 `permission_requested`（不得造事件） |
| E8 | Git 胶囊 | **Blocked** | 无会话 cwd，pill 隐藏 |
| E9 | 文件下钻 / @插入 | **Blocked** | 「先打开一个会话」 |
| E10 | Diff 两 scope | **Blocked** | 「先打开一个会话」 |
| E11 | MCP · 技能只读清单 | Pass | `E11-extensions.png`（设置 hub → MCP/技能） |
| E12 | 断线条 + 发送被拒 + 草稿仍在；重启后 sync | Pass | `E12-disconnected.png`（banner + draft + 已重连） |
| E13 | 去 hash 重开 sticky | Pass | `E13-sticky.png` |
| E14 | `unbindDevice` 后无 hash 页不得已配对 | Pass | `E14-revoke.png`（须重新扫码） |
| Android | 真机扫码 | **Blocked** | 本机无 Android 设备 |

未把 48/48 抄进本表。E1–E10 / E7 / Android 的 Blocked 是环境限制（无 ready provider / 无审批事件 / 无真机），不是空 pane 假绿。

---

## 弹窗无人话码证据

| 断言 | 证据 |
| --- | --- |
| QR 只认 `data-dsh-remote-qr` | `rem.qrVisible` / `cold.openShowsQr` detail `{"kind":"svg"}`；选择器无 `/配对/` |
| 无裸 `#offer=` 文本 | `cold.noBareOfferText` PASS |
| 复制链接剪贴板 | `cold.copyAndRotateControls` `clipboardOffer=true` |
| FlipText 复制标签 | Vitest + `FLIP_TEXT_MS`；bundle 含 `FlipText` |
| 无 raw `relay_control_*` / 无 `EADDRINUSE` 原文 | Vitest 人话映射 + On+EADDRINUSE 用例 |

---

## Blocked 汇总（只留真环境限制）

1. **产品中继 `125.124.85.212:8411` WS 503** — 默认 Away 路径 E2EE 不可用；6-D/6-E 走本地 wrangler。
2. **6-E 无 ready provider** — temp chisacode home 无可用智能体提供方；E1 已走到工作区步并诚实 Blocked；E2–E5 / E8–E10 因此无法实踩。
3. **E7 审批** — 无 `permission_requested`。
4. **E6 长历史** — 新配对无足够时间线。
5. **Android 真机** — 无设备。

---

## 本轮代码（相对 `e60e6dc8`）

- QR：`data-dsh-remote-qr`；gate 只认该容器内 img/svg
- `qa:remote` 第二冷 boot（`DSH_QA_REMOTE=cold`，开窗前不 `setRemote`）
- `prestart-ensure` 校验 `copyLink` / `data-dsh-remote-copy-link`
- 复制按钮：`FlipText` + `FLIP_TEXT_MS`
- `sync()` 成功清 `pairingEnsureBlocked`
- `run-ops`：种 git 工作区；空 pane 不得 Pass；E12/E14 实踩
- 2026-08-27 PNG 保持 `e60e6dc8` 版本（该 commit 已是较小原图；`379a0755` 反而是重压后的大图）
