# Surfaces + Terminal 生产交付审查与硬化计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以生产交付标准收敛右边栏 Surfaces 与底部终端工作环的真实缺陷（数据丢失、快捷键断裂、无消费者高权限 IPC、搜索性能悬崖），并同步文档 / 状态卫生 / QA 闭环。

**Architecture:** 功能主体在 vendored harness client（`ui-surfaces` / `ui-files` / `ui-preview` / `ui-diff` / `ui-user-terminal`）；桌面 main 经 `window.shell` 提供 `workspace-fs`、`preview*`、`pty`、`gitDiff`。硬化以**最小可验证改动**按阶段推进；不扩大 out-of-scope（GPU 终端嵌入、worktree、turn-diff、review-comment pick）。

**Tech Stack:** Electron main IPC + preload；Ghostty Canvas 2D 终端；Files DFS + `git check-ignore`；BrowserView preview；feature cards `surfaces-work-loops` / `terminal-drawer`。

**Review provenance:**
- 云端子代理生产交付审查（模型 `claude-fable-5-thinking-high`，2026-08-25）
- 对照合同：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- Feature cards：[surfaces-work-loops](../../features/surfaces-work-loops.md)、[terminal-drawer](../../features/terminal-drawer.md)

**Touching (implementation PRs):** `surfaces-work-loops`, `terminal-drawer`  
（本文件本身是 plan 落盘；实施时按阶段分别 Touching。）

---

## Delivery standard for this plan

**In scope (must be true to close this plan):**

