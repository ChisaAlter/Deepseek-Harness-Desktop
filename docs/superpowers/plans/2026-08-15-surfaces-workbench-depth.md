# Surfaces 工作台加深 Implementation Plan

> **对照来源（只读，已删除临时 clone）**：`omdsh-dev/DSH-better-sidebar` v0.12.2。借鉴交互与漏斗，不搬门户、不搬 `/sidebar/api`、不搬 `ctx.betterSidebar`。
>
> **For agentic workers:** 按 Task 顺序落地。每步 checkbox；测红再写实现。同一 PR 写 Agent Note。外观走 `--dsw-*` + `ui-primitives`，禁止平行色板。

**Goal:** 让官方第四列 `surfaces` 成为桌面端文件 / Diff / Agent 的默认落点，补齐 Tab 壳、资源管理器动作、预览分发、Git 工作区操作。Inspect（`details`）、标题栏 Push/PR、底栏终端抽屉、工作区授权根都不动。

**Architecture:** 继续占用 `ui-layout` 的 `surfaces` 列。对话侧所有「打开文件」已经汇到 `ctx.workspaces.openPath`（`ui-conversation` apply 是唯一生产调用方）。在 `ui-surfaces` 的 `apply` 里包装该方法，相对化路径后写入 `createSurfacesStore().openFile` 并 `layout.openSurfaces()`。主进程 IPC 仍只走 `window.shell` + `workspace-authority`。不 portal 到 `document.body`，不新增 host HTTP/WS。

**Tech Stack:** 现有 slot / `defineStore` / CSS Modules；Electron IPC；`writeClipboard`、`Menu`、`MarkdownText` 已在 `ui-primitives`。

## 对照结论（做什么 / 不做什么）

| 对面（better-sidebar） | 我们现在 | 本计划 |
|---|---|---|
| portal 挂 `document.body`，自管宽度 | 占用 `surfaces` 列 | **保持官方列** |
| 包装 `workspaces.openPath` | 聊天点路径走 OS | **同样包装**，桌面且有当前会话才接管 |
| explorer `single`，打开文件另开 editor tab | `openFile` **删掉** files 页 | **树常驻**，文件作并列 Tab |
| Tab `+` 菜单 / 滚轮 / 中键关 | 空态五卡后无法再开第二种 | **Tab 条补 `+`、中键、右键关闭菜单** |
| localStorage `dsh-sidebar:v1:<id>` | 内存 `bySession` | **精简持久化**（只要 surfaces 列表，不要分栏树） |
| `@path` → `conversation.input.setDraft` | 无 | **同样插入**，`ctx.get('conversation')` |
| 图片走 `/sidebar/file` 媒体路由 | `readFile` 遇 NUL 丢字节 | **新 IPC 读媒体字节**（仍锁工作区） |
| Git porcelain + stage/unstage/discard | Diff 只读 unified；标题栏 `add -A` 再 commit | **Diff 页暂存/还原**；标题栏 Commit/Push **行为不变** |
| Agents 拓扑可点 + jobs peek/kill | 只读名单 | **点行 `sessions.open` / `openSubagent`**；jobs 只读列出 |
| 双工作台、拖 Tab 拆栏、任意网页、Office、`terminal_*` | 无 | **不做** |
| 快捷键真注册 | tooltip 文案 | **Ctrl+` / Ctrl+\ 真监听** |

对面已验证、应直接复用的纯函数形态（重写成我们的文件，不拷 CSS/门户）：

- `wrapOpenPath(workspaces, deps)`：保存原方法引用、HMR disposer 写回**同一个**函数，好让其它包装器任意顺序卸载。
- `relativeTo(cwd, absolute)`：大小写不敏感前缀，返回 `/` 分隔相对路径。
- `appendToDraft(ctx, sessionId, text)`：`ctx.sessions.scope` + `ctx.get('conversation').input.for(actx).setDraft`。

## Locked product decisions

1. 打开文件默认进右栏；无当前会话或非桌面（没有 `listDir`）则回落到原来的 OS `openPath`。
2. `files` 单例常驻；每个 `file:<relativePath>` 一页。再点同一路径只 activate。
3. Tab 条 `+` 列出 Browser / Terminal / Files / Diff / Agents；已打开的单例项禁用。空态五卡只在 `surfaces.length === 0`。
4. 不改 `ui-conversation` 的 `openFile` 注入——漏斗在 `workspaces.openPath`。
5. 标题栏 Git 仍是 Commit（`add -A`）/ Push / PR。Diff 页的暂存不影响这条快捷提交。
6. Browser 仍只预览本机回环；本计划不加深 Browser。
7. 可写文件（`writeFile` + Ctrl+S）放最后一档，可单独成 PR；前几档不依赖它。
8. 产品文案中文；注释英文。

## Visual language

Tab `+`、右键菜单、文件行 `@` 都用现成 `Menu` / `Tooltip` / `writeClipboard`。行高 14/22，图标 14–16px `currentColor`，hover `--dsw-alias-interactive-bg-hover`。不要 VS Code 密度，不要对面的 `sidebar.module.css`。

---

### Task 1: 树常驻 + Tab 壳（`+` / 中键 / 右键关闭）

**Files:**

- Modify: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/stores.ts`
- Modify: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/SurfaceTabs.tsx`
- Modify: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/SurfaceTabs.module.css`
- Modify: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/SurfacesRoot.tsx`
- Modify: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/locales.ts`（及 i18n yaml 若有）
- Test: `vendor/deepseek-harness/packages/client/ui-surfaces/tests/surfaces-store.client.spec.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-surfaces/tests/surfaces-root.client.spec.tsx`
- Test: 新建 `vendor/deepseek-harness/packages/client/ui-surfaces/tests/surface-tabs.client.spec.tsx`

