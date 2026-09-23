# Feature: Terminal drawer

| Field | Value |
| --- | --- |
| **id** | `terminal-drawer` |
| **status** | `active` |
| **last verified** | 2026-09-20 — Checkpoint B2 PTY 负路径覆盖：`registerPtyIpc` 以 sender 代际表替代“创建后即记账”，`shell:pty-create` 在 `await` 之后复检 `isCurrent`（sender 表身份 + 代际 + 未销毁）；renderer 在创建未完成时**销毁**或**跨文档导航**，迟到 PTY 立即 `kill` 并抛 `ERR_DSH_IPC_SENDER`，不再变孤儿（导航用例先红后绿：仅比 sender 表身份时漏检，补代际比较后转绿）。补测非 owner 对他人 PTY 的 write/resize/kill 一律 `unknown pty id`（后端零调用）、已销毁 sender 在任何 dispatch 前 `ERR_DSH_IPC_SENDER`、数据/退出事件只路由 owner、畸形尺寸（`NaN` / `Infinity` / `0` / 负数 / `99999.9`）在触达后端前归一化到 `1..1000`（非有限值回落 `120x30`）、kill 后重复 write/resize/`kill`/`killAll` 为有界 no-op。`pty.test.js` 24/24。终端语义保持不变：关抽屉 / 关 surface tab / 切会话都保留 PTY；只有 renderer 销毁/跨文档导航/崩溃收割。此前 2026-09-11 — `TerminalPane` 的 settle fit 仅在宿主有真实 used box 时通知 PTY，折叠/未布局 pane 不再误报默认网格；ui-user-terminal 45/45，完整 `test:gui` 505 文件 / 6860 通过 / 1 跳过，`npm run smoke:source` PTY 探针通过。此前 2026-09-01 — 已装 CI Setup SHA `F2C571D285B68E730FEFF5E8FB1362F48484761278D939D84E2BFD1298562856`：`packaged.ghostty.wasm` HTTP **200**；`terminal.drawer` / `terminal.new` / `terminal.surface` PASS；`case.terminal.addToChat` 终端 fence（`install-full-report.json`）。 |

## User paths

> 2026-09-22 补充（PTY 输出合并）：`src/main/pty.js` 在同一 burst 内合并 backend chunk 后再发 IPC，8 ms / 32 KiB 先到者 flush，空闲后的首个 chunk 立即发布；`pty.test.js` 31/31，含「10k × 1 KiB 突发发布条数 ≤ 1/5」「payload ≤32 KiB」「exit 前 flush 尾部输出」「单次输入无延迟」四条门禁；同一实现上 100k × 1 KiB 计数为 100000 → 3126 条（−96.9%）。背压未实现。

1. `` Ctrl+` `` 打开底栏终端；可输入命令。
2. 选区送进对话（Composer）。
3. 多会话 / 分屏（若 UI 提供）；销毁后可重建。

## Invariants

- **PTY 输出合并（2026-09-22）**：`createPtyController` 不再对每个 backend chunk 发一条 `shell:pty-data`。空闲后到达的第一个 chunk 立即发布（交互回显不付窗口），随后同一 burst 内按 8 ms 或 32 KiB（UTF-8 字节）先到者 flush；`shell:pty-exit` 与 `kill`/`killAll` 前先 flush 缓冲，退出事件永不越过尾部输出。合并只减少 IPC 条数，不改字节序、不丢内容、不缓冲输入写入与 resize。**背压仍未实现**：node-pty `pause`/`resume` 未被证明能约束生产速度，本卡不声称已具备背压。
- 终端是工作环，不是空态说明卡片。
- PTY 由桌面 `pty.js` 提供；UI 为官方终端组件语言（等宽网格 / Ghostty）。
- `libghostty-vt` wasm 必须能从 `/plugins/<id>/assets/` 读到；源码启动会校验并把 wasm 拷到 `lib/assets`，缺则拒绝启动。
- PTY 生命周期：关抽屉 / 关 surface tab / 切会话都**不** kill（进程保活，回来还在）；kill 只发生在终端 UI 的垃圾桶按钮与 app 退出；renderer reload / 崩溃（`render-process-gone` / 跨文档导航）时 main 收割该 renderer 名下全部 PTY，不留孤儿。
- `shell:pty-*` 必须经中央 `assertIpcSender(HARNESS_ONLY)`：只有 harness 顶层 frame 能创建/写入/调整/终止；单条 PTY 还额外绑定**创建它的 webContents**，别的已授权 renderer 也不能 write/resize/kill（`unknown pty id`）。已销毁 sender 在派发前即拒绝（`ERR_DSH_IPC_SENDER`）。
- 创建与记账之间存在 `await`：`shell:pty-create` 必须在 await 后复检 sender 代际（sender 表身份 + generation + 未销毁），renderer 在创建期间被销毁**或跨文档导航**时把迟到 PTY `kill` 掉再失败，不得只删记账留下后台 shell。尺寸先归一化（整数、`1..1000`，非有限值回落 `120x30`）再进后端。
- `` Ctrl+` `` 在 Ghostty 终端焦点内也切换抽屉（beforeKey 放行给 titlebar window 监听）。
- 不做未承诺的 GPU 终端嵌入。

## Allowed touch

- `src/main/pty.js` 及 PTY 相关测试
- `src/main/dsh.js`、`src/shared/ghostty-assets.js` 及对应测试（源码启动 Ghostty 校验/拷贝）
- Harness `ui-user-terminal`（及桌面接线）
- Harness `ui-titlebar` 的 keybindings / PanelToggles（面板快捷键判定，2026-08-25 硬化计划扩围）
- 本卡与 handbook terminal 章

## Do not touch

- 用空态卡片墙替代可用 PTY
- 无用户授权时改 Surfaces Tab 关闭位置（属 `surfaces-work-loops`）

## Gates

| Kind | What |
| --- | --- |
| Automated | `pty.test.js` / `dsh.test.js` / `ghostty-assets.test.js`；`qa:packaged` 可 rehearsal 兄弟仓 PTY + wasm 200（**不能**当发版 Pass） |
| Manual / QA | 每次发布前生产表 `TC-TERM-001`…`004`、`TC-CHAT-004`；已装 CI 包、TC-WS-006 仓 |

## Sources

- Decision: none
- Owning decision: [PTY 输出按 burst 合并后再跨 IPC](../decisions/proposed/architecture/2026-09-22-pty-output-coalescing.md)

- Handbook：[../handbook/modules/terminal.md](../handbook/modules/terminal.md)
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- 审查与硬化计划：[../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md](../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md)
