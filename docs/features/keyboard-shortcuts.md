# Feature: Keyboard shortcuts（统一快捷键）

| Field | Value |
| --- | --- |
| **id** | `keyboard-shortcuts` |
| **status** | `active` |
| **last verified** | 2026-09-25 — P2 实现落地；`src/main/shortcuts.test.js` 11/11；面板交互/输入竞争/旧用户首启默认待实机验收。 |

## User paths

1. 侧栏快捷键入口打开面板；搜索动作、查看当前绑定、修改、重置为官方默认。
2. 本地输入优先于页面快捷键竞争；自定义立即生效。
3. 无快捷键历史的旧用户自动得到官方默认，无迁移提示。

## Invariants

- 持久化到 `keybindings.json`（原子写入）；读不到或损坏 = 官方默认，不写回。
- 本地优先策略显式化：`data-shortcut-policy="local-first"` 文档标记驱动，物理键不被主进程消费，顶帧 DOM 分派器先同步裁定 region/modal。
- adapter 对接上游 shortcuts API 与桌面壳菜单/按钮；不造第二套快捷键系统。
- 恢复默认后回到官方表，不留 tombstone。
- 一个物理输入一个执行者：registry 受理的绑定键压制同名菜单 accelerator；菜单点击走 `dispatchMenuCommand`（commandId + revision）。
- 关闭链路为 `page.close` → `keyboard.closeWindow(revision)` → 壳复核 → `win.close()` → 任务保护。
- `Ctrl+\`/`Ctrl+`` 在 desktop 只有注册表一个 owner（`surfaces.toggle`/`terminal.drawer.toggle`），PanelToggles 的 DOM 直听仅 web 保留。

## Allowed touch

- `src/main/shortcuts*.js`（持久化 + 优先级裁决 + adapter）
- `src/main/menu.js`（命令项键帽与 dispatch 接线）
- `src/preload/index.js`（`dshDesktop` 窄外观：`keyboard`/`shortcuts`）
- `vendor/deepseek-harness/packages/client/shortcuts/`（policy.ts、registry/index 策略接线）
- `vendor/deepseek-harness/packages/client/{ui-titlebar,ui-sidebar-right,ui-sidebar-terminal,ui-user-terminal}/`（面板 chords 收编 + region 标记，fork markers 登记）
- `src/renderer/`（侧栏入口与面板接线；复用既有 UI 槽位）

## Do not touch

- 不改上游快捷键 schema；不写第二份持久化文件。
- 不覆盖终端 / Monaco / 输入框内的正常编辑快捷键。

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/shortcuts.test.js`（持久化/优先级/重置/迁移语义） |
| Manual / QA | 面板交互、输入竞争、旧用户首启默认 |

## Sources

- Decision: [本地优先快捷键桥](../decisions/implemented/architecture/2026-09-25-local-first-shortcut-bridge.md)
- Plan: `docs/superpowers/plans/2026-09-25-upstream-adoption-plan.md` §5/P2
- Evidence: `docs/superpowers/evidence/2026-09-25-upstream-adoption/ledger.md`（K-1…K-10）
