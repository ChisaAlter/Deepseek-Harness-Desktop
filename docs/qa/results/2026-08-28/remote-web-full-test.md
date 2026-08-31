# Remote / 扫码 / mobile web —— 云端 web 端全量测试（2026-08-28）

Touching: `remote-settings` + `mobile-remote`（只测不改产品行为；发现 bug 按严重度记录）

## 环境

- 云端 Linux VM（无显示器 / 无真机）；Node 22.14；`google-chrome`（headless）
- 分支 `cursor/remote-epipe-hardening-2f82`（阶段 1–3 + 扫码分流 + Android intent handoff 已合入该分支）
- Vendored ChisaCode：`node scripts/prepare-chisacode-remote.mjs` 构建 `packages/server/dist`（daemon 子进程运行前提）
- 产品默认中继 `125.124.85.212:8411`：TCP 可达（真实链路以浏览器 WS 结果为准）

## 测试计划

| # | 层 | 步骤 | 预期 | 证据 |
| --- | --- | --- | --- | --- |
| T1 | 自动化回归 | 桌面 `npm test`（含 `landing.test.js` 入口分流 + manifest tripwire、`chisacode-remote.test.js`、`remote-epipe.test.js`、`stdio-guard.test.js`） | 全绿 | `/opt/cursor/artifacts/remote_web_qa/npm-test.log` |
| T2 | 自动化回归 | `ui-settings-remote` Vitest（`scanSplitHint` 随 QR 出现/关闭消失） | 全绿 | `.../vitest-remote.log` |
| T3 | 浏览器集成（fake daemon） | `tools/mobile-web-qa/run-qa.mjs`（真实 SPA + headless Chrome，48 检查：Files/Diff/MCP/Skills 工作环、零写断言、时间线锚点、openSession 失败占位、已保存电脑 chooser） | 48/48 | `.../mobile-web-qa.log` + 截图 |
| T4 | 真实 E2E（web 端） | 纯 node 驱动 `ChisaCodeRemote.startDaemon()`（真 daemon 子进程 + `:3180` mobile web + 真 `generateLocalPairingOffer`）→ headless Chrome 打开真实配对 URL | 落地页渲染 + `#entry-split-hint` 分流文案可见；SPA 自动 `connect()` 走 E2EE 配对（经真实/本地中继）；配对后进入 web 端会话界面 | 截图序列 + 控制台/daemon 日志 |
| T5 | 失败/重试 | 无效 offer / 中继不可达场景 | SPA 可见错误态（不假装在线）；可重试 | 截图 |
| T6 | 关停回收 | `stopDaemon()` 后 | `:3180` 连接被拒；daemon 子进程退出（无端口/进程泄漏）；snapshot `listening:false` | 命令输出 |
| T7 | Electron GUI | 若环境许可用 xvfb 启动完整桌面端 | 弹窗 QR + `scanSplitHint` | 截图或诚实 BLOCKED |

## 结果

| # | 结果 | 详情 |
| --- | --- | --- |
| T1 | ✅ | `npm test` 1256 pass / 0 fail / 4 skipped（dist 构建后原 dist-gated 真 daemon 测试也实跑；含新增 session 非 secure context 回归） |
| T2 | ✅ | `ui-settings-remote` Vitest 35/35（含 `scanSplitHint` 随 QR 出现/关闭消失） |
| T3 | ✅ | fake-daemon 浏览器集成 48/48（修复后重建 bundle 复跑仍 48/48） |
| T4 | ✅（修复后） | 新工具 `tools/remote-web-qa/run-e2e.mjs` 8/8：真 daemon 子进程 + `:3180` + 真 offer + headless Chrome 全链路 E2EE 配对（中继用 vendored relay `wrangler dev --local`，见下）；首轮暴露 P0 `crypto.randomUUID`（见「发现的 bug」），修复并重建 bundle 后全绿 |
| T5 | ✅ | 垃圾 offer 可见错误「无效的配对链接（需要 ChisaCode offer v2）」不假装配对；stopDaemon 后浏览器显示「正在重新连接电脑…」不假装在线 |
| T6 | ✅ | stopDaemon 后 daemon 子进程退出、`:3180` 与 daemon 端口拒连、snapshot `listening:false` 且无残留 error |
| T7 | ✅ | xvfb 下真 Electron 跑 `qa:remote`（TC-NEG-001/TC-REM-001）**8/8 全 PASS**（守门、启停、pairing offer、侧栏 Remote 入口、弹窗 QR SVG、关闭后端口回收）。首两轮 `neg.footerPresent`/`rem.qrVisible` FAIL 是 harness web UI 未构建（boot 日志明示），构建 `build:lib`+`build:web` 后全绿；运行录像与帧截图留档 |

