# 插件市场第一轮：精选目录 + 一键安装 + 设计规范

依据 [docs/superpowers/specs/2026-08-18-marketplace-parity-design.md](../specs/2026-08-18-marketplace-parity-design.md)。本轮只做第 1 阶段。

工作目录：本 git worktree 根（`feat/marketplace-parity`）。Windows 上用 `node --test`；vendor 客户端测试在 `vendor/deepseek-harness` 下跑 `pnpm exec vitest run packages/client/ui-settings-plugin-inventory`。

TDD 强制：每个任务先写失败测试并跑红，再写生产代码。不要先改实现再补测试。

## Global Constraints

- 不要预装或 vendor `dshmarket`。不要抄 `src/renderer/marketplace/marketplace.css` 或 dsh-market 皮肤。
- 前端只用 `ui-primitives`（Input / Button / Modal / Menu）和 `--dsw-alias-*`。产品文案中文，注释英文。
- Host 的 `installPlugin(spec)` / `src/host/install-dsh-plugin-client.js` 的 `isValidGithubSpec` **不得放宽**，仍 github-only，不含 `#path:`。
- 市场安装规格与 dsh-market `installTargetFor` 相同：合法 `npm` 字段，否则从 GitHub URL 得到 `github:` / `#path:`。`install` 最后 token 只在它已是允许规格时作为回退。禁止用 `isValidGithubSpec` 去验证 `#path:` 规格。
- 允许的市场规格仅：该行 npm 包名（`isValidPackageName`）；`github:owner/repo`；`github:owner/repo#<gitRef>`（现有 git ref 规则）；`github:owner/repo#path:/<posix>`（`path:/` 后无 `..`、无 `:`、无反斜杠；owner/repo 与该行 `url` 解析出的 GitHub 仓库一致）。
- 渲染层只传目录 `id`（`owner/name`，name 可含 `#`，例如 `DamonKoy/dsh-web-ui#dsh-aionui-panel`）。
- `listMarketplace({ refresh?, locale? })`：`locale` 为 `zh` | `en`，默认 `zh`；`zh*` → `zh`，否则 `en`。
- 磁盘缓存 `CACHE_VERSION` 3，TTL 1 小时；回退内存 → 磁盘 → 入库快照。`source` 为 `live` | `cache` | `snapshot`；非 live 必须带 `warning`。不要搜 GitHub `topic:dsh-plugin`。
- 安装互斥：同时只跑一个 `dsh plugin add/remove`；第二次调用立刻返回忙碌错误。
- add 成功后检查 `$DSH_HOME/profiles/web/node_modules/<name>`：有 `package.json`，且含 `dsh.bundle.patch` 或可解析的 `dsh.client` / 包 `main` 入口文件存在。否则 `remove` 并失败。`ok: false` 时 IPC 不得 `startHarness()`。
- `DROPPED` 对 id 和算出的包名都要比。
- 浏览页：过滤结果超过 60 条只渲染前 60，「显示更多」每次 +60；搜索/换分类重置窗口。
- 分类芯片超过两行用「展开」，不要无限换行；gap/padding 用 4 的倍数（8/12/16/24，去掉 6/10/18）。
- Modal 关闭用 `aria-hidden` / `queryByRole`，不断言立刻卸载。不要用原生 `<select>`（测试不要 `combobox`）。
- 确认框必须展示将要执行的 spec。不要另做 TUI 警告。本轮不做 npm registry 反查。
- 不要把无关的 `apiproxy` 测试改动带进本分支。不要 push。

## 对抗性审查覆盖 spec 的句子（已裁定）

- spec 字段表写「有 npm 用 npm 包名，否则解析 github」过粗，曾裁定 last-token。**现已改回与 dsh-market `installTargetFor` 对齐**：合法 npm 字段，否则 GitHub URL → `github:` / `#path:`；last-token 只作允许规格的回退。这样 Release `.tgz` `install` 命令仍走 github，不会把 tarball 送进 CLI。
- spec 写 Harness 未就绪只显示主窗：**记下待跳转，Harness 第一次就绪后再跳设置 → 插件市场**。

---

## Task 1: Rewrite marketplace catalog from plugins.json

重写 [src/main/marketplace-catalog.js](../../../src/main/marketplace-catalog.js)。删除 [src/main/marketplace-categories.js](../../../src/main/marketplace-categories.js) 和 [src/main/marketplace-categories.test.js](../../../src/main/marketplace-categories.test.js)。新增 [src/main/marketplace-catalog.test.js](../../../src/main/marketplace-catalog.test.js) 和入库快照 [src/main/marketplace-registry-snapshot.json](../../../src/main/marketplace-registry-snapshot.json)。

