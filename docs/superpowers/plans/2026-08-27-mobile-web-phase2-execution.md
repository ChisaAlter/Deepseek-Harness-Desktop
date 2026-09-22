# Mobile/Web Phase 2 执行计划 — P1 远程工作环

Date: 2026-08-27

Feature: `mobile-remote`

Base: `cursor/mobile-web-phase1-ed5c`（Phase 1：分页、生命周期、审批、模型、slash、富时间线、`tools/mobile-web-qa` harness）

Work branch: `cursor/mobile-web-phase2-ed5c`

## 范围（来自差距分析 Phase 2，全部必做）

1. **Files 工作环**：目录下钻 + breadcrumb 导航（目录点击=导航，不再插入 `@path`）；文件点击=只读预览（`readFile`，text / image / binary / too-large / error 各有明确状态）；路径搜索走 `getDirectorySuggestions`（明示不是内容搜索）；「插入到输入框」是显式用户动作。无写入/保存 RPC。
2. **Diff 工作环**：`getCheckoutDiff` 只读 diff，支持 `uncommitted` 与 `base` 两个 scope；文件列表（增删行数、new/deleted 标记）+ hunk 视图；区分 non-git、空 diff、加载失败、per-file binary / too_large。无 Stage / Unstage / Discard。
3. **MCP / Skills 只读清单**：`listAgentMcpServers` / `listAgentSkills`；显示全局启用状态、来源/scope、错误；本阶段无任何写配置操作。

## 协议证据（vendored `@chisacode/{client,protocol}`；bundle 已 grep 确认含全部方法，无需重打包）

| 能力 | RPC / schema | 证据 |
| --- | --- | --- |
| 目录列表 | `listDirectory(cwd, path)` → `{ path, entries[{name,path,kind:'file'\|'directory',size,modifiedAt}] }`；payload.error / 缺 directory 由 client 抛错 | `daemon-client-workspace-commands.ts:90`、`workspace/messages.ts` `FileExplorerEntrySchema` |
| 文件读取 | `readFile(cwd, path)` → `FileReadResult{bytes:Uint8Array,mime,size,path,kind:'text'\|'image'\|'binary',modifiedAt}`；binary frame 优先，legacy base64 兜底；daemon 侧 >64MB（`MAX_FILE_TRANSFER_BYTES`）直接 error | `daemon-client.ts:1372`、`daemon-client-file-transfer.ts`、server `file-explorer/service.ts:193` |
| 路径搜索 | `getDirectorySuggestions({query,cwd,includeFiles,includeDirectories,matchMode:'fuzzy',limit≤100})` → `payload{directories[],entries[{path,kind}](optional,default []),error}` | `daemon-client-checkout-commands.ts:374`、`workspace/messages.ts:531` |
| Diff | `getCheckoutDiff(cwd,{mode:'uncommitted'\|'base',baseRef?})` → `{cwd,files[ParsedDiffFile],error:CheckoutError\|null}`；one-shot（内部 subscribe→立即 unsubscribe）；`ParsedDiffFile{path,isNew,isDeleted,additions,deletions,hunks[{oldStart,oldCount,newStart,newCount,lines[{type:'add'\|'remove'\|'context'\|'header',content,tokens?}]}],status?:'ok'\|'too_large'\|'binary'}`；`CheckoutError{code:'NOT_GIT_REPO'\|'NOT_ALLOWED'\|'MERGE_CONFLICT'\|'UNKNOWN',message}` | `daemon-client.ts:1156`、`daemon-client-checkout-subscriptions.ts:91`、`checkout/messages.ts:199-228,391` |
| MCP 清单 | `listAgentMcpServers()` → `payload{scopes,servers[{name,label?,description?,source:'system'\|'user',removable,editable,config{type:'stdio'\|'http'\|'sse',…},statusByScope{global,providers{},agents{}},errors[]}],policy,errors[]}` | `daemon-client-agent-extension-commands.ts:104`、`agent/extensions.ts:324-349` |
| Skills 清单 | `listAgentSkills()` → `payload{scopes,skills[{name,description?,sources[{id,type:'project'\|'agents-home'\|'codex-home'\|'claude-home'\|'bundled'\|'unknown',path,removable}],statusByScope{global,providers{},agents{}},errors[]}],policy,errors[]}` | 同上 `:47`、`agent/extensions.ts:216-258` |

