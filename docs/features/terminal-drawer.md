# Feature: Terminal drawer

| Field | Value |
| --- | --- |
| **id** | `terminal-drawer` |
| **status** | `active` |
| **last verified** | 2026-08-31 — 已装 Setup SHA `49BD62B56D47FE0AD312B9E4C684D3070AFF81D6086595F55C80FB28C403FECA`：`packaged.ghostty.wasm` HTTP **200**；`terminal.drawer` / `terminal.new` / `terminal.surface` PASS（`install-full-report.json`）。 |

## User paths

1. `` Ctrl+` `` 打开底栏终端；可输入命令。
2. 选区送进对话（Composer）。
3. 多会话 / 分屏（若 UI 提供）；销毁后可重建。

## Invariants

- 终端是工作环，不是空态说明卡片。
- PTY 由桌面 `pty.js` 提供；UI 为官方终端组件语言（等宽网格 / Ghostty）。
- `libghostty-vt` wasm 必须能从 `/plugins/<id>/assets/` 读到；源码启动会校验并把 wasm 拷到 `lib/assets`，缺则拒绝启动。
- PTY 生命周期：关抽屉 / 关 surface tab / 切会话都**不** kill（进程保活，回来还在）；kill 只发生在终端 UI 的垃圾桶按钮与 app 退出；renderer reload / 崩溃（`render-process-gone` / 跨文档导航）时 main 收割该 renderer 名下全部 PTY，不留孤儿。
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

- Handbook：[../handbook/modules/terminal.md](../handbook/modules/terminal.md)
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- 审查与硬化计划：[../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md](../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md)
