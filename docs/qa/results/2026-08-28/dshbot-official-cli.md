# dshbot 官方原版 CLI 全量测试（2026-08-28）

Touching: `dshbot`

**目的**：用 **npm 官方 CLI `@deepseek-ai/dsh@0.1.1-rc.2`**（非 Desktop Electron 壳、非 `HarnessController`）对 dshbot 做安装 / 加载 / 卸载闭环与 UI 验证。此前 Linux 三相（2026-08-26）走的是 Desktop 源码 + 官方 CLI bin 路径；本轮是纯官方原版主导，两者不混同。

## 环境

| 项 | 值 |
| --- | --- |
| CLI | `@deepseek-ai/dsh@0.1.1-rc.2`（npm registry 最新；`dsh --version` 实测输出 `0.1.1-rc.2`） |
| 安装方式 | `npm i @deepseek-ai/dsh@0.1.1-rc.2`（隔离目录 `/tmp/dsh-official-cli`，非全局） |
| Node | v22.22.2（**v22.14.0 无法启动**，见发现 4） |
| pnpm | 10.33.3（`dsh plugin` 内置转发） |
| `$DSH_HOME` | `/tmp/dshbot-official-test-home`（隔离，全新初始化，不碰桌面 `userData/dsh-home`） |
| profile | `web`（`dsh plugin --profile web …` 首次调用自动初始化） |

## 结果总表

| 层 | 项 | 结果 |
| --- | --- | --- |
| A | 桌面门禁 `src/main/dshbot-*.test.js`（9 个文件） | **PASS** 100/100 |
| A | `node scripts/check-dshbot-publish.mjs dshbot-v0.2.0` | **PASS**（manifest 完整、tag 一致） |
| B1 | 官方 CLI 安装 + 版本 | **PASS**（0.1.1-rc.2） |
| B2 | 干净 profile 初始化 | **PASS**（`profiles/web` 自动建立） |
| B3 | `dsh plugin --profile web add github:ChisaAlter/dshbot` | 装上但**无效**：独立仓 main（`a003247`）只有 README，CLI 明确告警 `declares no dsh.bundle — installed as a plain dependency, not a profile layer` |
| B3 | `… add 'github:ChisaAlter/Deepseek-Harness-Desktop#path:/vendor/dshbot'`（main） | **PASS**：dshbot 0.2.0 装入，`dependencies` + `dsh.profile.bundles` 双写；pnpm 报 8 条 missing-peer 告警（见发现 2） |
| B4 | `dsh plugin --profile web list` / `dsh --profile web --dump-config` | **PASS**：list 显示 `dshbot@0.2.0`；dump-config 出现 `== dshbot` 层（`id: dsh-bot`） |
| B4 | 插件首载 preset 自装 | **PASS**：`$DSH_HOME/.agent-presets/dshbot-room/{preset.yml,agent.cordis.yml}` 生成 |
| B5 | `dsh web` 启动 + 服务端挂载 | **PASS**：`http://127.0.0.1:3080` 200；index.html 注入 `{"id":"dshbot","url":"/plugins/dshbot/client.js?rev=…"}`；client.js 200 且与 `vendor/dshbot/client/client.js` 字节一致 |
| B5 | **Bots 页签出现（真实 Chrome GUI）** | **FAIL（官方原版能力缺口）**：页签不出现，无任何 console error / exception（CDP 采集确认）。根因见发现 1 |
| B6 | `dsh plugin --profile web remove dshbot` | **PASS**：`dependencies` 与 `bundles` 行都被 CLI 摘除，`node_modules/dshbot` 删除 |
| B6 | 卸载残留 | `.agent-presets/dshbot-room` **残留**——官方 CLI 无桌面 `removeDshbotPreset` 清理，属官方 vs 桌面差异，非桌面 bug |
| C | PR #70 分支复测（`#cursor/dshbot-standalone-split-f2c5&path:/vendor/dshbot`） | **PASS**：可装可挂载（client rev 与 main 相同）；peer 告警范围变为 `^0.1.0-rc.7 \|\| ^0.1.1-rc.1`，但仍是 missing-peer（见发现 2） |
| C | 建 bot / 建群 / 轮转发言真跑 | **BLOCKED**：环境无 `DEEPSEEK_API_KEY`，不伪造 |
| — | TC-EXT-007 Windows NSIS 三相 | **BLOCKED**（云端 Linux 无 Windows/wine，维持 2026-08-26 结论） |

## 发现