- 显式保存竞态不再静默丢字（P3）；有回归测试。
- 焦点在 Ghostty 终端内 `` Ctrl+` `` 可开关抽屉（P1）；`.xterm` fixture 清零。
- `shell:preview-automation-*` 全链删除或经新卡+权限模型重新立项（默认：**删除**）（P2）。
- Files 搜索键击不再触发每条目串行 `git check-ignore` 风暴（P4）。
- reload 后孤儿 PTY 被收割；surfaces persist 无死字段；keep-alive 语义写入卡/handbook（P7）。
- browser-doc 扩展名三表与 work-loops note 一致（P5）；过期 workbench-depth note 改写或归档（P6）。
- P9 组与已采纳的 N* 项按阶段完成或有明确豁免记录。
- QA：`TC-SURF-002/003/005/007`、`TC-TERM-003/004`（及计划内相关）不再无故 N/A；两卡 `last verified` 更新。

**Explicitly not required to close this plan:**

- N4 symlink-swap TOCTOU 重构（见「不修项」）。
- Diff split/wrap/ignore-whitespace、GPU 嵌入、worktree、turn-diff、review-comment pick（合同 out of scope）。

## Global Constraints

- 遵守 Feature Spine：实现 PR 保持在两卡 **Allowed touch** 内；扩围须用户确认（见下表）。
- 改 `vendor/deepseek-harness` 非平凡行为须同步 Agent Note / implemented note。
- Client 包受 per-file 覆盖门约束；测试须钉产线 DOM（Ghostty），不得再钉 `.xterm`。
- 保持官方 `dsh web` 语言；不发明第二套皮。
- Commit 前缀：`feature(surfaces-work-loops): …` / `feature(terminal-drawer): …`。

### Allowed touch 扩围（实施前确认）

| 扩围 | 原因 | 建议归属卡 |
| --- | --- | --- |
| `ui-titlebar`（keybindings / PanelToggles） | P1 快捷键判定 | `terminal-drawer` |
| `src/preload/index.js` | P2 删除 automation 注入 | 两卡 surfaces/terminal 相关注入面 |
| `ui-conversation`（可选） | P8 `appendToDraft` 上移 | 需确认；否则用镜像注释退化方案 |

---

## 一、项目现状（审查结论）

四个工作环（Files 搜索/保存、Browser 导航/录制/Pick、Diff 三点范围/porcelain、Terminal 选区进对话）**主体已实现**。桌面 IPC 授权（`assertIpcSender` HARNESS_ONLY）、`workspace-authority` 限界、preview token/loopback 守卫与测试对齐。空态卡片仅为零 tab 入口；Tab 关闭在标题右侧。Ghostty 为 Canvas 2D，未伪装 GPU 嵌入。

主要债务：**数据丢失竞态（P3）**、**终端内快捷键断裂（P1）**、**无消费者高权限 automation 死链路（P2）**、**搜索性能悬崖（P4）**，以及文档漂移、死字段、reload 孤儿 PTY、部分 QA 未跑。

---

## 二、问题全表（复检结论）

| ID | 严重度 | 复检 | 摘要 |
| --- | --- | --- | --- |
| P3 | **最高** | 仍成立（加重） | `FilePreview.save()` await 后用新 draft 标已保存 → 再激活静默丢字；绕过 `FileSaveCoordinator` 可双写 |
| P1 | 高 | 仍成立 | `keybindings.ts` 仍用 `.xterm`；Ghostty 为 `textarea.t3-ghostty-input`；beforeKey + isTextEntryTarget 双断；测试钉错 DOM |
| P2 | 高（暴露面） | 仍成立 | `preview-automation-*`（含 evaluate/CDP）零消费者；harness renderer（含 marketplace 插件）可触达 |
| P4 | 高 | 仍成立（加重） | 每键全树 walk + 每条目串行 `git check-ignore`；并发 walk 叠加 |
| P7 | 中 | 仍成立（加重） | surfaces store 死字段；关 tab 不 kill（未文档化）；**reload 后孤儿 PTY** |
| P5 | 低–中 | 部分成立 | `.pdf` 未进合同；三表互不一致（xhtml 工具栏缺口） |
| P6 | 低 | 仍成立 | workbench-depth note 仍写 xterm / powershell.exe / `.xterm` |
| P8 | 低 | 仍成立 | `appendToDraft` 三包拷贝（client 禁跨包值导出） |
| P9-copy | 低 | 仍成立 | 复制反馈挂在 Refresh Tooltip |
| P9-cot | 低 | 仍成立 | `TerminalSurface` / test「Task 6」CoT 泄漏 |
| P9-git | 中 | 仍成立 | `SurfacesRoot` gitStatus 仅随 cwd；init 后 Diff 门不刷新 |
| P9-preview-sync | 中 | 仍成立（加重） | `preview-workspace` 主进程 `readFileSync` 无上限 |
| P9-draft | 低–中 | 仍成立 | `DRAFT_MAX_CHARS` 按字符，注释谎称匹配 1MiB 字节上限 |
| P9-qa | 中 | 仍成立 | TC-SURF-002/003/005/007、TC-TERM-003/004 等 N/A |
| N3 | 低 | 新 | `saveRecording` 对 `payload.data` 无字节上限 |
| N4 | 低 | 新 | `resolveInside` realpath 后返回词法路径 — **不修** |
| N7 | 低 | 新 | 截断图片仍渲染裂图 `<img>` |

**范围外核对：** GPU 嵌入 / worktree / turn-diff / review-comment pick / Diff split·wrap·ignore-whitespace — 确认未半实现。桌面壳 vs harness 边界未见破坏。

---

## 三、分阶段实施

### Phase 0 — 数据安全与回归钉错（阻断级）

**交付物：** P3 + P1 修复与测试绿。

#### Task 0.1 — P3 显式保存竞态

**Files:** `vendor/.../ui-files/.../FilePreview.tsx`；`FileSaveCoordinator`（同包）；`ui-files` specs；work-loops note Testing 段。

**Steps:**
- [x] `save()` 开头捕获 `const contents = draftRef.current`；成功后 `setText(contents)`，`writeBuffer` 用写入快照作 text、保留最新 draft。（经 coordinator `onConfirmed` 实现，2026-08-25）
- [x] 显式保存走 coordinator `flush`（或等价互斥），消灭与 debounce 落盘双写。
- [x] Spec：「await 期间注入字符 → dirty 仍 true、reread 不丢字」；「debounce 与显式保存串行」。

**Done when:** 丢字路径从红到绿；disk-diverged `error.changed` 不回归。✅ 2026-08-25

#### Task 0.2 — P1 `` Ctrl+` `` Ghostty

**Files:** `ui-user-terminal`（`TerminalPane` / `handleBeforeKey`）；`ui-titlebar/keybindings.ts`、`PanelToggles`；两处 `.xterm` fixtures。