**不要**改 IPC、preload、窗口、`marketplace-install.js`（除了 catalog 仍需导出 `resolveCommitSha`，install 已依赖它）。`token` 参数可忽略。

### 行为

- 拉取 `https://awesome-dsh-plugin.com/plugins.json`。测试用 `DSHD_MARKETPLACE_REGISTRY_URL` 指向 http fixture（`http://127.0.0.1` mock `fetch` 即可）。渲染层不能设这个变量。
- 超时 4 秒（AbortController）。成功响应必须是带**非空** `plugins` 数组的对象，否则当失败。
- 缓存存**原始 registry JSON** + `fetchedAt` + `CACHE_VERSION` 3，路径仍 `app.getPath('userData')/marketplace-cache.json`。TTL **1 小时**。忽略 version≠3 的旧缓存。locale 在读取时映射，这样换语言不必重拉。
- 回退：当前内存 registry → 磁盘缓存 → 打包快照。每一层都空：`ok: false`、`items: []`、可见 `warning`。`source`: 成功在线为 `live`；命中内存/磁盘为 `cache`；快照为 `snapshot`。
- 快照是小型合法 `plugins.json`（约 6–10 条即可）：至少覆盖 npm 包、纯 `github:owner/repo`、`#path:` monorepo、deprecated、以及一条 `npm` 等于现有 `DROPPED` 之一（`@dsh-external/dsh-genui` 或 `@huanlin/dsh-plugin-yet-another-subagent`）。不要把 1300 条塞进单测或快照。
- 保留 `resolveCommitSha(owner, repo, ref, token)`（仍打 GitHub commits API）。删除 `SEARCH_QUERY`、GitHub topic 搜索、`classifyPlugin` 导出。

### 映射（每条 plugin → MarketplaceItem）

| 字段 | 规则 |
| --- | --- |
| `id` | `owner/name`（name 可含 `#`） |
| `owner` | `owner` |
| `repo` | `name` |
| `description` | `description[locale]`，否则 `description.en`，否则 `''` |
| `stars` | `stars` 或 `0` |
| `packageName` | `npm` 或 `''` |
| `homepage` | `url` |
| `installSpec` | 与 dsh-market `installTargetFor` 相同：合法 npm 字段，否则 GitHub URL → `github:` / `#path:`；last-token 只在已是允许规格时回退 |
| `isBundle` | `true`，除非 `deprecated === true` |
| `category` | registry 的 `category` |
| `added` | `added` |
| `deprecated` | `deprecated` |
| `replacement` | `replacement` |
| `screenshots` | `screenshots` 或 `[]` |
| `npm` | `npm` 或 `null` |

分类：`[{ id: 'all', label: locale 下「全部」/ `All`, count: 可见条数 }, ...registry.categories 按 registry 对象键顺序，label 取该 locale，count 为该 category 可见条数]`。不要 keyword 分类，不要塞空的旧类（learn 等）。

列表过滤：`DROPPED` 命中 `id` **或** `packageName` 的条目不出现在 `items`。

导出 `getMarketplacePlugin(id)`：不联网，按 内存 → 磁盘 → 快照 查找原始行并映射（locale 默认 `zh`），找不到返回 `null`。给 Task 2 用。

### 测试（必须先红）

用 `config.test.js` 的 electron `require.cache` mock（`app.getPath('userData')` 指向 tmpdir）。mock `globalThis.fetch`。每测后清模块缓存以免串状态。

覆盖：

1. live 映射：fixture 含 npm 行、`github:owner/repo` 行、`github:owner/repo#path:/packages/foo` 行；`installSpec` 分别为 `dsh-composer-expand`、`github:01Virex/dsh-status-rotator`、`github:DamonKoy/dsh-web-ui#path:/packages/dsh-aionui-panel`（或 fixture 里同等 token）；`id` 为 `owner/name`。
2. `locale: 'zh'` 用中文简介和分类标签；`locale: 'en'` 用英文；默认 `zh`；`locale: 'zh-CN'` 当 `zh`。
3. fetch 超时/抛错且无缓存时用快照，`source === 'snapshot'`，有 warning；`ok: true` 若快照非空。
4. 内存/磁盘优先于快照；`refresh: true` 跳过 TTL 重新 fetch。
5. 空 `plugins: []` 或非对象不当 live。
6. DROPPED 包名不出现在 items；`getMarketplacePlugin` 对 DROPPED id 仍可查到行（或按你实现：查找原始行不过滤也可以，但 list 必须过滤）。**裁定：list 过滤；getMarketplacePlugin 返回原始映射行（含 dropped），以便 install 拒绝。**
7. 断言 fetch URL 不是 `api.github.com/search`。
8. 旧 `CACHE_VERSION` 2 磁盘文件被忽略。