**Diff 订阅决策（诚实标注）**：`subscribeCheckoutDiff` 存在但需要跨 pane 生命周期管理（打开订阅/关闭反订阅/重连 resubscribe）。本轮 Diff 是设置 overlay 内的按需查看面，采用 `getCheckoutDiff` one-shot + 显式「刷新」；实时订阅归 Phase 3（与差距分析「Git 状态实时更新 ⚠️ P2」同批）。不算降级：差距分析验收只要求只读 file/hunk 视图与状态区分。

**预览大小上限（产品决定）**：daemon 上限 64MB 对手机预览过大。目录条目自带 `size` → 文件 >2MB（`PREVIEW_MAX_BYTES`）不发起 `readFile`，直接显示「文件过大」状态（含真实大小）；搜索结果无 size，先 `readFile` 后按 `result.size` 同一上限拦截渲染。文本预览渲染上限 200KB（超出截断并明示）；图片用 Blob URL 渲染，离开预览时 revoke。

## 模块设计

### 新增 `mobile/web/chisacode/files.js`（Files 工作环 adapter，纯逻辑）

- `listDirectoryView(client, cwd, path)` → `{ path, entries }`：目录优先、按名排序；entry `{name, path, kind, size}`（path 规范为相对 cwd、无尾斜杠）。client 抛错原样上抛。
- `breadcrumbSegments(path)` → `[{label:'根目录',path:''}, {label:'src',path:'src'}, …]`。
- `parentPath(path)` → 上一级（根 → `''`）。
- `searchWorkspacePaths(client, cwd, query, {limit=30})` → `getDirectorySuggestions({query,cwd,includeFiles:true,includeDirectories:true,matchMode:'fuzzy',limit})`；payload.error 抛错；优先 `entries`（带 kind），旧 daemon 无 entries 时回退 `directories`（kind:'directory'）；空 query 抛本地错（不发 RPC）。
- `previewSizeGate(size)` → `size > PREVIEW_MAX_BYTES`。
- `classifyFilePreview(result)`（纯函数，入参 FileReadResult 形状）→ `{kind:'too-large',size}` | `{kind:'binary',size,mime}` | `{kind:'image',mime,bytes,size}` | `{kind:'text',text,truncated,size}`（TextDecoder 解码，>200KB 截断）。
- `readFilePreview(client, cwd, path)` → `readFile` + `classifyFilePreview`；错误上抛（调用方进 error 状态）。
- `fileSizeLabel(size)` → `'532 B' / '1.2 KB' / '3.4 MB'`。

### 新增 `mobile/web/chisacode/diff.js`（Diff 工作环 adapter，纯逻辑）

- `fetchMobileDiff(client, cwd, scope)`（scope ∈ `'uncommitted'|'base'`）→ `client.getCheckoutDiff(cwd,{mode:scope})` → `diffViewState(payload)`。
- `diffViewState(payload)` → 判别：
  - `payload.error.code==='NOT_GIT_REPO'` → `{kind:'non-git'}`
  - 其他 error → `{kind:'error', message}`（保留 daemon 原文）
  - `files.length===0` → `{kind:'empty'}`
  - 否则 `{kind:'files', files:[diffFileView…]}`。
- `diffFileView(file)` → `{path,isNew,isDeleted,additions,deletions,status('ok'|'too_large'|'binary'),hunks:[{header:'@@ -a,b +c,d @@',lines:[{type,content}]}]}`；异常形状过滤不崩。
- `diffScopeLabel(scope)`；`diffFileBadge(file)`（新增/已删除/二进制/过大）。

### 新增 `mobile/web/chisacode/extensions.js`（MCP / Skills 只读清单 adapter）