**Interfaces:**

`openFile` 不再 `filter(kind !== 'files')`。若没有 files 页，先插入 files 再追加 `file:`（资源管理器在左、文件在右，符合「树还在」）。

`SurfaceTabs` 增加：

```ts
export type SurfaceTabsProps = PropsLocale<typeof NS> & {
  surfaces: readonly Surface[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseToRight: (id: string) => void
  onCloseAll: () => void
  onOpenKind: (kind: OpenableKind) => void
  openable: Readonly<Record<OpenableKind, boolean>>
}
```

- `+`：`Menu` 五项，`openable[kind] === false` 时禁用（files/diff/agents/preview/terminal 已存在）。
- 中键 `button === 1` 关闭该 Tab。
- 右键：关闭 / 关闭其他 / 关闭右侧 / 全部关闭（store 已有后三个 action）。
- 滚轮：非 passive `wheel` 把 `deltaY` 转成横向滚动（对面 `TabBar.tsx` 的做法；React 的 onWheel 是 passive，`preventDefault` 无效）。

- [ ] **Step 1:** store 测试：`openFile` 后仍有 `id: 'files'`，且 `file:src/a.ts` 为 active。跑红。
- [ ] **Step 2:** 改 `openFile`；Tabs UI + 文案。
- [ ] **Step 3:** `pnpm --filter @deepseek-ai/dsh-client-ui-surfaces test` 全绿。
- [ ] **Step 4:** 提交 `fix(ui-surfaces): keep files tab and add surface tab chrome`

---

### Task 2: 包装 `workspaces.openPath` 作为唯一打开漏斗

**Files:**

- Create: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/openpath-intercept.ts`（零 React，可单测）
- Create: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/paths.ts`（`relativeTo`）
- Modify: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/apply.ts`（`inject` 加 `workspaces`、`sessions`；`apply` 内 `createSurfacesStore()` 一次，register 传 handle）
- Test: `vendor/deepseek-harness/packages/client/ui-surfaces/tests/openpath-intercept.client.spec.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-surfaces/tests/paths.client.spec.ts`
- Test: `vendor/deepseek-harness/packages/client/ui-surfaces/tests/apply.client.spec.ts`

**Interfaces:**

对面 `openpath-intercept.ts` 的契约原样适用（不要改 `ui-conversation`）：

```ts
export interface OpenPathService {
  openPath(path: string): Promise<void>
}