**Steps:**
- [x] **先确认** `ui-titlebar` Allowed touch 扩围。（已记入 terminal-drawer 卡，2026-08-25）
- [x] `handleBeforeKey` 识别 Ctrl/Cmd+` → `preventDefault` 放行冒泡给标题栏 window 监听器（toggle 在 ui-titlebar，跨包禁 import），走 `suppressedKeyCodes`。
- [x] `keybindings.ts`：`.xterm` → `[data-terminal-pane]`；终端容器内 textarea 对面板快捷键不当纯文本拦截。
- [x] 重写 `keybindings` / `panel-toggles` fixtures 为 `data-terminal-pane` + textarea。

**Done when:** 终端焦点内 `` Ctrl+` `` 开关抽屉；Ctrl+\ 仍送 PTY；composer 内不抢键；全仓产品路径无 `.xterm` 焦点假说。✅ 2026-08-25

---

### Phase 1 — 安全面收敛

**交付物：** P2 删除；preview-workspace 流式+上限；N3 上限。

#### Task 1.1 — P2 删除 automation 全链（默认裁决）

**Files:** `src/main/preview.js`；`src/preload/index.js`；`ui-preview/shell.ts`；`preview.test.js` / `shell-api.test.js`（authorize 计数）。

**Steps:**
- [x] **先确认** preload Allowed touch；产品确认删除（若保留：必须新卡 + 审批/限 loopback/禁 evaluate，否则不可交付）。（默认裁决=删除；扩围记入 surfaces-work-loops 卡）
- [x] 删 8 个 `preview-automation-*` handler 及仅 automation 使用的 debugger 路径（`ensureDebugger` 因 `setColorScheme` 保留）。
- [x] 删 preload 暴露与 client 类型绑定；下调 authorize 通道计数测试（27→19），并钉缺席断言。

**Done when:** 全仓 `previewAutomation|preview-automation` 零匹配（除缺席断言与历史文档）；`npm test` 绿。✅ 2026-08-25

#### Task 1.2 — P9 preview-workspace 阻塞主进程

**Files:** `src/main/preview-workspace.js` + tests。

**Steps:**
- [ ] `readFileSync` → async 流式 `pipeline` + `Content-Length`。
- [ ] 按 MIME 加上限（建议：HTML/文本 8MiB、其余 64MiB；超限 413）。

**Done when:** 大文件请求不阻塞主进程事件循环；测试覆盖 413 与流式路径。

#### Task 1.3 — N3 saveRecording 上限

**Files:** `src/main/preview.js` + tests。

**Steps:**
- [ ] 对 `payload.data` 加字节上限（建议 512MiB），超限返回 message。

**Done when:** 超限测试通过。

---

### Phase 2 — 性能（P4）

**Files:** `src/main/workspace-fs.js`；`FilesPanel.tsx`；对应 tests。

**Steps:**
- [ ] `listDir`：每目录一次 `git check-ignore --no-index --stdin -z` 批量判定。
- [ ] walk 与 `query` 解耦：进入搜索态 walk 一次并缓存；键击仅内存过滤；Refresh 仍 re-walk。
- [ ] in-flight walk 去重。

**Done when:** 万级文件仓库键击无子进程风暴（每目录 ≤1 spawn）；spec 钉「每搜索会话一次 walk」。保持 uncapped 合同语义。

---

### Phase 3 — 可靠性与状态卫生

#### Task 3.1 — P7 死字段 + 孤儿 PTY + 语义文档

**Files:** `ui-surfaces/stores.ts`、`persist.ts`；`src/main/pty.js` / harness webContents 生命周期；`terminal-drawer` 卡 + handbook terminal。

**Steps:**
- [ ] 删除未使用的 `preview.resourceId`、`terminalIds`/`activeTerminalId`；persist 宽容忽略旧字段。
- [ ] harness webContents reload / `render-process-gone` 时对该 sender 名下 PTY `killAll`（勿误杀同 origin 内部导航）。
- [ ] 文档写明：关抽屉/关 tab/切会话不 kill；kill 仅垃圾桶与 app 退出；reload 收割。

**Done when:** reload 后 main sessions 清空；persist 往返无死字段。