跑：`node --test src/main/marketplace-catalog.test.js`。通过后再 `node --test src/main/marketplace-categories.test.js` 应因文件已删而不存在——不要留这个测试文件。再跑 `node --test src/main/marketplace-install.test.js` 确认 `resolveCommitSha` 导出没把 install 测弄挂。

提交本任务文件。提交说明写清为何改为 curated registry。

---

## Task 2: Add installMarketplacePlugin(id)

在 [src/main/marketplace-install.js](../../../src/main/marketplace-install.js) 新增 `installMarketplacePlugin(id, options)`。更新 [src/main/marketplace-install.test.js](../../../src/main/marketplace-install.test.js)。

**不要**改 IPC/preload/UI。`installPlugin(spec)` 保持 github-only（继续 `isValidGithubSpec`）。不要改 `src/host/install-dsh-plugin-client.js`。

### 行为

1. `id` 必须非空字符串。用 Task 1 的 `getMarketplacePlugin(id)` 查找；未知 id → `{ ok: false, error }`（中文，含「未收录」之类），不 spawn。
2. 规格 = 该行 `installSpec`（已是 install 最后 token）。若与查找结果不是同一字符串，到不了 CLI。
3. 校验允许形式（**不要**对 `#path:` 调用 `isValidGithubSpec`）：
   - `isValidPackageName(spec)` 且（若该行有 `npm`）spec 等于该行 `npm`，或行无 npm 时仅包名
   - `github:owner/repo` 或 `github:owner/repo#<gitRef>` 且 `isValidGithubSpec(spec)`，且 owner/repo 与该行 `url` 的 `github.com/<owner>/<repo>` 一致
   - `github:owner/repo#path:/<posix>`：`path:/` 后无 `..`、无 `:`、无 `\`；owner/repo 与 url 一致
   - 拒绝 `file:`、`link:`、tarball URL、git URL、其它
4. `DROPPED`：若 `id` 或 `packageName` 或（包名形式的 spec）命中 DROPPED → 拒绝。
5. `allowBuilds` 仍走 `normalizeAllowBuilds`；非法则拒绝。`needsAllowBuilds` 语义不变。
6. GitHub 无 `#path:` 的规格仍可走现有 `pinInstallSpec`（SHA）。`#path:` **不要** pin（`parseGithubSpec`/`isValidGithubSpec` 会拒）。
7. **互斥**：模块级 in-flight。`installMarketplacePlugin` 与 `uninstallPlugin`（以及 `installPlugin`）共享一把锁。第二次在第一次结束前返回 `{ ok: false, error: '已有插件正在安装或卸载，请稍后再试' }`，不排队。
8. add 成功后：在 `$DSH_HOME/profiles/web/node_modules/<packageName>`（scoped 用 `@scope/name` 路径）检查可加载入口。包名：npm spec 用 spec；github 用安装后 `package.json` 的 `name`，若读不到则失败并 remove。入口：`package.json` 存在，且 `dsh.bundle.patch` 为真，或 `dsh.client` 可解析到现存文件，或 `main`/`exports` 默认入口文件存在。不满足则 `runPlugin(['remove', name])` 并 `{ ok: false, error }` 说明不是可加载 dsh 插件。失败正文不要把 pnpm ndjson 进度当人话（沿用现有 `error` 字段策略：allowBuilds 提示或「安装失败」）。
9. 测试里 mock `runPlugin`/`spawn`：不要真跑 pnpm。可把 spawn 换成可注入，或 mock `child_process.spawn`。覆盖未知 id、收录的 npm、`github:owner/repo`、`#path:` 过闸、非法 path（`..` 与反斜杠）拒绝、Host `installPlugin` 仍拒 `file:` 和 `#path:`、忙碌互斥、无入口则 remove。

测：`node --test src/main/marketplace-install.test.js`。catalog 测也跑一下确保没破坏导出。

---

## Task 3: IPC and preload for install-marketplace-plugin

改 [src/main/ipc.js](../../../src/main/ipc.js)、[src/preload/index.js](../../../src/preload/index.js)、[src/preload/shell-api.test.js](../../../src/preload/shell-api.test.js)。