export interface OpenPathInterceptDeps {
  takeoverEnabled(): boolean
  currentSessionId(): string | undefined
  openInSurfaces(path: string, sessionId: string): void
}

export function wrapOpenPath(workspaces: OpenPathService, deps: OpenPathInterceptDeps): () => void
```

`apply` 接线：

- `takeoverEnabled`：`typeof window.shell?.listDir === 'function'`（网页 lane 没有桌面 FS，必须 fallthrough，否则 e2e 把打开吞掉）。
- `openInSurfaces`：用当前会话 `cwd` 做 `relativeTo`；相对化失败（路径在工作区外）则 **fallthrough 原方法**，不要静默吞。成功则 `actions.openFile(sessionId, relative)` + `layout.openSurfaces()`。
- `ctx.effect(() => wrapOpenPath(...), 'ui-surfaces: openPath intercept')`。
- 恢复必须写回**原始函数引用**，不是 bind 副本。

对话侧传入的是 `resolveWorkspacePath(cwd, path)` 后的绝对路径。工具行 / 产出文件 / 正文 mention 全部走这一个门，不必再抢 `conversation.chat.turnTail`。

- [ ] **Step 1:** `wrapOpenPath` 单测：接管 / 无 session fallthrough / disposer 恢复 / 包装链卸载顺序。跑红。
- [ ] **Step 2:** `relativeTo` 覆盖 POSIX 与 `C:\` 大小写。
- [ ] **Step 3:** apply 接线；确认 `store:` 传 handle 后 SurfacesRoot 仍拿到同一 store。
- [ ] **Step 4:** 提交 `feat(ui-surfaces): intercept workspaces.openPath into the files surface`

---

### Task 3: 会话级 Tab 持久化 + 快捷键

**Files:**

- Create: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/persist.ts`
- Modify: `vendor/deepseek-harness/packages/client/ui-surfaces/src/client/stores.ts` 或 apply 订阅
- Modify: `vendor/deepseek-harness/packages/client/ui-titlebar/src/client/apply.ts`（或新建 `keybindings.ts`）
- Test: `persist.client.spec.ts`、`keybindings.client.spec.ts`

**Interfaces:**