- `listMobileMcpServers(client)` → `listAgentMcpServers()` → `{rows:[{name,label,description,transport('stdio'|'http'|'sse'),source('system'|'user'),status,enabled,overrides,errors[]}], errors[]}`；`enabled = statusByScope.global==='enabled'`；`overrides` = provider/agent 级覆盖计数（只读提示「N 处按提供方/会话覆盖」）。
- `listMobileSkills(client)` → `listAgentSkills()` → `{rows:[{name,description,status,enabled,sources:[{type,path}],errors[]}], errors[]}`。
- `extensionStatusLabel(status)` → `'enabled'→'已启用'`、`'global-disabled'→'已全局停用'`、`'provider-enabled/-disabled'→'按提供方启用/停用'`、`'agent-enabled/-disabled'→'按会话启用/停用'`、未知 → 原文。
- `skillSourceLabel(type)` → project→'项目'、agents-home→'AGENTS 主目录'、codex-home→'Codex 主目录'、claude-home→'Claude 主目录'、bundled→'内置'、unknown→'未知来源'。
- payload 顶层 `errors[]` 非空时随 rows 一并返回（UI 显示提示条，不吞）。

### `app.js` / `app.css` / `ui/settings-hub.js` 接线

- state 新增：`filesPane {path, entries, loading, error, preview, search, scrollTops}`、`diffPane {scope, state, loading, openPaths}`、`extPane {mcp, skills}`（按 pane 缓存 + 刷新按钮）。
- 工作区 pane「更改」tab = Diff 工作环：scope segmented（未提交 / 对比主干）→ 文件行（路径 + `+a −d` + badge）→ 点击展开 hunk（`<details>` 语义，add/remove/context 行着色）；non-git / 空 / error（含重试）各一个状态节点。**不出现** Stage/Unstage/Discard/保存按钮。
- 「文件」tab（及独立「文件」pane 同一实现）：breadcrumb 条 + 搜索框 + 条目列表。目录行点击 → `loadFilesPath(path)`（导航，不插入）；文件行点击 → 预览视图（路径 + 大小 + 「插入 @路径 到输入框」按钮 + 内容区）；行尾「@」小按钮 = 快速插入（文件与目录都可）。返回导航恢复该层滚动位置（`scrollTops` per path）。搜索框输入 ≥1 字符防抖 250ms 调 `searchWorkspacePaths`，结果行：目录 → 导航；文件 → 预览；行尾「@」插入；搜索区顶部固定说明「按路径匹配（daemon 模糊建议），不是内容全文搜索」。
- 预览状态：loading / text（`<pre>` + 截断提示）/ image（blob URL，撤销时机 = 离开预览）/ binary（「二进制文件，请在电脑端打开」）/ too-large（真实大小 + 上限说明）/ error（daemon 原文 + 重试）。全部 `textContent` 渲染，无 innerHTML。
- MCP / 技能 pane：`transport==='chisacode'` 时渲染只读清单（名称、描述、transport/来源、状态 label、错误行、payload 级 errors 提示条 + 「管理请在电脑端」说明 + 刷新）；HTTP 传输保持原「在电脑上打开」占位。`settings-hub.js` 的 desc 在 chisacode 下改为「只读清单 · 电脑端管理」（`settingsGroups` 加 `remoteReadOnly` 参数）。
- 旧 `renderFilesInto` 根目录平铺 + `loadFiles`/`state.fileEntries`/`fileQuery` 仅保留给非 chisacode 传输；`parity.js` 的 `listMobileDirectory` 被 `files.js` 取代后删除（同步删测试）。

## 不做（出界，与差距分析一致）

Files 写入/保存（无 RPC + 产品禁止）、内容全文搜索（无 RPC；不得借 terminal/agent 模拟）、Stage/Unstage/Discard（无 RPC）、`subscribeCheckoutDiff` 实时流（Phase 3）、MCP/Skills 任何写操作（policy patch / install / uninstall / upsert / delete，Phase 3 需安全 UX）、Browser surface、终端、marketplace、dsh-im、HTTP v1（`callUnary`/`callShell`/`/__remote__/*` 不新增调用点）。

## 验收标准