#### Task 3.2 — P9 gitStatus 门刷新

**Files:** `SurfacesRoot.tsx`（及 titlebar `gitInit` 成功广播，若采用精确方案）。

**Steps:**
- [ ] `gitInit` 成功后广播事件重探；或 focus / 打开 surface 时重探。

**Done when:** 初始化 Git 后无需切会话即可开 Diff。

#### Task 3.3 — P9 DRAFT_MAX_CHARS

**Files:** `ui-surfaces/persist.ts`。

**Steps:**
- [x] 按字节（`TextEncoder`/`Buffer.byteLength`）与 `MAX_WRITE_BYTES` 对齐语义；修正谎注释。

**Done when:** 1MiB 内 ASCII 大草稿跨重载可恢复。✅ 2026-08-25

---

### Phase 4 — 文档 / 清理

#### Task 4.1 — P5 扩展名单一事实

**Steps:**
- [ ] 统一 `{html, htm, xhtml, svg, pdf}`（补 xhtml 工具栏或从集合移除 — 建议统一含 xhtml+pdf）。
- [ ] work-loops note 补 `.pdf`；修正 `apply.ts` JSDoc。

#### Task 4.2 — P6 workbench-depth

**Steps:**
- [x] 就地改写为 Ghostty / `pwsh` 候选链 / `[data-terminal-pane]`（2026-08-25，选就地改写：note 其余决定仍在指导现状）。

#### Task 4.3 — P8 appendToDraft

**Steps:**
- [ ] 首选：`ui-conversation` 服务公开 `appendToDraft`（**需扩围确认**）。
- [ ] 退化：三份头注互为镜像义务。

#### Task 4.4 — 杂项

**Steps:**
- [ ] 复制反馈独立 toast/标记；Refresh Tooltip 还原。
- [ ] 清除「Task 6」CoT 注释。
- [ ] N7：truncated 图片不渲染 `<img>`，仅提示。

---

### Phase 5 — QA 闭环

**Steps:**
- [ ] 补跑 `TC-SURF-002/003/005/007`、`TC-TERM-003/004`、相关 `TC-CHAT-004`；更新执行报告。
- [ ] 两卡 `last verified` 回写；`npm run qa:source` 通过。
- [ ] 关闭本计划时勾选各 Task Done when。

---

## 四、不修项（显式声明）

| ID | 理由 | 残留风险 |
| --- | --- | --- |
| N4 TOCTOU | 窗口极小；攻击者需已能在工作区内换 symlink；open-fd 重构不成比例 | 已在工作区有写权的攻击者可在极小窗口读区外文件 — 记入 `workspace-authority` JSDoc |

---

## 五、建议 PR 切片

1. **PR-A（Phase 0+1）：** P3 + P1 + P2 删除 + preview-workspace/N3 — 用户可感缺陷与安全减法，耦合低。
2. **PR-B（Phase 2）：** P4 性能。
3. **PR-C（Phase 3）：** P7 + gitStatus + DRAFT。
4. **PR-D（Phase 4+5）：** 文档/清理 + QA 闭环。

实施前阻塞项：三处 Allowed touch 扩围确认 + P2 删除裁决（本计划默认删除）。

---

## 六、File map（实施索引）

| 区域 | 关键路径 |
| --- | --- |
| Files 保存/搜索 | `vendor/.../ui-files`（`FilePreview.tsx`、`FilesPanel.tsx`）、`src/main/workspace-fs.js` |
| 快捷键 | `vendor/.../ui-titlebar`（`keybindings.ts`、PanelToggles）、`ui-user-terminal` |
| Preview / automation | `src/main/preview.js`、`preview-workspace.js`、`src/preload/index.js`、`ui-preview` |
| Surfaces shell | `ui-surfaces`（`SurfacesRoot.tsx`、`stores.ts`、`persist.ts`、`apply.ts`） |
| PTY | `src/main/pty.js`、`ui-user-terminal` |
| 合同 / 卡 | work-loops note；`docs/features/surfaces-work-loops.md`；`docs/features/terminal-drawer.md`；handbook surfaces/terminal |
| QA | `docs/qa/production-acceptance-test-cases.md`；results 执行报告 |