**不要**删除 `src/renderer/marketplace/`（Task 4）。本任务可以让 `CONFIG_SURFACES` 变成仅 Harness（市场窗口将在 Task 4 删）。`IPC_ROLES.MARKETPLACE` 可先留着直到 Task 4，或一并删掉若测试允许——**裁定：Task 3 把列表/安装/卸载/refresh 改为 `HARNESS_ONLY`；删除 `shell:seed-install-draft`；新增 `shell:install-marketplace-plugin`。留下 `IPC_ROLES.MARKETPLACE` 符号给 Task 4 删窗口时一起清。** `ALL_SURFACES` 的 `shell:get-config` 可暂时仍含 MARKETPLACE。

### 行为

- `shell:list-marketplace`：把 renderer `options.locale`（及 `refresh`）传给 `listMarketplace`。不要再传 GitHub token 作为目录必需（catalog 已忽略 token）。`refresh-marketplace` 同样传 locale（若无则默认 zh）。
- `shell:install-marketplace-plugin`：参数只有 `id` 和可选 `{ allowBuilds }`。调用 `installMarketplacePlugin`。仅 `result.ok === true` 时 `startHarness()`。`startHarness()` 抛错不把安装改成失败：返回 `ok: true`、`harnessStarted: false`。失败不重启。
- 删除 `shell:seed-install-draft` handler。
- preload `harnessApi`：增加 `installMarketplacePlugin`；删除 `seedInstallDraft` / `onSeedInstallDraft`。`installPlugin` 可留（Host 残留）。
- preload：删除 `marketplace` 角色——`SHELL_ROLES` 去掉 `marketplace`，删除 `marketplaceApi`，`shellRole` 对 `--dshd-shell-role=marketplace` 返回 null。更新 `shell-api.test.js`：断言 marketplace 角色不再暴露 API；harness 有 `installMarketplacePlugin` 且无 `seedInstallDraft`。

测：`node --test src/preload/shell-api.test.js`。若有 ipc 单测一并改。

---

## Task 4: Retire the standalone marketplace window

删除 [src/renderer/marketplace/](../../../src/renderer/marketplace/)（html/css/js）。改 [src/main/window.js](../../../src/main/window.js)、[src/main/local-url.js](../../../src/main/local-url.js)、[src/main/local-url.test.js](../../../src/main/local-url.test.js)、[src/main/ipc-authorization.js](../../../src/main/ipc-authorization.js)、[src/main/ipc-authorization.test.js](../../../src/main/ipc-authorization.test.js)、[src/main/chrome.js](../../../src/main/chrome.js)、以及仍引用市场窗口的 ipc/window 导出。

### 行为

- 删除 `openMarketplaceWindow`、`closeMarketplaceWindow`、`getMarketplaceWebContents`、marketplace `BrowserWindow`。
- `openMarketplace()`：`showMain()`；若 Harness 已就绪，打开设置 → plugins → 点击 `[data-dsh-settings-plugin-tab="marketplace"]`（保留现有 executeJavaScript 轮询）。**若未就绪：只显示主窗，记下 pending 标志；在 Harness 第一次就绪（`showHarness` 成功加载或现有 `isHarnessLoaded` 变真的那条路径）后执行一次同样的设置跳转，然后清标志。** 不要打开第二个窗口。
- 删除 `isMarketplaceNavigationUrl` 及其测试。`ipc-authorization` 不再有 MARKETPLACE 角色。`chrome.js` `WINDOW_ROLES` 只剩 BOOT+HARNESS。
- `ipc.js`：去掉 `closeMarketplaceWindow`；`ALL_SURFACES` / `CONFIG_SURFACES` 不再含 MARKETPLACE；删除 `IPC_ROLES.MARKETPLACE` 若仍在。
- 托盘/菜单仍调用 `openMarketplace()`。
- 更新任何断言 `marketplace/index.html` 的测试（`local-url.test.js`、`ipc-authorization.test.js`）。`harness-chrome-inject.test.js` 若只断言注入脚本不含 marketplace 控件，保持通过即可。

测：`node --test src/main/local-url.test.js src/main/ipc-authorization.test.js` 以及 window 相关测试（若有 `window*.test.js`）。再跑 `npm test` 里会因删窗口而红的文件并修好本任务范围内的。

---

## Task 5: MarketplaceSettingsTab one-click install and primitives

改 vendor 包 `vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/`：

- `src/client/MarketplaceSettingsTab.tsx` + `MarketplaceSettingsTab.module.css`
- `src/client/desktop-shell.ts`
- `src/client/index.ts`
- `src/client/locales.ts`（及 en 镜像键）
- 删除 `src/client/seed-install-draft.ts` 和 `tests/seed-install-draft.client.spec.ts`
- `tests/marketplace.client.spec.tsx`
- `tests/browser-plugin.client.spec.tsx`
- `tests/desktop-shell.client.spec.ts` 若需要

