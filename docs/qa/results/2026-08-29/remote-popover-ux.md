# Remote popover UX — 冷开出码 + 用户向配对面（2026-08-29）

Touching: `mobile-remote`, `remote-settings`

## 环境

| Item | Value |
| --- | --- |
| OS | Windows 10.0.26200 (`DESKTOP-TFK2NTA`) |
| Node | v24.15.0 |
| Chrome | `C:\Users\48818\AppData\Local\Google\Chrome\Application\chrome.exe` |
| SHA | `379a0755`（工作树含本轮未提交改动） |
| Relay (6-D/6-E) | vendored `wrangler 4.127.1` local DO：`127.0.0.1:8788`（`--local --ip 127.0.0.1 --port 8788`） |
| Product relay | `125.124.85.212:8411` → HTTP/WS **503**（与 2026-08-28 观察一致；不作假绿） |

## 构建命令

```bash
pnpm --filter @deepseek-ai/dsh-client-ui-settings-remote run bundle
# 验收：lib/client.js 含 copyLink / startingHint / data-dsh-remote-copy-link
```

本机 `lib/client.js` 已含 `copyLink`、`relayDownDisconnected`、`data-dsh-remote-panel|status|copy-link|rotate`。

---

## 6-A — 单测 / Vitest

| Gate | Result | Evidence |
| --- | --- | --- |
| `node --test src/main/chisacode-remote.test.js`（含 ensurePairing mint / no-op / suppress） | Pass | 会话内跑通 |
| `pnpm exec vitest run packages/client/ui-settings-remote/tests` | **42/42** | 打开即 refresh、一次 save 自愈、人话映射、copy/rotate、无裸 `#offer=` |
| `remote-gate-qa.test.js` case id 列表含 `cold.*` | Pass | 随 `qa:remote` |

---

## 6-B — Electron `qa:remote`（含 cold.*）

```bash
npm run qa:remote
```

**11/11 Pass**（`docs/qa/results/2026-08-29/qa-remote.log`）

含：

- 既有 NEG / REM
- **`cold.openShowsQr`** — preset-on 后只点 trigger，8s 内 QR
- **`cold.noBareOfferText`** — 弹窗 `innerText` 无裸 `#offer=`
- **`cold.copyAndRotateControls`** — `[data-dsh-remote-copy-link]` + `[data-dsh-remote-rotate]` 可见

注：跑前若 `:3180` 被占需杀占用进程。

---

## 6-C — `mobile-web-qa`（假 daemon 回归）

```bash
# Windows 需 CHROME_PATH
node tools/mobile-web-qa/run-qa.mjs
```

**48/48 Pass**（`docs/qa/results/2026-08-29/mobile-web-qa.log`）

报告口径：**回归，非真中继 / 非真配对后全量操作。** 不得冒充 6-E。

---

## 6-D — 真 E2E + LAN-IP

### 产品默认中继（对照）

```bash
node tools/remote-web-qa/run-e2e.mjs --screenshots docs/qa/results/2026-08-29/e2e-shots
```

**5/9**（`remote-web-e2e.log`）：daemon / LAN-IP pairing origin / 落地页 / 垃圾 offer / stopDaemon 可达；**Fail** `relayConnected` 与后续 E2EE（中继 503）。

### 本地 relay（交付口径）

```bash
node scripts/prepare-chisacode-remote.mjs   # 若 dist 已齐可跳
cd vendor/chisacode-remote/packages/relay
node ../../node_modules/wrangler/bin/wrangler.js dev --local --ip 127.0.0.1 --port 8788
# 另窗：
node tools/remote-web-qa/run-e2e.mjs --relay 127.0.0.1:8788 --screenshots docs/qa/results/2026-08-29/e2e-shots-local
```

**9/9 Pass**（`remote-web-e2e-local.log`），含新增：

- `pairingUrl 使用 LAN IP origin（非 loopback / 非 secure 掩盖）` — 实测 `http://192.168.53.56:3180/#offer=…`

截图：`e2e-shots-local/01-landing-entry-split.png` … `05-disconnected.png`。

**复制链接：** Electron gate `cold.copyAndRotateControls` 证明 footer 复制控件存在；真配对路径与扫码同 URL（LAN origin + `#offer=`），浏览器 `goto(pairingUrl)` 已走通（等同剪贴板粘贴打开）。

