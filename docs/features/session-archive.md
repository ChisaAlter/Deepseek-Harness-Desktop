# Feature: Session archive

| Field | Value |
| --- | --- |
| **id** | `session-archive` |
| **status** | `active` |
| **last verified** | 2026-08-31 — pin `dsh-v0.1.2-alpha.2`；归档列表接在官方 `rows/WorkspaceBrowser`。`unarchiveSession` 是 `workspace.unarchiveSession` Remote；`deleteSession` 是 `session.delete` Remote（仅已归档请求根，`origin === 'subagent'` 级联，fork 不随根）。`UiWorkspaceService` 不再 stub。持久化缝为 `SessionPersistence.delete`。 |；本次 alpha.4：vendor test:gui 5310/5311（1 skip），桌面 npm test 1461/1463（2 skip），归档回归通过。

## User paths

1. 活会话行 ⋯ → 归档会话：行从工作区/未分组/平铺/搜索消失，日志与工作区 `sessionIds` 槽位保留。
2. 侧栏底部 **已归档**（默认折叠）：点标题展开/收起；展开后点行无动作；⋯ → **取消归档**（不自动打开）或 **删除会话**。
3. 已归档 ⋯ → 删除会话：确认后永久删除该会话日志；工作区文件夹不动。确认后该行不得闪回活列表。
4. 设置 → **界面设置** →「显示已归档列表」（默认开）：关掉后侧栏**完全不渲染**已归档分区；归档能力仍在。要恢复或删除已归档会话，须先重新打开该开关（有意路径，不是死胡同 bug）。

## Invariants

- 活会话菜单只有归档，没有删除。
- 恢复与销毁只出现在「已归档」⋯ 菜单；点已归档行标题/整行不恢复、不打开。
- 不得以归档态打开主视图；须先菜单取消归档，再从活列表打开。
- 「已归档」每次加载默认折叠；展开仅当次会话有效，不写入 persist。
- 显示开关默认开，持久化在 `dsh.workspace.view.v6`；关只藏侧栏分区，不改 `archivedSessionIds`。
- 桌面不另做会话浏览器；走官方 `ui-workspace`。
- 删除只接受已归档的请求根；子 agent（`origin === 'subagent'`）随根删除；fork 不随根删除。
- 删除成功：先发 `api-session/deleted`，再 unarchive；unary ok 时装归档回声并 `applyDeleted`；对话框仍仅当归档集不再含该 id 时关闭。
- 级联半成功：已 gone 的 id 发 `session-deleted`，根仍归档时 RPC 为 `session-delete-partial`（非 ok）。
- 无摘要的归档 id 可显示「缺失会话」占位行（仍有取消归档/删除）；Host 仅在 persist+live 皆无时修剪幽灵归档成员。

## Allowed touch

- `vendor/deepseek-harness/packages/workspace/workspace/`
- `vendor/deepseek-harness/packages/api/session-controller/` / `packages/api/workspace-controller/`
- `vendor/deepseek-harness/packages/client/ui-workspace/`（含 `settings.interface.item` 贡献行）
- `vendor/deepseek-harness/packages/session/session-persistence*`（仅 C2）
- 本卡、QA TC-CHAT-010 / TC-CHAT-013

## Do not touch

- Appearance / 图库 / 市场
- 活会话行上的删除
- Electron / PTY `DSH_HOME`
- 附件 blob GC、message-feedback 级联
- 关显示开关时的紧凑「已归档(N)」入口（会降级卡面）

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor workspace + session/workspace controller + `pnpm run test:gui`（ui-workspace）；可见 UI 另跑 `DSH_SNAPSHOT=replay pnpm run test:web` |
| Manual / QA | `TC-CHAT-010` 取消归档；`TC-CHAT-013` 硬删除（含确认后不闪回活列表）；界面设置开关关后侧栏无「已归档」 |

## Sources

- Spec / plan: [2026-08-23-github-issues-17-18-19.md](../superpowers/plans/2026-08-23-github-issues-17-18-19.md)
- Agent Note: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-07-31-session-archive-global-set.md`
- Delete: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-23-archived-session-delete.md`