### 发现的 bug（本轮修复）

**P0：真机浏览器扫码配对必炸——`crypto.randomUUID` 在非 secure context 不存在。**
配对落地页是 `http://<LAN-IP>:3180`（明文 http + 非 localhost = 非 secure context），浏览器在该环境**不暴露** `crypto.randomUUID`；`mobile/web/chisacode/session.js#clientId` 与 vendored client 三处裸调用在配对第一步即抛「crypto.randomUUID is not a function」（`#connect-error` 可见，截图留档）。既有 QA 全部跑在 `127.0.0.1`（secure context），故 48/48 一直是绿的——这正是「真机 relay 链路 BLOCKED」一直没揭穿的原因。E2EE 栈本身是 tweetnacl（纯 JS），`crypto.subtle` 全程零依赖（bundle/源码均已核），因此修掉 uuid 调用点即可全链路打通：
- `mobile/web/chisacode/session.js`：`clientId` 改用 `getRandomValues` fallback（`host/rpc.js#mintRpcId` 同款先例）；`session.test.js` 新增无 `randomUUID` 环境下配对成功的回归锁。
- vendor `packages/client`：`daemon-client.ts` / `daemon-client-checkout-subscriptions.ts` / `daemon-client-agent-interaction.ts` 裸调用改走既有 `safeRandomId()`；fork delta 记入 `DESKTOP-FORK.md`。

**观察（非本轮修）：**
1. 产品默认外部中继 `125.124.85.212:8411` 对 WS 升级返回 **503**（daemon 侧持续退避重连、主进程与 UI 不受影响——隔离与失败面符合设计），本轮真实 E2EE 配对经 vendored relay 本地实例（`wrangler dev --local`，需 `@cloudflare/workerd-linux-64`）完成。真机/生产前需确认该中继服务状态。
2. vendored `better-sqlite3` 因 `npm ci --ignore-scripts` 无原生绑定，daemon 降级「Agent SQLite index disabled」（非致命、按设计降级）；打包链路 `--runtime` 构建不受此影响，源码开发环境如需 agent index 需补一次 rebuild。
3. `:3180` 落地页 favicon 404（纯外观噪音）。
4. 本 VM node 22.14 低于 harness 引擎要求（`^22.19.0 || >=24`）时：根 `pnpm run build`（`scripts/build.ts`）**静默退出 0 但什么也没构建**；`build:lib` 的 tsdown 报缺 `unrun`。nvm 切 node 24 后 `build:lib`+`build:web` 正常出 `apps/cli/lib/bin.js` 与 `apps/web/dist`。vendored 上游行为，仅记录。

### 证据

- `/opt/cursor/artifacts/remote_web_qa/e2e-local-relay.log`（8/8）、`mobile-web-qa.log`（48/48）、`qa-remote-electron.log`（Electron gate）、`shots/`（01 落地页分流文案、02 配对成功进 web 端、04 垃圾 offer 错误态、05 断线重连条）

### 复现真实 E2E

```
node scripts/prepare-chisacode-remote.mjs
npm i --no-save puppeteer-core
cd vendor/chisacode-remote && npm i --no-save @cloudflare/workerd-linux-64@<workerd 版本> && cd packages/relay \
  && node ../../node_modules/.bin/wrangler dev --local --ip 127.0.0.1 --port 8788 &
node tools/remote-web-qa/run-e2e.mjs --relay 127.0.0.1:8788
```