对标 [McpSection.tsx](../../../vendor/deepseek-harness/packages/client/ui-settings-mcp/src/client/McpSection.tsx) 的 Button/Modal/Input/Menu 用法。

### 行为

- 注册条件：`installMarketplacePlugin` + `listMarketplace` + `listInstalledPlugins` + `uninstallPlugin` 存在。去掉对 `sessions` / `seedInstallDraft` / Token 的依赖。
- `listMarketplace({ refresh, locale })`：每次 load 和 locale 变化都传 locale（`zh*` → `zh`）。apply 里从 `ctx.locale` 读当前语言（查 locale 服务的现有 API，不要新造 hook）。`t` 变化时应重新 load。
- 搜索：`Input` + `IconSearchOutline16`。刷新/安装/卸载/仓库/取消：`Button`（主操作 `primary`，其余 `ghost`/`outline`）。详情与确认/进度：`Modal`。状态/排序：`Menu`。
- 去掉 Token 输入和 `saveGithubToken` / `hasGithubToken` UI。
- 安装：详情 Modal 确认来源，**正文展示 `installSpec` 原文** → 调 `installMarketplacePlugin(item.id)`（只传 id）→ 进度进 Modal；`needsAllowBuilds` 再确认一次后带 `allowBuilds` 重试。不要 `close()` 再 seed draft。
- 分类芯片：超过约两行（用 CSS 默认 max 两行 +「展开」按钮），不要 `gap: 18px`。
- 过滤结果 `visible.length > 60` 只渲染前 `visibleLimit`（初值 60），底部「显示更多」+60。query/category 变化重置为 60。
- CSS：只留布局；gap/padding 8/12/16/24；卡片圆角 12；标签 8；正文 14/22、紧凑 12/18；禁止 `font-weight: 650`、颜色字面量、组件内滚动条。
- 文案：更新 `marketLoading`（不再说 GitHub）；新增确认/进度/显示更多/展开分类所需中英键；可删 `marketToken*` 和 `marketInstallDraft`。
- 测试：列表/筛选/按 id 安装/卸确认/无 Token；61 条只先出现 60 个 card；Menu 不要 `getByRole('combobox')`；Modal 关闭用 `aria-hidden` / `queryByRole`。`browser-plugin.client.spec.tsx` 改为注入 `installMarketplacePlugin`，不再 seed draft。

测（在 `vendor/deepseek-harness`）：`pnpm exec vitest run packages/client/ui-settings-plugin-inventory`。不要跑整份 `test:gui`。

遵循 `packages/client/AGENTS.md`：组件不碰 ctx；inject 只回纯数据和回调。

---

## Task 6: Remaining tests, Agent Note, README, design-language warnings

收口文档与任何仍红的必改测试。

- 桌面 `README.md`：插件市场改为 awesome-dsh-plugin 精选目录，设置页一键安装，无独立窗口。
- 删过期警告（中英）：
  - 根 `AGENTS.md` 里 marketplace.css 平行色板句
  - `docs/design-language.md` / `docs/design-language.en.md`
  - `docs/motion.md` / `docs/motion.en.md` 里「插件市场页没有进出场 recipe / 平行色板」
- `vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/README.md` 与 `README.zh.md`：Marketplace 是桌面设置页一键安装，不再预填 composer。
- Agent Note 写在 vendor 树，implemented/feature，日期 2026-08-18，例如 `2026-08-18-desktop-marketplace-curated-catalog.md` + `.zh.md` + sidecar。遵循 vendor Agent Note 格式（Problem / Decision / Alternatives considered / Consequences；中英结构对齐；记录拒绝 dshmarket 预装、拒绝独立窗口、拒绝用 `isValidGithubSpec` 套 `#path:`）。按仓库现有 sidecar 流程生成（看邻近日记的 `.json` sidecar 或 `pnpm run` 相关 verify）。更新 [2026-08-16-surfaces-terminal-work-loops.md](../../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md) 里「marketplace file: pinned to marketplace/index.html」的过时事实（窗口已删）。
- 把 `docs/superpowers/specs/2026-08-18-marketplace-parity-design.md` 纳入 git（若仍 untracked）。
- 跑桌面 `npm test` 修本轮引入的红（只修市场相关，不要顺手改 apiproxy）。再跑 vendor 该包 vitest。

不要新功能。不要第 2–4 阶段（截图/主题/更新/备份）。