- localStorage 键：`dsh-surfaces:v1:<sessionId>`。只存 `{ activeId, surfaces }`。未知 `kind`、缺字段的条目丢掉。debounce 写（对面 50–100ms 量级即可）。
- 快捷键在 `ui-titlebar` `ctx.effect` 里 `window` 捕获：`Ctrl/Cmd+\` → `toggleSurfaces`；`Ctrl/Cmd+\`` → `toggleTerminalDrawer`。`input` / `textarea` / `contenteditable` / `.xterm` 内忽略（终端自己要吃 Ctrl+` 的例外：焦点在 xterm 时 **不要** 抢走，让抽屉快捷键只在焦点不在终端时生效——与 tooltip 文案一致：切抽屉，不是终端元键）。

- [ ] **Step 1:** persist round-trip + 垃圾 kind 丢弃测试。跑红。
- [ ] **Step 2:** 实现读写；切会话加载对应桶。
- [ ] **Step 3:** 快捷键；input 内不触发。
- [ ] **Step 4:** 提交 `feat(ui-surfaces): persist tabs and honor panel keybindings`

---

### Task 4: Files 行动作（`@`、复制路径、刷新）

**Files:**

- Create: `vendor/deepseek-harness/packages/client/ui-files/src/client/draft.ts`（`appendToDraft`，对面 `conversation-draft.ts`）
- Modify: `FileTree.tsx` / `FilesPanel.tsx` / `FileTree.module.css` / locales
- Modify: `ui-files/src/client/apply.ts`（`inject` 加可选 conversation 读取，不要 value-import ui-conversation）
- Test: `files-panel.client.spec.tsx`、新建 `draft.client.spec.ts`

**Interfaces:**

```ts
export function appendToDraft(ctx: ClientContext, sessionId: string, text: string): boolean
```

行尾 hover 出 `@文件` 按钮：插入 `` `@${relativePath}` ``（对面用空格拼接；沿用）。右键 `Menu`：复制相对路径、复制绝对路径（`join(cwd, relative)`，正斜杠展示）。工具条刷新：清空 `childrenByPath` 再 `listDir` 根。

`writeClipboard` 已在 primitives。成功后短时「已复制」文案，对面 `COPIED_MS = 1200`。

- [ ] **Step 1:** 树测试：点击 `@` 调用 stub；右键复制。跑红。
- [ ] **Step 2:** 实现；`ctx.get('conversation')` 缺失时 `@` 为 no-op（网页无 composer 也不崩）。
- [ ] **Step 3:** `pnpm --filter @deepseek-ai/dsh-client-ui-files test`
- [ ] **Step 4:** 提交 `feat(ui-files): reference, copy path, and refresh`

---

### Task 5: 预览分发（图 / Markdown / 文本）

**Files:**

- Modify: `src/main/workspace-fs.js`、`workspace-fs.test.js`、`src/main/ipc.js`、`src/preload/index.js`
- Modify: `ui-files/src/client/shell.ts`、`FilePreview.tsx`、`FilePreview.module.css`、locales
- Test: `file-preview.client.spec.tsx`（新建）、`workspace-fs.test.js`

**Interfaces:**

现有 `readFile` 对 NUL 返回 `{ binary: true, text: '' }`，图片无法显示。新增：

```js
async function readFileMedia(cwd, relativePath)
// { ok, message?, mime?, base64?, truncated? }
```

- 仅允许图片扩展：`png jpg jpeg gif webp svg bmp ico avif`。其它扩展拒绝（不要当通用二进制下载器）。
- 走 `resolveInside`；上限与 `MAX_READ_BYTES` 相同（512KiB）。超限 `truncated: true` 仍返回头。
- `FilePreview`：扩展名分发——图片用 `data:<mime>;base64,...`；`.md` 用 `MarkdownText`（必传 `codeLabels` 的 copy/copied，对面踩过漏传回退中文的坑）；否则 `<pre>`。二进制非图片保持现有 stub。

本档 **不上** CodeMirror、PDF、Office、HTML 沙箱 iframe。

- [ ] **Step 1:** `readFileMedia` 测试：工作区内 png ok；`..` 拒绝；`.ts` 拒绝。跑红。
- [ ] **Step 2:** IPC + preload + FilePreview。
- [ ] **Step 3:** 包测 + `node --test src/main/workspace-fs.test.js`
- [ ] **Step 4:** 提交 `feat(ui-files): preview images and markdown`

---

### Task 6: Agents 可点 + 只读 jobs

**Files:**

- Modify: `ui-agents-panel/src/client/AgentsPanel.tsx`、`apply.ts`、`agents.ts`、locales
- Test: `agents-panel.client.spec.tsx`

**Interfaces:**

inject：

```ts
openAgent: (id: SessionId) => void
```

`apply`：`ctx.sessions.open(id)`。若行来自 catalog child，优先 `ctx.sessions.openSubagent({ parentId, agentId })`（对面 SubagentView 点卡片就是跳转录）。同一面板用 `useSessions(s => s.jobsBySession[sessionId])` 列 jobs：标签、running、退出码。本档 **不** 做强杀、不轮询 transcript tail、不注入 `terminal_*`。

- [ ] **Step 1:** 空名单 / 有 child 点击调用 `openAgent`。跑红。
- [ ] **Step 2:** 实现行按钮 + jobs 只读块。
- [ ] **Step 3:** 提交 `feat(ui-agents-panel): open child sessions and list jobs`

---

### Task 7: Diff 点进文件 + 工作区暂存 IPC

**Files:**

- Modify: `src/main/git.js`、`git.test.js`、`ipc.js`、`preload/index.js`
- Modify: `ui-surfaces`：`surfaces.diff` owner 增加 `openFile(relativePath)`（与 files 相同，从 SurfacesRoot 传入）
- Modify: `ui-diff` DiffPanel / shell / locales
- Test: `diff-panel.client.spec.tsx`、`git.test.js`

**Interfaces:**

主进程（全部 `asCwd` + 路径 `resolveInside`；`git add/reset/checkout -- <path>` 的 path 必须相对仓库根且不能逃出工作区）：

```js
gitStage(cwd, relativePath)    // git add -- <path>
gitUnstage(cwd, relativePath)  // git reset -q -- <path>
gitDiscard(cwd, relativePath)  // git checkout -- <path>
gitStatusEntries(cwd)          // porcelain v1 -z → { path, xy }[]
```

解析可移植对面 `parsePorcelainZ`（rename 跳过 origin 字段）。`gitCommit` **不要改**（标题栏继续 `add -A`）。

Diff 页：

- 文件名可点 → `openFile(path)`。
- 若有 porcelain：分「已暂存 / 未暂存」两组；行上暂存、取消暂存、还原（还原用 `Modal` 确认，对面 GitView 同款）。
- 刷新按钮（mount + 窗口 focus，无 watcher）。
- 无 porcelain 时保持今天的 unified hunk 列表（IPC 旧宿主也能看）。

- [ ] **Step 1:** `parsePorcelainZ` + stage 路径逃逸拒绝。跑红。
- [ ] **Step 2:** IPC；DiffPanel UI。
- [ ] **Step 3:** `pnpm --filter @deepseek-ai/dsh-client-ui-diff test` + `node --test src/main/git.test.js`
- [ ] **Step 4:** 提交 `feat(ui-diff): open files and stage from the diff surface`

---

### Task 8:（可拆 PR）文本可写

**Files:** `workspace-fs.js` `writeFile`（tmp + `rename` 原子写，对面 host `index.ts` 同款）；preload；FilePreview 文本/Markdown 编辑 + Ctrl/Cmd+S；脏标记可只做标题 `*`。

仍锁工作区；拒绝二进制。本 Task 不是前 7 档的阻塞。

---

### Task 9: Agent Note + 组装断言

**Files:**

- Create: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-15-surfaces-workbench-depth.md`（+ zh + i18n yaml）
- Modify: 各包 README Known Limitations（删掉已落地的「只读树 / 纯文本预览 / Agents 只读」）
- Modify: `apps/web/tests/desktop-chrome.e2e.ts`：打开右栏 → 点 Files 卡 → 断言 Tab 条有 Files 且有 `+`；网页 lane 没有 `listDir`，**不要**断言 openPath 接管。