---

## 6-E — 真配对后全量操作

前置：本地 relay + 真 daemon E2EE 配对（**不是** 6-C 的 48）。

Harness：`node tools/remote-web-qa/run-ops.mjs --relay 127.0.0.1:8788 --screenshots docs/qa/results/2026-08-29/ops-shots`  
日志：`remote-web-ops.log` · 矩阵：`ops-shots/ops-matrix.json`

| ID | 步骤 | Result | 证据 / 说明 |
| --- | --- | --- | --- |
| E0 | 真配对进 web 端 | Pass | `E0-paired-home.png` |
| E1 | 新会话：工作区→provider→模式→模型→创建 | **Blocked** | chooser 打开但 fresh chisacode home **无工作区**（`E1-new-session-chooser.png`） |
| E2 | 发一句；运行中点停止 | **Blocked** | 无活会话/流；无停止控件（`E2-send.png`） |
| E3 | 改权限模式 | Pass | 权限控件可开（`E3-open.png`）；无 agent snapshot 深度切换 |
| E4 | 改模型 | Pass | 模型控件可开（`E4-open.png`） |
| E5 | 重命名→归档→取消归档→删除 | **Blocked** | 抽屉无 agent 行（`E5-drawer.png`） |
| E6 | 长历史上翻 / 阅读中来流不拉底 | **Blocked** | 无长历史 |
| E7 | 审批 actions | **Blocked** | 无 `permission_requested` |
| E8 | Git 胶囊 | **Blocked** | 无 checkout/cwd，pill 隐藏（`E8-git-pill.png`） |
| E9 | 文件 pane 只读空态 | Pass | 明示先开会话；无写控件（`E9-files.png`） |
| E10 | Diff pane 只读空态 | Pass | 同左（`E10-diff.png`） |
| E11 | MCP + 技能 pane | **Blocked** | 本 harness 未点进只读清单 pane（设置入口未稳定命中） |
| E12 | `stopDaemon` 断线 | Pass | 断线条可见（`E12-disconnected.png`） |
| E13 | 去 hash 重开 sticky | Pass | `已重连 srv_…`（`E13-sticky.png`） |
| E14 | 桌面解除设备 | Pass | `unbindDevice(dev_…)` 后设备非活跃 |
| Android | 真机扫码 | **Blocked** | 本机无 Android 设备 |

未把 48/48 抄进本表。E1–E8/E11 的 Blocked 是 **环境缺工作区/会话/审批**，非整表豁免。

---

## 弹窗无人话码证据

| 断言 | 证据 |
| --- | --- |
| 无裸 `#offer=` 文本 | `cold.noBareOfferText` PASS；Vitest `queryByText(/#offer=/)` null |
| 无 raw `relay_control_*` | Vitest：`relay_control_disconnected` → `relayDownDisconnected` 人话 |
| 无 `EADDRINUSE` 原文 | Vitest → `errorPortInUse` |
| footer 复制 / 刷新 | `cold.copyAndRotateControls`；`data-dsh-remote-copy-link` / `rotate` |
| 冷开出码 | `cold.openShowsQr`（不先 toggle，只开弹窗） |

---

## Blocked 汇总

1. **产品中继 `125.124.85.212:8411` WS 503** — 默认 relay 路径 E2EE 不可用；本地 wrangler 可复现全绿。
2. **6-E 缺工作区 / 活会话 / 审批 / 长历史** — fresh temp home；需桌面已登记工作区 + dsh provider 才能跑 E1–E2/E5–E8 深度路径。
3. **Android 真机** — 无设备。
4. **E11 MCP/技能 pane** — 本轮 ops harness 未稳定打开；fake-daemon 48 已覆盖只读清单（不计入 6-E Pass）。

---

## 实现对照（本轮代码）

- 主进程：`ensurePairing` + async `shell:get-remote`
- UI：打开 refresh、一次 `saveRemote` 自愈、加宽 On、人话单槽、footer 复制/刷新、`data-*` 探针
- Gate：`cold.*`；e2e：非 loopback pairing host
- Feature 卡：`docs/features/mobile-remote.md`、`remote-settings.md`（`last verified` → 本报告）