1. **【核心】官方原版没有 `sidebar.nav.tab` / `sidebar.page` 槽位 → Bots 页签在官方 dsh 下静默缺席。**
   - 官方 npm `@deepseek-ai/dsh-client-ui-sidebar@0.1.1-rc.2` 的 slots 契约只有 `sidebar.brand.mark/brand.name/footer.action/settings/workspaces`；GitHub 上游 `deepseek-ai/deepseek-harness` 当前 `packages/client/ui-sidebar/src/client/contract/slots.ts`（118 行）同样没有 nav.tab/page。
   - 这两个槽位是桌面 fork 在 vendored subtree 里自己加的（fork 注记 `2026-08-19-sidebar-tabs-dshbot-origin.md`：「`ui-sidebar` declares a list hole `sidebar.nav.tab` and a keyed hole `sidebar.page`」），**未上游、未随官方包发布**。
   - 表现：官方 web 下 dshbot 服务端完全正常（bundle 挂载、preset 自装、client.js 注入且零报错），但 `ctx.slots.inject("sidebar.nav.tab", …)` 注入的是宿主不渲染的槽位，UI 无 Bots 页签、无错误提示。feature 卡「CLI 安装（官方插件通道）→ 侧栏出现 Bots 页签」这条 user path **只在桌面 fork web UI 成立**。
   - 连带风险（未逐项验证）：fork 注记里同批的 `origin: 'dshbot'`、`session.selectModel persistDefault` 等宿主改动同样不在官方包内，即使补了页签，1:1/群会话行为在官方原版下也可能偏差。
2. **peers 在官方 pnpm 通道下不会硬失败。** `dsh plugin` 转发 pnpm，且官方 profile 布局从不把 `@deepseek-ai/*` 装进 profile `node_modules`（宿主包由 CLI 自身安装树提供），所以 main 的窄 peers（`^0.1.0-rc.7`，不含 0.1.1-rc.2）与 PR #70 的放宽 peers（`^0.1.0-rc.7 || ^0.1.1-rc.1`）在官方 CLI 下都只是 missing-peer 告警、装载行为一致。PR #70 的放宽对 npm 严格 peer 解析的消费方（如 npm 装包、发布后 `dsh plugin add dshbot@semver`）仍有意义，且告警文案更诚实。
3. **独立仓 `ChisaAlter/dshbot` main 仍是占位**（`a003247`，仅 README）：pnpm 能装但官方 CLI 判定 `no dsh.bundle`，装为普通依赖不生效。PR #70 市场行切独立仓前，独立仓必须先有真实 package 内容。
4. **官方 0.1.1-rc.2 需要 Node ≥ 22.15**：`@deepseek-ai/dsh-session-persistence-jsonl` import `node:zlib` 的 `createZstdDecompress`（Node 22.15 / 23.8 起提供），v22.14.0 下 `dsh web` 启动即崩。官方包未声明 engines 下限（对照桌面打包 runtime 时需注意）。
5. **卸载残留差异**：官方 `dsh plugin remove dshbot` 干净摘除依赖与 bundles 行，但 `.agent-presets/dshbot-room` 留存；桌面启动的 `removeDshbotPreset` 会在无任何 dshbot 安装时清掉该目录。差异如实记录，官方侧不视为 bug。

## 证据

- 门禁：`node --test src/main/dshbot-*.test.js` → 100 pass / 0 fail（artifact `dshbot-gate-tests.log`）
- 安装（main / PR #70）：本目录 `dshbot-official-install-main.txt` / `dshbot-official-install-pr70.txt`
- 卸载：`dshbot-official-uninstall.txt`
- GUI（真实 Chrome @ DISPLAY :1，官方 web，无 Bots 页签）：`dshbot-official-web-no-bots-tab.png`
- 浏览器 console/DOM（CDP）：无异常；`document.body` 无 `Bots|机器人` 文本（artifact `dshbot-official-browser-console.log`）
- 槽位对照：`rg 'sidebar.nav.tab' /tmp/dsh-official-cli/node_modules/@deepseek-ai/` 零命中 vs `vendor/deepseek-harness/packages/client/ui-sidebar/src/client/contract/slots.ts` 第 47/49 行；上游 GitHub 同文件零命中

## 建议

1. 修正 `docs/features/dshbot.md` 的「standalone」口径：注明 Bots 页签依赖桌面 fork 的 `sidebar.nav.tab`/`sidebar.page` 槽位，官方原版 dsh 下当前无 UI（本轮已同步 Known limitations）。
2. 若要真 standalone：要么把 nav.tab/page 槽位 PR 到上游 `deepseek-ai/deepseek-harness`，要么让 dshbot client 在槽位缺席时降级占用官方已有槽位（如 `sidebar.footer.action` 入口 + 全页面板）。
3. PR #70 合并门槛之一（独立仓有内容）仍未满足；peer 放宽本身在官方通道验证无回归，可继续推进。
4. 官方 CLI 的 Node ≥ 22.15 要求应写进 dshbot README / 桌面 runtime 检查。