- [ ] 目录点击只导航（不插入 mention）；breadcrumb 可回到任意上层；返回后滚动位置恢复。
- [ ] 文件点击进入只读预览：text / image / binary / too-large / error 五态齐备且文案明确；插入路径是显式按钮。
- [ ] 搜索由 `getDirectorySuggestions` 提供（QA 断言 RPC 调用与参数）；结果可定位（导航/预览）并可插入；UI 明示不是内容搜索。
- [ ] Diff：`uncommitted` 与 `base` 均可加载；non-git、空 diff、加载失败、per-file binary/too_large 各有明确状态；hunk 行着色渲染。
- [ ] 页面不出现 Save / Stage / Unstage / Discard 按钮（kill-list grep + QA DOM 断言）。
- [ ] MCP / Skills 只读清单显示 scope/来源与启用状态；无写配置调用（QA 断言零 upsert/patch/install/delete 调用）。
- [ ] `node --test "mobile/web/**/*.test.js"` 全绿（121 基线 + 新增）；`src/main/chisacode-remote.test.js` 不回归。
- [ ] 浏览器 fake-daemon QA 扩展 ≥19 项新检查全绿；截图落 `docs/qa/results/2026-08-27/`。

## 测试策略

1. **单测（node:test + fake client）**：`files.test.js`（listDirectoryView 排序/规范化、breadcrumb、parentPath、search 映射+fallback+error、classifyFilePreview 四态+截断、sizeLabel、previewSizeGate）、`diff.test.js`（diffViewState 四态、hunk header、badge、异常形状）、`extensions.test.js`（状态映射、来源 label、overrides 计数、payload errors 透传）、`parity.test.js` 删 listMobileDirectory 用例。
2. **浏览器集成（tools/mobile-web-qa）**：fake daemon 增加内存文件树（嵌套目录、text/image/binary/too-large 文件）、getDirectorySuggestions、getCheckoutDiff（per-scope 可注入 non-git/空/错误/文件集）、listAgentMcpServers/listAgentSkills；run-qa.mjs 新增 Phase 2 检查（目录导航、breadcrumb、滚动恢复、五种预览态、插入、搜索、diff 两 scope + 状态 + kill-list DOM 断言、MCP/Skills 清单 + 零写调用）。
3. **BLOCKED（真机）**：真实 relay 配对下的 listDirectory/readFile/diff/MCP 走查需要 Trent 桌面在线；与 Phase 0/1 相同记入 QA 报告 BLOCKED 矩阵。

## 文件 touch list

- 新增：`mobile/web/chisacode/{files,diff,extensions}.js` + 各自 `.test.js`
- 修改：`mobile/web/chisacode/parity.js`（删 listMobileDirectory）+ `parity.test.js`、`mobile/web/ui/settings-hub.js`、`mobile/web/{app.js,app.css}`、`tools/mobile-web-qa/{fake-daemon-client.mjs,run-qa.mjs}`
- 文档：`docs/features/mobile-remote.md`、`docs/handbook/flows/remote-pair.md`、`docs/qa/results/2026-08-27/mobile-web-phase2.md`、本计划

均在 `mobile-remote` 卡 Allowed touch 内。

## 风险与对策

- **bundle 覆盖**：已 grep 确认 bundle 含 `listDirectory/readFile/getDirectorySuggestions/getCheckoutDiff/listAgentSkills/listAgentMcpServers` 与对应 wire type；无需重打包。
- **readFile 二进制帧**：client 内部处理 binary frame / legacy base64，SPA 只见 `FileReadResult`；fake daemon 直接返回同形状对象即可等价。
- **大文件误触**：目录态用 entry.size 预拦截；搜索态 fetch 后按 result.size 拦截渲染（网络成本明示为已知代价，daemon 上限 64MB 兜底）。
- **blob URL 泄漏**：预览切换/关闭时 revokeObjectURL；QA 断言预览 img src 为 blob:。
- **diff token 渲染**：`tokens` 里的 style 是桌面 highlighter 类名，手机端无对应样式表 → 只用 `content` 纯文本 + add/remove/context 行级着色，不伪造语法高亮。
- **非 git cwd**：checkout error code 判别（NOT_GIT_REPO）而不是字符串匹配 message。
- **MCP/Skills 空清单**：空数组是合法状态（「电脑端没有配置 MCP 服务器 / 技能」），不是错误。