- [ ] **Step 1:** Note 写现在时：漏斗、树常驻、IPC 边界、不做清单。
- [ ] **Step 2:** `DSH_SNAPSHOT=replay pnpm run test:web` 中 desktop-chrome；有意的 Tab 文案变化才 `refresh`。
- [ ] **Step 3:** `pnpm run test:gui` 覆盖触及的 client 包。
- [ ] **Step 4:** 提交 `docs: surfaces workbench depth note and snapshots`

## 验证总表

| 档 | 命令 |
|---|---|
| 1–4, 6 | `pnpm --filter @deepseek-ai/dsh-client-ui-surfaces test` 以及 files / agents-panel |
| 5, 7 | 上表 + `node --test src/main/workspace-fs.test.js src/main/git.test.js` |
| 组装 | `DSH_SNAPSHOT=replay pnpm run test:web`（desktop-chrome） |
| 真机 | 桌面打开工作区：聊天里点工具行路径应打开右栏文件页；树还在；标题栏 Commit 仍能提交全部 |

## 明确不做（防止范围膨胀）

- 预装或依赖 `dsh-better-sidebar`
- `document.body` portal、自管面板宽度、「位置兼容模式」
- 底栏第二工作台（已有 `shell.terminalDrawer`）
- 拖 Tab 拆 `surfaces` 列（终端内部 split 已有）
- `registerTab` / 文件 viewer 注册表（六个 child slot 就是扩展点）
- 任意 HTTPS iframe、localhost 以外的 Browser
- PDF / Office / HTML 沙箱预览
- 给模型注入 `terminal_*`
- 文件 watcher、Git push/pull 进侧栏、改标题栏 `gitCommit` 语义
- 改 `details` / Inspect / 左栏信息架构
