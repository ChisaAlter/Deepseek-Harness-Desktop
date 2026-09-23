# Changelog

All notable changes to **dsh-remote**.

## 0.8.21 — 2026-09-18
### 修复：主色按钮/分段页签的文字用了「填充 token」，导致对比度不足甚至不可见

**现象**：0.8.20 的分段页签（本机/远程）与主按钮，文字发灰、糊在黑底上；禁用的主按钮几乎看不清字。

- **根因**：0.8.20 把 `--dsw-alias-button-contrast-fill` 当成了"亮底上的文字色"。它是一个
  **填充（fill）token** —— 宿主自己拿它做 `background`，而非前景色。宿主主按钮的正确配对是：

  ```css
  ._primary { background: var(--dsw-alias-button-primary-fill);
              color:      var(--dsw-alias-label-primary-foreground) }
  ```

- **实测对比度**（浅色主题，浏览器内实测）：

  | 配对 | 背景 | 文字 | 对比度 |
  |---|---|---|---|
  | 0.8.20（错误） | `#0f1115` | `#61666b` | **3.26:1** ❌ |
  | 0.8.21（修复） | `#0f1115` | `#ffffff` | **18.90:1** ✅ |

  分段页签这种**正常尺寸的文字需要 ≥4.5:1**，3.26:1 明显不达标。
  更糟的是 `.dsh-rw-btn:disabled{opacity:.45}` 会把整颗按钮一起压淡：文字 `#61666b`
  与底色 `#0f1115` 一起被冲淡成 `#B8BABC` on `#939495`，只剩 **1.56:1** —— 基本读不出字。
  深色主题下两个 token 同为 `#f9fafb`，等于**白底白字，完全不可见**。

- **修复**：文字改用 `--dsw-alias-label-primary-foreground`（宿主的官方配对），两处：
  `T.onPrimary` 与 `.dsh-rw-tab.is-active` 的 `color`。

- **修复（禁用态）**：填充型主色按钮**禁用时保持纯黑实底**，不再整颗压淡。原来的
  `.dsh-rw-btn:disabled{opacity:.45}` 会让近黑的主色底褪成灰 `#939495`，白色文字再叠上去
  只剩 3:1。现改为：

  ```css
  .dsh-rw-btn:disabled{cursor:not-allowed}
  .dsh-rw-btn:disabled:not(.dsh-rw-primary){opacity:.45}   /* 次要按钮仍然淡化 */
  ```

  实测：主色按钮 **启用/禁用均为 `#0f1115` 纯黑底 + 白字 = 18.90:1**；禁用态由
  `cursor:not-allowed` 表达。次要按钮的淡化行为不变。

- **回归闸门**：`check.mjs` 新增第 6 条静态检查 `theme-token lint` —— 禁止把任何
  `--dsw-alias-*-fill` 用作文字色（`color:` / `onPrimary:`）。用 0.8.20 的代码验证该规则会
  命中 **2 处**并拦下发布；修复后为 0。

**验证**：`npm test` 128/128；`node check.mjs`（含新 lint）通过；隔离实例（独立 `DSH_HOME`，
端口 7391）装入修复后的 bundle，浏览器内用 CDP 对**实际下发的 CSS** 建按钮实测：主色按钮
启用/禁用都比对 18.90:1 且为纯黑底，并设「禁用次要按钮仍为 0.45」的对照样本来确认规则集
真的生效（避免注入失败导致的假阳性）。

## 0.8.20 — 2026-09-17
### 界面与操作：主题跟随、主按钮、键盘与内联对话框

- 设置页：机器行 hover / 状态胶囊（当前、密码、钥匙串、跳板）替代 emoji 堆叠；标签列加宽；**保存 / 设为当前 / 添加转发 / 立即更新** 使用主色按钮。
- 端口转发与审计日志可折叠；审计增加「刷新日志」，默认收起减少一屏噪音。
- 工作区选择器：分段式 本机/远程 tab；路径框 **Enter** 确认、**Esc** 关闭、**Ctrl/⌘+Enter** 设为工作区；列表 hover；主操作高亮。
- 远程文件树：新建目录 / 重命名改为主题内联对话框（不再 `window.prompt`）；右键菜单跟随 light/dark token。
- 文件 tab：编辑器文字色跟主题（不再写死深色 `#e4e4e7`）；未保存标记；**Ctrl/⌘+S** 保存、**Esc** 取消。
- 注入 `.dsh-rw-*` 焦点/hover CSS（无 `document` 的测试环境自动跳过）。hover 用中性半透明灰而不是
  `--dsw-alias-interactive-bg-hover`：宿主该 token 只有 6% 浓度，在设置页背景上几乎看不见；
  主按钮 hover 用 `opacity`，因为宿主的 primary fill 在浅色主题下本就接近纯黑，`brightness` 无效。

**验证**：`npm test`；另起一个 DSH web 实例（独立 `DSH_HOME`，端口 7391）安装 0.8.20 tarball 实测：
插件路由 200、设置页机器行/胶囊/折叠区、选择器分段 tab 与 Enter/Esc 均正常。

## 0.8.19 — 2026-09-17
### 侧栏文件接口按会话绑定机器（Desktop 多机阻断项）

- `/dsh-remote/ls`、`/read`、`/write`、`/fs` 接受 `sessionId`（或 `local=` 镜像路径），走与 `rw_*` 相同的 mirror binding；本地会话返回 403，不再落到「当前机器」连接池。
- 工作区选择器仍不带 `sessionId`，继续使用当前机器（设为当前后再浏览）。
- 客户端 explorer / 文件 tab / 原生右侧栏都会把 `sessionId` 附在请求上；保存使用 `expectedMtime` 乐观锁。
- 大文件预览改为 SFTP `readPartial` 范围读，不再整文件 `fastGet` 到可预测的临时路径。
- 同步默认 `depth=8` / `maxFiles=2000`，结果带明确 `TRUNCATED`；POSIX 远端 `rw_search` 优先 `rg`/`grep -R`，失败再 SFTP walk。
- 拆出 `lib/pool.js`、`lib/routes-fs.js`、`lib/remote-fs.js`；host-key TOFU 守卫进 `lib/hostkey.js`。
- 文档：中英文 README / `package.json` 工具数（20）/ `PUBLISH.md` 对齐当前功能。

**验证**：`npm test`；新增 session-fs / desktop-fs / remote-fs 回归。Desktop 完整 GUI 仍标实验性，但侧栏选机阻断项已修。

## 0.8.18 — 2026-09-16
### 变更：解除 dsh-better-sidebar 硬绑定

- README 首图换成由 `docs/cover.html` 渲染的 1280×640 产品封面。
- 从 `dependencies` 删除 `dsh-better-sidebar`。
- bundle patch 不再自动插入 `dsh-remote-sidebar`；安装 `dsh-remote` 现在只挂载
  `dsh-remote` 自身，避免侧边栏版本/API 变化拖垮整个插件树。
- 保留可选集成：用户单独安装 `dsh-better-sidebar` 后，client 仍会动态发现
  `betterSidebar` service 并注册远程文件浏览/编辑 tab。
- 官方 Desktop 的原生右侧栏集成不受影响；不安装 sidebar 时，`rw_*` 工具、设置页、
  同步、审计日志与端口转发均照常工作。
- README 更新为显式的双插件安装方式，并补回归测试确保 bundle 不再硬挂 sidebar。

## 0.8.17 — 2026-09-16
### 文档：README 截图改用仓库内相对路径（PR #33）

- README 截图不再走 jsDelivr CDN，改为**仓库内相对路径**（`docs/cover.png`、`docs/*.png`），
  这样 GitHub 才能把它选为 [dsh-plugin topic](https://github.com/topics/dsh-plugin)
  的卡片图；新增 1280×640 的 `docs/cover.png`（工作区选择器裁剪）作为 README 首图。

### 修复：Windows 上远程工作区路径被按盘符根解析 → `D:\home\...` ENOENT（issue #32）

**现象**（仅 Windows 触发）：连接 Linux 远端、选定远程工作区（如 `/home/os/IsaacLab`）后，
锚点与 `.dsh-remote-meta.json` 都正常，但打开该工作区立刻报：

```
cannot resolve target "D:\home\os\IsaacLab": ENOENT: no such file or directory,
realpath 'D:\home\os\IsaacLab'
```

聊天里的 `rw_*` 工具一切正常（走 SSH），只有侧边栏文件面板受影响。

- **根因**：侧边栏的**目录展开集合（`expanded`）是按会话共享的**，内核自带的本地文件树
  会把其中每一项当作**本地目录**，经 `/sidebar/api fs.tree` 交给
  `dsh-better-sidebar` 的 `path-security` 做本地 `fs.realpath()` 与工作区围栏校验。
  远程树此前通过同一个 `onToggleDir` 记录展开状态，于是**远端路径 `/home/...` 被写进了
  这个共享集合**。在 win32 上 `/home/...` 被 Node 判定为“绝对路径”（相对当前盘符），
  于是被补全成 `D:\home\os\IsaacLab` 而真实不存在 → ENOENT。
  macOS/Linux 上 `/home/...` 本身就是合法本地路径，所以该缺陷只在 Windows 暴露。
- **修复（治本）**：远程树的展开状态改为**由它自己持有**并持久化在**该 tab 的 `meta`**
  （`remoteExpanded`）里，绝不再写进会话共享集合。外观与交互不变。
- **修复（照顾已受影响用户）**：那个共享集合是**持久化在 localStorage 的**
  （`dsh-sidebar:v1:<sessionId>`），不清就一直失败。因此插件激活时先做一次**幂等迁移**，
  在本地文件树读取之前清掉其中的远端残留；tab 侧也会在解析出远程根目录后兜底再清一次。
- **删除范围刻意收窄**：只删“在本机不可能成为合法本地路径”的条目 —— 即 Windows 上的
  POSIX 绝对路径（`/home/...`）。真实 Windows 路径（`C:\...`、`D:\...`）与**本地镜像路径**
  （`$DSH_HOME/remote-workspaces/...`）一律保留；非 Windows 宿主不做这项广泛清理
  （那里的 `/home/...` 本身合法），只按当前远程根目录范围清理。
  面板几何、已开 tab、tab meta、底部面板等其余状态均原样保留。

**验证**：`npm test` 117/117（client-lifecycle 新增 3 例：共享集合不再被当作树状态 /
Windows 全量清扫 / 启动期迁移；并断言非 Windows 不误删、无关键与不可解析值保持原样）；
`check.mjs` 通过。真机（隔离 profile + 新端口）实测：注入污染状态后刷新，
远程路径的 `fs.tree` 请求由 **2 次（均 400）降为 0**，持久化集合被清空，
正常加载与本地会话无回归。

## 0.8.16 — 2026-09-15
### 新增（实验性）：官方 Desktop 传输 + 原生右栏远程文件（PR #31），并就评审发现加固 4 处

**PR #31（@dahaipeng）—— 官方 DeepSeek Harness Desktop 兼容路径**

官方 Desktop 组合会禁用旧的 `webServer` / `webRuntime` row，而 0.8.15 的硬
`webServer` 注入 + 内置旧侧栏会让该组合起不来。本版加一条兼容路径（**实验性**，
不含新监听端口、不代理、不伪造 WebServer 服务、不改核心）：

- Web 传输改为**响应式/可选**：`inject` 从 `['tools','systemPrompt','webServer']`
  收敛为 `['tools','systemPrompt']`，两种 UI 传输在 `registerHttpTransports()` 里
  各自 `ctx.inject` 挂载。服务晚到也能注册上（已用真 cordis 实测：插件先 apply、
  `webServer` 后提供，25 条路由全部注册）。
- 新增 Connection Fetch 路由（`lib/http-transport.js`），把同一批有界 JSON
  handler 同时挂到 `/api/dsh-remote/*`，供无端口的 `dsh-app:` carrier 使用；
  旧 `/dsh-remote/*` 路由原样保留。鉴权仍归 carrier 负责。
- 派发**之前**强制 1 MiB 请求体上限（超限回 413，绝不退化成空对象触发默认动作）；
  跨 IPC chunk 传一个整体 buffer，避免 UTF-8 被切断。路由前缀在发送前选定，
  **不重试** POST。
- 核心 Web-server row 被**显式禁用**时（官方 Desktop 组合），内置
  `dsh-better-sidebar` row 保持禁用；独立侧栏 / 顺序无关的去重守卫照旧保留。
- 新增原生 `sidebarRightTabs` / `sidebar.right.pane.tab` 注册，复用现有远程
  资源管理器与文件编辑器，并给远程文件独立的、按会话隔离的
  `dsh-resource://dsh-remote/<sessionId>/<path>` 地址（不再把远程路径当本地
  Files 路径）。
- 回归测试 + 中英文文档。

**评审后加固（对 Web 行为零改变，113/113 通过）**

- `connectionRoute()` 删掉 `route.kind === 'exact'` 要求。`kind`
  （`WebRouteKind`）是 `dsh-host-webserver` 的概念；Connection 的
  `ConnectionFetchRoute` **没有**这个字段，真实的 `assertFetchRoute()` 只校验
  路径形状与 methods。要求一个 API 从未定义的字段，会让将来漏写 `kind` 的路由
  直接抛错。已对真实 `dsh-client-connection` 0.1.5-rc.2 registry 实测。
- Connection Fetch 路由改为**逐个注册**。原单个 `.map()` 在遇到第一条坏路由时
  会中断，**静默丢掉其后所有路由**，同时泄漏前面已注册路由的 disposer；而这段
  代码跑在 `ctx.inject` 子 fiber 里，loader 只 log 不 rethrow，父插件仍是 ACTIVE，
  所以这种「部分注册」完全不可见。现在部分失败会经 `console.warn` 报出来。
- CI 语法检查改为 glob `lib/*.js`，不再用手工清单——原清单**已漏 4 个文件**
  （`binding.js`、`registry.js`、`update.js` 以及本次的 `http-transport.js`），
  新文件里的语法错误可以一路进 main。
- 补 `@deepseek-ai/dsh-client-connection` 为 optional peer，并把
  `@deepseek-ai/dsh-host-webserver` 的 peer 标为 optional：Desktop 组合会禁用
  该 row，插件已不再硬依赖它。

**仍是发布闸门（未在本版解决，见 README 兼容性说明）**

- 原生右栏的文件打开/编辑/同步端到端验收（当前原生 slot/resource/生命周期测试
  用的是组件替身）。
- **侧栏文件操作绑定到「本会话的那台机器」**，并测两台不同主机的并发会话。
  现有 `/ls`、`/read`、`/write` 等仍走 active-machine 池，**仅靠按会话隔离的
  资源地址并不能修好这个后端行为** —— 这是多机场景的发布阻断项。
- 在受支持的 Web 版本上跑完整旧 Web UI 回归。
- 非 macOS 远端/宿主，以及失败/取消的交互。

> 版本号与 npm 发布仅代表代码状态：**Desktop 支持仍属实验性**，不构成本版本
> 对多机 Desktop 生产可用的承诺。

## 0.8.15 — 2026-09-12
### 修复：连接失败永远只显示空 HTTP 400（issue #30）+ 依赖改为 dsh-better-sidebar 0.18（issue #29）

**issue #30 —— 失败路径自己先崩了，真正的错误永远发不出去**

- **根因 1（主因）**：`/dsh-remote/test-connect` 与 `/dsh-remote/connect` 的
  `const body/payload = JSON.parse(...)` 声明在 `try` 块**内部**，而 `catch` 里又读了
  它 —— `try` 内的 `const` 在 `catch` 中不可见，所以只要连接失败，`catch` 自己先抛
  `ReferenceError: body is not defined`，本该发出的
  `{ok:false, error:"认证失败 / 端口不通 / …"}` 永远发不出去；harness 的
  `dsh-host-webserver` 对 rejected handler 统一回空 body 的 400，前端只能显示
  「HTTP 400」。密码错误、缺凭据、DNS 失败、非法 JSON 全都长一个样。
  修复：`body`/`payload` 提到 `try` 之前用 `let` 声明并初始化为 `{}`，两个路由的
  handler 现在**永不 reject**（test-connect → 200 + `{ok:false,error}`；
  connect → 500 + 同结构；请求体非法 → 400 + 同结构，新增 `parseJsonObject()`）。
- **根因 2**：`POST /dsh-remote/machines` 丢弃了 `saveSecret()` 的返回值 ——
  Windows 上 DPAPI 脚本缺 `Add-Type -AssemblyName System.Security`
  （PowerShell 5.1 不预加载），`ProtectedData` 直接「找不到类型」，密码被静默丢掉，
  只留下 `credentialBackend:"windows"` 的空壳，之后每次连接必然失败。
  修复：`credential.js` 两个 DPAPI 脚本都补上 `Add-Type`；新增
  `persistPassword()` 统一凭据落盘决策 —— 密钥库失败时**回退明文**（`credentialBackend`
  改回 `plain`）、经 `warning`/`warningDetail` 回传，设置页用
  `settings.secretStoreFailed` 明确告知，不再静默保存一台没有凭据的机器。
  诊断文本会剥离密码（`execFile` 的 error message 含完整命令行 argv）。
- **验证**：新增 `test/route-errors.test.js`（10 个用例）直接驱动真实注册的路由
  handler：失败探测 → 200 + JSON + 命中主机名、非法 JSON → 200/400 + JSON、
  明文保存 → 落盘且有 `passwordSet` 且不回显密码、`persistPassword` 四条分支
  （失败回退 / 成功不入库 / 抛出时脱敏 / plain 不碰密钥库）。
  该文件在修复前 4/10 失败（正是 ReferenceError 路径），修复后全绿；
  全量 `npm test` 97/97、`node --check` + `check.mjs` OK、
  `npm ci --legacy-peer-deps` 用新 lockfile 可用。

**issue #29 —— 依赖范围把自己锁在了会崩的旧版侧边栏上**

- `@deepseek-ai/dsh-settings` 在 0.1.2-alpha.2 起移除了 `settingsNamespace` 导出
  （改为私有的 `parseSettingsNamespace`），而 `dsh-better-sidebar` 直到 0.18.0
  才适配：0.14.0 ~ 0.17.1 的 `lib/index.js` 仍然
  `import { SettingsConflictError, settingsNamespace } from "@deepseek-ai/dsh-settings"`，
  静态导入失败 → 整个插件树加载失败。dsh-remote 却把范围写成 `^0.14.0`
  （只允许 <0.15.0），装不上已修复的版本。
- **修复**：`dsh-better-sidebar` 依赖改为 `^0.18.1`（与 dsh-remote 自身
  `^0.1.2-rc.1` 的 harness peer 线一致），并同步 `package-lock.json`。
  集成面已核对 0.18.1 未变：服务名仍是 `ctx.provide('betterSidebar')`，
  `registerTab` / `openTab(seed, scope)` / `getSnapshot` / `subscribeState`、
  `single` / `dedupeKey` 语义一致，`dsh.bundle.patch` 与 client 入口名不变。
  （在 dsh 0.1.5-rc.1+ 上可再评估 0.19.x。）
- **⚠ 兼容性变化（新端口隔离实例实测）**：因为 0.18.x 会
  `import { SessionLogOffset } from "@deepseek-ai/dsh-session"`（该导出从 dsh 0.1.2-rc.1 才有），
  **0.8.15 起要求 `dsh ≥ 0.1.2-rc.1`**。实测四组组合：
  | harness | 插件 | 结果 |
  |---|---|---|
  | 0.1.2-rc.1 | dsh-remote 0.8.15 + sidebar 0.18.1 | ✅ 启动，0 加载错误，路由全部正常 |
  | 0.1.0-rc.8 | dsh-remote 0.8.14 + sidebar 0.14.0（改动前基线） | ✅ 启动 |
  | 0.1.0-rc.8 | dsh-remote 0.8.15 + sidebar 0.18.1 | ❌ 启动失败（整个插件树，dsh 起不来） |
  | 0.1.0-rc.8 | dsh-remote 0.8.15 + 关闭内嵌侧边栏行 | ✅ 启动，#30 的修复照常生效 |
  老 harness 用户请留在 **0.8.14**，或按 README 关闭内嵌侧边栏行（`- id: dsh-remote-sidebar / disabled: true`）。

## 0.8.14 — 2026-09-09
### 修复：dsh 0.1.2-rc.1 上 Settings → 远程工作区 页面缺失（PR #28，issue #26 后续）

- **现象**：dsh 0.1.2-rc.1 / 使用替换 workspace/sidebar 组件的 profile 上，Settings 里
  看不到「远程工作区」页面；0.8.13 虽已消除启动报错，但 `apply()` 里
  `if (slots === undefined) return` 的早退让注册永远不执行。
- **根因**：
  1. client 插件未声明硬依赖：`apply()` 需要 `slots`/`locale` 服务，但既没放进
     `exports.inject` 也没等待，服务未就绪时注册被跳过；
  2. `settings.section` 注册用了 `priority: 40`——rc.1 的 slot 列表按 **`order`** 排序
     （`priority` 是死字段，缺省当 0），导致条目被排到最前/不生效；
  3. 两个 directoryFlow 席位（`conversation.hero.workspace.directoryFlow` +
     `sidebar.workspaces.directoryFlow`）嵌套在一个 `slots.inject` 里，任一席位缺失
     会连带阻塞另一个；原生 `ui-workspace` 被替换时 `settings` 也受影响；
  4. `WORKSPACES` 是纯死代码（只赋值从不读取）。
- **修复**（来自贡献者 YiHui-Liu，PR #28）：
  - `exports.inject = ['slots', 'locale']`：硬依赖声明，服务就绪才 apply；
  - `settings.section` 改 `order: 40`（置于 dsh-remote-debug 之前、内置页之后）；
  - 两个 directoryFlow 各自独立 `slots.inject`，互不阻塞；
  - `sessions`/`betterSidebar` 用 `ctx.inject` 可选生命周期化，provider 卸载时清理
    过期 sessions 引用；
  - 删除 `WORKSPACES` 死代码与 `if (slots === undefined) return` 早退；
  - client 清单 peer 从已废弃的 `dsh-client-runtime`/`dsh-client-ui-workspace` 换成
    rc.1 实际提供的 `dsh-client-ui-renderer`/`dsh-client-locale` @0.1.2-rc.1；
  - 新增 `test/client-lifecycle.test.js`：8 个 VM 全包回归测试（延迟注册、provider
    移除/重加、dispose）。
- **CI 修复**：main 自 0.8.10（bd61cc4b）起 CI 就红——`upload.test.js`/
  `session-routing.test.js` 顶层 import `lib/index.js` → 静态 import
  `@deepseek-ai/dsh-tools`（仅 peerDependency，`npm ci --legacy-peer-deps` 不装）→
  `ERR_MODULE_NOT_FOUND`；其模块图还加载 `cordis`/`dsh-scope`/`dsh-llm`/
  `dsh-session`/`dsh-timeout`。修复：这套 import-time 闭包声明为 devDependencies
  （`files` 仅 lib+cordis.patch.yml，永不发布；生产仍由 dsh host 提供 peer）。
- **验证**：干净 LF 检出 `npm ci --legacy-peer-deps` + `node --check` + `check.mjs` +
  `npm test` 87/87 全绿（真实 GitHub Actions 亦绿）。

## 0.8.13 — 2026-09-04
### 修复：dsh 0.1.2-rc.1 上安装后启动报 "cannot get property \"workspaces\" without inject"（issue #26）

- **现象**：`dsh 0.1.2-rc.1 + dsh-better-sidebar 0.18.0 + dsh-remote 0.8.12`，启动 dsh web
  报 `Failed to load plugins — dsh-remote — failed to apply loader entry … (dsh-remote):
  cannot get property "workspaces" without inject`，整个 client 半加载失败。
- **根因**：`lib/client.js` 的 `apply()` 里
  `WORKSPACES = (ctx.get && ctx.get('workspaces')) || ctx.workspaces` —— `ctx.get(name)` 是
  可选查找（服务不在时返回 `undefined`），但第二段的 `|| ctx.workspaces` 是**裸属性读**。
  dsh 0.1.2-rc.1 的 cordis 上下文代理对未声明/不可用服务的任何属性访问直接抛
  `cannot get property "workspaces" without inject`（rc.8 及更早只是返回 undefined）。
  该兜底本身还是死代码：`WORKSPACES` 全文件只有赋值、从无读取；`SESSIONS` 的读取点
  （better-sidebar session cwd）已有 host 侧 `/dsh-remote/resolve-mirror?sessionId=` 兜底。
- **修复**：删掉 `|| ctx.workspaces` 裸读兜底，`WORKSPACES/SESSIONS` 一律只走
  `ctx.get`（可选、不抛），取不到就是 `null`。对 dsh 全版本兼容：rc.8 前行为不变，
  0.1.2-rc.1+ 不再触发严格代理报错。
- **验证**：独立 DSH_HOME + 0.1.2-rc.1 CLI + 新端口实例复现（页面报错与 issue 截图一致）
  → 真包应用补丁后刷新，插件树干净加载（无 Failed banner、console 无异常、
  `/dsh-remote/{machines,status,update-check}` 全部 200）→ `npm test` 79/79、
  `check.mjs` OK。

## 0.8.12 — 2026-09-03
### 修复：多远端会话互相抢占同一个 SSH 连接 —— 命令会被静默发往错误的主机（issue #25）

- **根因**：SSH 连接与远程工作区都是**进程级单例**。插件经 `cordis.patch.yml` 挂进
  host composition（非 preset `isolate` realm），整个进程只 `apply()` 一次，于是
  `const pool = new SshPool(config)` 与 `wsPath() = config.workspace` 被所有会话共享。
  任一会话切换机器时 `setTarget()` 改写共享的 `config` 身份**并调用 `this.close()`**
  掐断另一会话正在用的连接。而 18 个 `rw_*` 工具全部写作 `execute(args)`，从不接 DSH
  传入的第二个参数 `exec: ToolRunContext`，因此拿不到 `exec.agent.session` —— 只能认
  pool 的当下状态。后果不是"连接被反复重建"这类性能问题，而是**命令静默发往错误主机**：
  连接本身健康，只是连错了机器，所以没有任何报错。
- **issue #13 只修了「读」的一半**：`sessionRemotePath()` / systemPrompt / resolve-mirror
  端点确实按 `session.header.cwd` 反查镜像，所以*提示词*是对的；但*执行路径*一行未动。
  读写不对称正是本问题的根因。
- **修复**：
  - 新增 `lib/binding.js`：`resolveMirror(local, root)` 从会话 cwd 反查其所属镜像的
    `.dsh-remote-meta.json`，返回该镜像记录的 `host/port/username` 与 `remotePath`；
    `poolKey(m)` 给出规范化的 `user@host:port` 连接键。
  - **per-machine 连接池**：`machinePools: Map<poolKey, SshPool>` 取代单例。同一台机器
    的多个会话仍共享一条连接（保留 keepalive / 断线重连模型），不同机器的会话彼此独立。
  - **工具按会话绑定**：会话相关的 `rw_*` 接 `exec` 参数，经 `bindingFor(exec)` 解析出
    「该用哪台机器 + 哪个工作区根」，不再读共享的 `config.host` / `wsPath()`。无法解析时
    **明确报错而不回退到当前机器**（静默回退正是错投的来源）。
  - `rw_connect` 保持"切换当前机器"语义；`rw_disconnect` 改为关闭**本会话自己**那条连接
    （原先关的是当前机器的连接，对已绑定会话形同空操作）。
  - **审计日志按真实目标机器归属**：`audit()` 新增 `target` 参数。原先记录的是*当前机器*
    身份，会把操作错记到别的主机名下。
  - **auto-push 按被监视镜像解析目标**：原先以"当前机器"为条件，另一会话切换后 watcher
    会静默停止回传。
  - **systemPrompt 身份错配**：原先把本会话的 remotePath 与*当前机器*的
    `config.username@config.host` 拼在一起，可能给出一个并不存在的 host:path 组合。
  - **Windows/Git Bash 次生竞态**：0.8.11 把 `platform` / `gitBashPath` / `shellMode`
    挂在单例 pool 上并在 `setTarget()` 重置，Windows 与 Linux 会话会互相重置对方的 shell
    探测结果。改为随各自的 per-machine pool 走，并在 `rw_exec` 决定 cwd 形式前先
    `await detect()`（新建的池初始为 `unknown`，否则首条命令会漏掉 Git Bash 路径改写）。
  - **凭据刷新**：复用已有池时从注册表重读密码/密钥/策略，使设置页的修改能到达早先创建的池。
- **回归测试**：
  - `test/binding.test.js`（9 项）—— 两台机器各自解析到自己的 remotePath 且 pool 键不相等、
    嵌套路径归属、basename 冲突（`-<hash>` 后缀）区分、同名前缀兄弟目录不误判、纯本地 cwd
    无绑定、meta 损坏或缺 host 时跳过而不猜测、poolKey 按 host/user/port 分裂且默认端口归一。
  - `test/session-routing.test.js`（5 项）—— 走**真实 `apply()`** 注册出的 `rw_*` 工具，
    用隔离 `DSH_HOME` + 两个镜像验证端到端路由：两会话各打到自己的主机、A/B/A/B 交替
    互不改道、绑定会话用镜像工作区而非当前机器工作区、纯本地会话明确拒绝而不回退、
    同机器两工作区共享一个 pool 键但工作区根独立。
    这 5 项**在修复前的 0.8.11 上有 4 项失败**（断言输出显示绑定到 `.11` 的会话把命令
    发到了 `.22`，即错投本身），修复后全部通过 —— 这是该修复的判别性证据。
  - **维护补充**：`machineRecordFor()` 同时把 `rw_connect save:false` 的**临时连接**
    （ephemeral）视为凭据来源 —— 否则在临时连接上 `rw_pick_workspace` 建立镜像后，
    后续会话解析同一身份会得到空凭据的池而无法连接。凭据刷新逻辑保持一致。

## 0.8.11 — 2026-08-31
### 新增：Web UI 国际化（i18n）—— zh / en 双语文案 + 英文回退（issue #14）

- **词典**：`lib/client.js` 内置 `L.zh` / `L.en` 两套键集完全一致的文案词典
  （设置页、目录选择器、远程文件侧边栏、文件查看/编辑等全部用户可见字符串）。
- **跟随宿主语言**：通过 DSH 原生 client `locale` 服务（`ctx.locale.register`
  注册 `dsh-remote` 命名空间 + `bind` 翻译函数），活动语言切换时文案实时更新；
  宿主 locale 不可用时回退到浏览器语言（`navigator.languages`），再不行默认英文。
- **英文回退链**：查找顺序 活动语言 → `en` → 原始 key（缺失文案保持可见，绝不空白）。
- **宿主错误信息本地化**：`lib/index.js` 返回的已知中文错误（目录选择超时、选择器
  程序缺失、Windows 无 `~` 解析、npm registry 不可达等）在客户端 `api()` / `apiRaw()`
  层按词典翻译，非 zh 界面不再出现中文报错。
- **回归测试**：新增 `test/i18n.test.js`（4 项）—— zh/en 键集一致、`tr()` 引用的
  key 全部存在、无空翻译、zh/en 插值占位符集合一致。

## 0.8.10 — 2026-08-31
### 修复：`rw_upload` 自引入即坏 —— `sftp.fastPut` 参数顺序颠倒（ssh2 契约为 `fastPut(本地, 远程)`）

- **根因**：`rw_upload` 调用的是 `sftp.fastPut(rp, lp)`，把**远程路径当本地路径**传给了
  ssh2。ssh2 的真实签名是 `fastPut(localPath, remotePath)`（与
  `fastGet(remotePath, localPath)` 恰好相反），于是 ssh2 尝试把远程路径当本地文件打开：
  Windows 上 `/home/…` 按当前盘解析为
  `C:\home\…` → `ENOENT: no such file or directory, open 'C:\home\…'`。即使传入
  完全正确的 `localPath`（如 `D:/…`）也必然失败 —— 该工具自
  0.6.x 引入以来从未成功过。`rw_push` / `rw_sync` / `rw_download` 走 `writeFile` /
  `fastGet`，参数顺序本来就正确，不受影响。
- **修复**：改为 `sftp.fastPut(lp, rp)`（本地在前）；SFTP wrapper 的参数名同步改为
  `(lp, p)` 并注明 ssh2 契约，防止回归。
- **回归测试**：新增 `test/upload.test.js` —— 原型替换 `ssh2.Client`（完全离线），
  驱动真实 `apply()` + 连接池 + SFTP wrapper，断言 `fastPut` 收到 `(本地, 远程)` 顺序；
  该测试对旧顺序如约失败。
- **连带纠正**：`test/helpers.js` 的 `MemFs.fastPut` mock 此前也编码了颠倒的顺序
  （潜在坑：任何基于它的测试都无法发现这类 bug），已纠正为真实契约。

## 0.8.9 — 2026-08-29
### 新增：Git Bash 默认终端（Windows 主机）+ 「此电脑」多盘根视图 + Windows 路径自动改写；修复浏览浮层「回上一级」与路径栏残留上次选择

- **Git Bash 默认终端** —— 连接后自动探测远程平台（`cmd /c ver`，附 `uname -s` 的
  MINGW/MSYS 兜底）；Windows 机器自动定位 Git Bash（`config.shell` 可显式指定 bash.exe
  路径、`'git-bash'` 或 `'native'` 关闭），所有命令经 `bash -s` 从 exec 通道 stdin 管道
  执行 —— 不经过 cmd/PowerShell 解析，引号/反斜杠/换行内容原样执行。`rw_exec` 的 cwd
  在 Git Bash 模式下自动改写为 `/c/Users/…` 挂载形式。`/dsh-remote/status`、`rw_info`、
  设置页「测试连接」均报告检测到的 `platform` / `shell` / `gitBash`。
- **「此电脑」多盘根视图** —— 远程选择器在 Windows 主机根级显示驱动器列表
  （`C:\` `D:\` `E:\`…，经 `cmd /c fsutil fsinfo drives`，回退 `ls -d /[a-z]`），不再
  显示 Git Bash 的 MSYS 根目录；平台探测未决时也尝试枚举（POSIX 主机自然回落）。
- **Windows 路径自动改写** —— 输入 `C:\Users\…` / `C:/…` / `/c/…` / `/C:/…` 统一规范为
  Git Bash 形式 `/c/Users/…` 供 shell 命令执行，工作区存储与展示为 Windows 形式
  `C:\Users\…`；`/dsh-remote/ls` 条目携带完整展示形路径，客户端不再自行拼接路径。
  `paths.js` 新增纯函数 `toShellPath` / `toDisplayPath`（含单测）。
- **浏览浮层修复** —— 「回上一级」在任意深度可用：浮层直接打开在路径栏当前路径
  （levels 仅一层）时，向上导航会加载父目录而非置灰；浏览弹层打开时与路径栏同步。
- **路径栏修复** —— 选择器每次打开/切换 tab/切换机器时重置路径栏，不再残留上一次
  在 DSH 页面选择的路径；面包屑 Windows 化（`此电脑 / C:\ / Users / dev` 可点击跳级）。
- 新增配置项 `shell`；文档（README / README.zh / CHANGELOG）同步更新。

## 0.8.8 — 2026-08-24
### 修复：Remote context 改为 session 级隔离，保存的机器不再自动成为全局 Agent 上下文（issue #13）

**核心语义变化：`Saved Connections ≠ Active Remote Context`。** 保存 SSH 机器只是备用连接；
只有用户显式「设为当前」（或调用 `rw_connect`）才会激活 remote context。普通本地 session
不再被任何已保存/当前机器拖入远程上下文。

- **问题 1 — 没有「当前无远程上下文」状态**：旧逻辑 `currentId` 为空时 fallback 到第一台
  机器、添加第一台机器自动设为 current、删除当前机器后自动换到另一台，导致「保存了一台
  SSH 机器」几乎等价于「Agent 永远有一个 remote context」。
  - **修复**：`loadMachines` 不再 fallback；add/update 不再自动设 current（保留原有
    `currentId` 字段）；删除当前机器后 `currentId` 置 null（不自动换机）；`/dsh-remote/
    current` 支持 `{ id: '' }` 显式「active remote = none」；设置页新增「取消设为当前」
    按钮。`currentId: null` 会持久化（`explicitNone`），重启后配置级默认 host 也不会
    静默重新激活被用户取消的上下文。
- **问题 2 — 切换/删除远程 workspace 后侧边栏仍显示旧远程目录**：`resolve-mirror` 对
  非 mirror 的 session cwd fallback 到 `machine.workspace`，把别台机器记住的默认目录
  显示到本地 session 的「远程文件」tab。
  - **修复**：`resolve-mirror` 不再 fallback —— 非 mirror session 返回
    `remotePath: ''`、`mode: 'local'`；侧边栏 `RemoteExplorerTab` 也不再回退到
    `status().workspace`，本地 session 显示「当前会话未使用远程工作区」；新 session 的
    「远程文件」tab 只在 session 确为远程时自动打开。
- **问题 3 — 本地 session 突然自动分析远程项目**：system prompt 只要有 `config.host +
  workspace` 就注入「Current remote workspace: user@host:/path … Treat this directory as
  the working root」，完全不看当前 session 是否真的选择了该 remote workspace。
  - **修复**：prompt 注入改为 session-aware —— section 的 `text()` 按本次 assembly 的
    `context.agent.session.header.cwd` 判断，只有 cwd 能映射到 dsh-remote mirror（即用户
    确实把远程 mirror 选为 session 工作区）时才注入；普通本地 session 不注入 remote
    段落，模型自然也不会被引导去调用 `rw_*`。
- **配套**：`/dsh-remote/status` 新增 `sessionMode` / `sessionRemotePath`（支持
  `?sessionId=` 按 session 查询）；`rw_info` 输出增加「Session remote context」行并说明
  session-scoped 语义；机器注册表纯逻辑抽到 `lib/registry.js` 并新增 `test/registry.test.js`
  （56 项测试全绿，覆盖：不 fallback、不自动激活、删除不换机、explicitNone 持久化、
  keepCurrentKey 保留语义）。

## 0.8.7 — 2026-08-21
### 修复：内嵌侧边栏 guard 与 bundle 顺序无关（issue #12）+ 本机目录选择器支持 browse 后端（issue #11）
- **issue #12 — 自动挂载 better-sidebar 的守卫失效导致启动崩溃**：当 profile 显式装有
  独立 `dsh-better-sidebar` 且排在 `dsh-remote` **之后**时，两个 better-sidebar 实例同时
  启用，第二个注册 `/sidebar/api` 报 `duplicate prefix route`，整个插件树启动失败。
  - **根因**：loader 按 bundle 顺序创建条目，每行的 `!!js` disabled 表达式在创建时求值，
    只能看到**排在自己前面**的行。`dsh-remote-sidebar` 的 guard 查不到后面的独立
    better-sidebar，两边都认为自己没有对手 → 双挂载。
  - **修复**：guard 不再依赖 `ctx.loader.entries()` 的创建顺序，改为扫描**已合成的 patch
    栈**（`include.subtree.config.patches`，即所有 bundle 层 + profile/home/overlay 层的
    全部插入行）——该数据在任意行 guard 求值前已完整物化，因此无论独立 better-sidebar
    排在 bundle 列表的什么位置结果都一致。纯数据访问、不读其它行的 `disabled`，无递归。
    原 `entries()` 检查保留作兜底（覆盖运行时注入的行）。
  - **验证**：`bundles: [..., "dsh-remote", "dsh-better-sidebar"]`（复现原崩溃）与
    `[..., "dsh-better-sidebar", "dsh-remote"]` 均正常启动、侧边栏仅挂载一份。
- **issue #11 — 本机目录选择器在 DSH Desktop（browse 后端）不可用**：桌面版启动器在
  win32 故意挂载 browse 后端（native 后端的 Win32 对话框 worker 在 Electron 壳里
  无法运行），但插件只认 `kind === 'native'`，导致 browse 能力被完全忽略。
  - **修复**（合入 PR #10）：`local-pick` 按能力分支 native → 自持 OS 对话框
    （PowerShell/osascript/zenity-kdialog）→ browse 兜底；新增 `GET /dsh-remote/local-list`
    与 `POST /dsh-remote/local-mkdir` 代理 browse 后端，客户端新增本机目录浏览浮层
    （面包屑 / 盘符切换 / 新建目录 / 选择回填），无显示器宿主也能选目录。
  - **验证**：DSH Desktop（win32）本机 tab 正常弹出系统文件夹选择器；无 zenity/kdialog
    的 Linux 宿主走应用内目录浏览器。

## 0.8.6 — 2026-08-21
### 修复：设置页底部版本号硬编码为 v0.8.3
- **现象**：设置页底部「dsh-remote v0.8.3」永远显示 0.8.3，即使安装的是更新版本。
- **根因**：版本号字符串硬编码在 client.js，没有跟随实际安装版本。
- **修复**：改用 `/dsh-remote/update-check` 返回的 `current` 版本（页面加载时已静默获取），
  取不到时显示 `?.?.?` 兜底。

## 0.8.5 — 2026-08-21
### 新功能：侧边栏远程文件树跟随会话工作区 + 目录选择器补全体验
- **远程文件 tab 跟随会话工作区**：每个会话的「远程文件」侧边栏目录不再固定显示
  机器级默认 workspace，而是跟随会话自身 cwd。新增 host 端点
  `GET /dsh-remote/resolve-mirror?local=<abs>|?sessionId=<id>`：遍历
  `$DSH_HOME/remote-workspaces/` 下各镜像目录的 `.dsh-remote-meta.json`，把会话 cwd
  （镜像目录）映射回真实远程路径；`?sessionId=` 时优先读 host sessions 服务的
  `header.cwd`，活跃会话查不到（历史会话）时走会话日志兜底——按 sessionId 定位
  `$DSH_HOME/sessions/**/<sessionId>/session.jsonl.zstd`（或 .jsonl/.gz），解第一帧
  zstd 读 header.cwd。无匹配回退机器 workspace。
- **侧边栏远程文件树形展开**：RemoteExplorerTab 从「面包屑 + 单级列表」重写为树形
  文件树，与 better-sidebar 内置本地文件树交互一致——目录点击展开/收起（📂/📁，
  黑色 SVG 图标）、子目录递归、缩进、右键菜单（打开/下载到本地镜像/重命名/删除）；
  根目录默认展开显示第一级；行 hover 高亮。数据走 `/dsh-remote/ls`，条目用
  joinRemote 补绝对路径。展开状态复用框架 `expanded`/`onToggleDir`，与本地树
  互不干扰。
- **新会话自动打开远程文件 tab**：auto-open 的集成级单例 flag 改为按 sessionId
  记忆（`autoOpenedFor` Set），每个会话独立 auto-open 一次，修复「新会话没有
  远程文件页签、旧会话才有」的问题。
- **会话 cwd 时序修复**：RemoteExplorerTab 的 `refreshStatus` 依赖改为
  `[scopeCwd, sessionId]`——better-sidebar 的 scope.cwd 可能异步到达（fetchedCwd
  经 `api.sessionCwd` 拉取），原先空依赖只在挂载时解析一次，cwd 落地后不重新解析，
  导致所有会话都显示机器 workspace；现在切换会话 / cwd 落地都会自动重新
  resolve-mirror，A 工作区会话显示 A、B 工作区会话显示 B。
- **目录选择器补全体验**：选择子目录后路径自动补全尾部 `/`（或 Windows `\`），
  可继续输入下一级；选择子目录后弹出的下一级候选不再只列目录（原来过滤掉文件，
  看起来列表不齐），改为目录+文件全部显示，与输入时的补全一致。
- **UI 视觉**：树行文字改为跟随主题的正文字色（去掉绿色强调），文件图标统一为
  黑色 SVG。

## 0.8.4 — 2026-08-21
### 修复：dsh 0.1.0-rc.8 安装 0.8.3 启动崩溃（issue #9）
- **现象**：`dsh web` 启动报 `unsupported JSON schema: parameters.env.additionalProperties
  must be explicitly true or false`，插件树加载失败、整个 Harness 无法启动。
- **根因**：`rw_exec` 工具的 `env` 参数 schema 是 `{ type: 'object' }`，没有显式
  `additionalProperties`。dsh 0.1.0-rc.8 内嵌的 dsh-tools（0.1.0-rc.8）schema 编译器
  强制 `type:'object'` 必须显式声明 `additionalProperties: true|false`，缺失即抛
  `JsonSchemaError`（0.7.1/0.6.7 能启动是因为它们自带/解析到宽松的 dsh-tools 版本）。
- **修复**：`rw_exec.env` 补上 `additionalProperties: true`（env 是任意 key 的环境变量
  映射，语义上就是 open map）。
- **回归防护**：`check.mjs` 新增「defineTool 参数里 `type:'object'` 必须显式
  `additionalProperties`」静态检查，部署前闸门会拦截同类问题。

## 0.8.3 — 2026-08-21
### 新功能：添加机器表单折叠高级配置
- 基础字段（名称 / 主机 / 端口 / 用户 / 密码）始终可见，覆盖最常见的
  IP + 用户名 + 密码场景。
- 私钥 / Passphrase / 默认工作区 / HostKey 模式 / agent·OTP·钥匙串开关 /
  跳板机全部收进「▼ 高级配置」折叠区，展开后与原布局一致。
- 编辑使用了高级配置的机器时自动展开；清空/取消时自动收起。

## 0.8.2 — 2026-08-21
### 修复：设置页 UI 拥挤 + updateMode schema 兼容
- **设置页排版优化**：表单行增加上下间距（row 统一 marginBottom 8）；跳板
  「端口/用户/密码」拆成两行并 flex-wrap，不再溢出；跳板私钥独立一行；
  checkbox 行与底部操作按钮行补间距 + 自动换行；机器列表「设为当前」按钮
  nowrap；工作区弹窗路径行 flex-wrap。
- **兼容修复**：`updateMode` 改用 `z.string()`（schemastery 3.18 无 `.enum`），
  在读取处以 manual/auto/off 白名单校验，避免插件树加载失败。

## 0.8.1 — 2026-08-21
### 新功能：版本更新提示 + 手动/自动更新模式
- **设置页新增「更新」区块**：显示当前版本 / 最新版本（自动查询 npm registry）、
  「检查更新」按钮、发现新版本时「立即更新」按钮。
- **更新模式可选**：`手动`（默认，仅点检查时查询）、`自动`（加载时 + 每 6 小时
  静默应用新版本）、`关闭`。模式写入安装目录 `update-mode` 文件，重启后保留。
- **更新机制**：零构建插件 = 下载 npm tarball → 内置 tar 解析（zlib gunzip +
  迷你 ustar reader，见 lib/update.js）→ 校验版本 → 原子替换 lib/*.js +
  cordis.patch.yml + package.json，写 `.dsh-remote-updated` 标记；host 半重启、
  client 半刷新后生效。
- 失败安全：下载/解析/校验任一步失败即中止，不动现有文件；auto 模式错误静默。
- 验证：tar 解析器对真实 tarball 解出 package/lib 正确；fetchLatestVersion 真实
  查询 npm 返回最新版；check.mjs 通过。

## 0.8.0 — 2026-08-21
### 大版本：远程 = 一等公民（设计文档全量落地）
按「状态一致性 → 工具完备 → 同步安全 → 企业网络 → 打磨」五条主线实施：

**状态一致性与正确性（P0）**
- 单一状态源：`rw_connect` 默认 `save:true` 把机器 upsert 进注册表并设为当前，
  工具/UI/系统提示三者的"当前机器"永远一致；`rw_pick_workspace` 把工作区持久化到
  **实际连接**的机器（修复旧 bug：工具连 A 机却把 workspace 存到注册表当前 B 机）。
  新增 `activeSource: machine|ephemeral|config` 状态字段。
- 设置页表单补全：passphrase / 默认工作区 / hostKeyMode / SSH agent /
  keyboard-interactive / 跳板机 / 加密保存密码；机器行显示最近测试延迟。
- Windows 宿主本机目录选择器（PowerShell FolderBrowserDialog）。
- 大文件保护：`rw_read_file` 先 stat 超限即拒绝；`rw_download`/`rw_upload` 走
  fastGet/fastPut 流式落盘；侧边栏 `/dsh-remote/read` 大文件只预览头部。

**Agent 工具完备（P1）**
- 新增 6 个工具：`rw_stat` / `rw_edit`（字面替换 + mtime 乐观锁）/
  `rw_append` / `rw_mkdir` / `rw_remove`（recursive 有界）/ `rw_move`。
- `rw_search` 重写为 **SFTP 遍历搜索**（lib/search.js）：Windows 远程可用、
  忽略规则生效、支持 glob/contextLines/maxMatches，不再依赖 POSIX find+grep。
- `rw_exec` 支持 `pty` / `env`；错误统一走分类提示（auth/network/hostkey/timeout）。

**同步安全（P1）**
- `rw_sync`/`rw_push` 升级为**三方冲突检测**（lib/sync.js：远端 vs 本地 vs
  上次同步快照）：任一侧改过的文件不再被静默覆盖——报冲突 + 路径 + 原因，
  `force=true` 覆盖；`dryRun` 预演；`async:true` 后台任务（lib/tasks.js）。
- **gitignore 式忽略规则**（lib/ignore.js）：默认跳过 .git/node_modules/target/
  dist/build 等，用户文件 `$DSH_HOME/remote-workspaces/.dsh-remote-ignore`；
  新增 `/remote-ignore` 命令查看。
- 镜像同步状态快照 `.dsh-remote-sync-state.json`（原子写，pull 后对齐本地 mtime、
  push 后对齐远端 mtime，保证下次同步增量跳过）。

**企业网络（P2）**
- **端口转发**（lib/forwards.js + `rw_forward` + 设置页面板）：本地→远端 /
  远端→本地(reverse)，定义持久化、可自动重连、断连全部清理。
- **跳板机 ProxyJump**：机器可配置 proxy（经跳板 forwardOut 到目标），TOFU 双段
  校验；test-connect 支持带跳板探测。
- **认证扩展**：SSH agent（SSH_AUTH_SOCK）、keyboard-interactive（OTP）、
  从 ~/.ssh/config 导入（只引用私钥路径，绝不读密钥内容）。
- **OS 钥匙串密码**（lib/credential.js）：macOS Keychain / Windows DPAPI /
  Linux secret-tool，可选、失败自动回退明文。

**打磨（P3）**
- **侧边栏远程文件可编辑**：编辑 → 保存到远程（`POST /dsh-remote/write` +
  mtime 乐观锁，409 提示重读）；explorer 右键菜单（下载到镜像/重命名/删除/
  新建目录）；行内显示文件大小、目录优先排序。
- **命令审计日志** audit.log（时间|user@host|op|exit|command），设置页展示最近 30 条。
- **编码支持**：rw_read_file/rw_write_file/read/write 路由支持 `gbk` 等（iconv-lite）。
- **书签/快捷**：每机最近工作区（picker 内"最近"一键进入 + 设置页快速切换）、
  `~` 主目录快捷、浏览弹层"新建目录"。
- **测试与 CI**：`test/` 45 项单测（node:test：路径/忽略规则/错误分类/ssh config/
  三方同步冲突/TOFU 指纹回归/SFTP 搜索/任务管理/单文件推送，mock SFTP + 真实本地
  目录）；`scripts/integration-real.mjs` 真实主机集成实测（mock ctx 驱动 apply +
  真实 SSH，覆盖 status/test-connect/ls/read/write+乐观锁/fs/search/sync/forward/
  audit/forget-key）；check.mjs 扩展（工具名 rw_ 前缀、路由 /dsh-remote/ 前缀扫描）；
  `.github/workflows/ci.yml`。
- 配置新增：`useAgent` / `keyboardInteractive` / `proxy` / `autoPush` / `auditLog` /
  `encoding` / `passphrase`。
- 依赖新增：`iconv-lite`；随 0.7.2 已内嵌 `dsh-better-sidebar`。
- 健壮性：移植 0.7.3 的 stale-connection 恢复（channel open failure 时
  `invalidate()` + 新连接重试一次，exec/sftp 双路径）；迁移旧数据仅在本机默认
  DSH_HOME 时执行（显式 DSH_HOME 指向他处时不再搬走该目录下的真实数据）。
- 真实主机实测（root@9.134.186.191:36000，45/45 通过）发现并修复 3 个问题：
  Config 的 `z.object(...).optional()` 在 schemastery 3.18.1（部署同版本）不存在
  （会导致插件加载失败，改为全字段默认值）；`mkdirRemoteDirs` 不建目标目录
  （rw_mkdir/fs mkdir 无效，改为真 mkdir -p，文件类调用点传父目录）；反向转发
  误用 `openssh_forwardIn`（ssh2 ≥1.16 为 stream-local，改回 `forwardIn`）。

## 0.7.4 — 2026-08-21
### 新功能：设置页 / 工作区弹窗角落引导链接
- **设置页底部**：新增「⭐ 去 GitHub 点个 Star · 💬 反馈建议 / 提 issue」引导行
  （含版本号），低调置底、不影响任何表单操作。
- **选择工作目录弹窗底部**：新增居中角落「⭐ Star dsh-remote · 提建议 / 报问题」
  链接，同样不遮挡确认按钮。
- 目的：把 star / issue 回流入口放到用户高频路径上，提升社区活跃度。
- 验证：语法 + check.mjs 通过；链接 `target=_blank` + `rel=noopener`，弹窗内
  点击不会触发 backdrop 关闭。

## 0.7.3 — 2026-08-21
### 修复：远程目录读取间歇性失败（"Channel open failure: open failed"）
- **现象**：浏览远程目录（远程文件侧边栏 / `rw_list_dir` / `rw_sync`）偶发
  `browse failed: ssh sftp failed: (SSH) Channel open failure: open failed`。
- **根因**：连接池持有"僵尸连接"——SSH 连接在服务器端已死（空闲超时 / 网络
  重置），但 keepalive 尚未触发 close 事件，池里的 `client` 仍被复用；对死连接
  调 `client.sftp()` / `client.exec()` 打开新通道时服务器拒绝，报 channel open
  failure，且旧连接永远不被清理，故障持续。
- **修复**：新增 `SshPool.invalidate()`——当 `sftp()` / `exec()` 通道打开失败
  且错误匹配 `channel open failure|open failed` 时，丢弃缓存 client（end + epoch
  失效）并在**全新连接上重试一次**；持续性错误仍正常报错。exec 的流处理提取为
  `runStream()`，SFTP 包装提取为 `wrapSftp()`，避免重连路径重复代码。
- 验证：单元测试（僵尸连接 → invalidate → 新连接重试成功 ✅）+ 真实 SSH 集成
  测试（readdir 87 entries ✅）。

## 0.7.2 — 2026-08-20
### 新功能：内嵌 dsh-better-sidebar，一条命令装齐
- **`dsh plugin add dsh-remote` 自动带出侧边栏**：`dsh-better-sidebar` 从可选
  集成升级为**硬依赖**（`dependencies`），安装 dsh-remote 时自动装上；`cordis.patch.yml`
  同时挂载两个插件（`dsh-remote` + `dsh-remote-sidebar`），无需再单独
  `dsh plugin add dsh-better-sidebar`。
- **防重复挂载**：内嵌侧边栏行使用独立 id `dsh-remote-sidebar` 并带 guard——
  若已存在其他 enabled 的 `dsh-better-sidebar` 条目（用户单独装过、或聚合 bundle
  已提供），内嵌行自动禁用，避免两个实例同时注册 `/sidebar/api` 导致整个插件树
  启动失败。
- 说明：若你已单独安装侧边栏，升级后无需卸载——guard 保证只挂载一份。
- **要求 `nodeLinker: hoisted`**：loader 从 profile 根解析插件包，内嵌侧边栏
  必须能在顶层 `node_modules` 解析到。这是 DSH profile 的默认 linker；若
  `pnpm-workspace.yaml` 被重写丢失该行，需补回 `nodeLinker: hoisted` 并
  `pnpm install` 一次（否则报 `Cannot find package 'dsh-better-sidebar'`）。
- 验证（verify9）：全新 profile `dsh plugin add dsh-remote`（nodeLinker:
  hoisted）→ pnpm 自动装 better-sidebar 并提升到顶层 → boot 成功、侧边栏
  「🌐 远程文件」tab 可用；已单独装侧边栏的 profile 升级后无重复挂载。

## 0.7.1 — 2026-08-20
### 修复：侧边栏显示本地镜像而非远程文件（issue #8 反馈）
- **现象**：安装 dsh-better-sidebar 后，侧边栏（better-sidebar 右侧面板）默认
  打开的是内置「文件」tab，显示**本地镜像目录**，而不是远程主机的文件。
- **修复**（纯客户端）：
  1. **有远程工作区时自动打开「🌐远程文件」tab** —— 注册 explorer 后监听
     better-sidebar snapshot，一旦有活动 session 且已配置远程工作区，就用
     `openTab`（带 path seed）把远程文件树打开到右侧面板并**激活**（内置
     `openTabInActivePane` 会把新 tab 设为 active），用户打开侧边栏直接看到
     远程文件，无需再点底部面板的卡片。
  2. **explorer 打开时自动加载目录** —— `refreshStatus` 首次设 levels 时立即
     `loadDir(workspace, 0)`，修复之前打开 explorer 显示「（空目录）」直到
     手动点 ↻ 的问题。
- 验证（verify8：dsh-better-sidebar@0.14.0 + dsh-remote 0.7.1）：
  - 右侧面板 tab 条：`Files 🌐远程文件`，远程文件激活显示
  - 内容：`远程工作区: /home/mmdev (root@9.134.186.191)` + 远程目录（gcc7）
  - 点击 gcc7 进入显示其子目录（lib64/libexec/bin/lib/include/share）

## 0.7.0 — 2026-08-20
### 新功能：dsh-better-sidebar 远程文件浏览（issue #8）
- **解决 issue #8「是否支持在 dsh-better-sidebar 中显示 ssh 远程主机的文件」**：
  之前 dsh-better-sidebar 的文件列表显示的是**本地 SFTP 镜像目录**，现在
  dsh-remote 注册两个侧边栏 tab，实时显示**远程主机**的文件：
- **`dsh-remote:explorer`（远程文件 🌐 tab）**：实时远程文件树——目录展开走
  `/dsh-remote/ls`（SSH 直连，不是本地镜像）；顶部显示当前远程工作区与
  主机；「…」按钮可打开目录选择器切换工作区；面包屑跳转上级目录。
- **`dsh-remote:file`（远程文件 tab）**：explorer 点文件打开，通过
  `/dsh-remote/read`（SFTP 实时读）渲染文本（UTF-8/CRLF→LF，256KB 截断），
  二进制文件显示大小与提示。**只读**——侧边栏编辑器保存会写本地 fs，
  远程文件若可编辑会静默存进镜像，所以编辑保持在 rw_* 工具/镜像工作流。
- **设计取舍**：不注册 file viewer（better-sidebar 的 viewer 匹配按扩展名/
  优先级，无法区分远程/本地路径，catch-all 会劫持所有本地文件打开）；
  改为专用 tab，只从 explorer 打开。
- dsh-better-sidebar 未安装时优雅跳过（`ctx.get('betterSidebar')` 守卫），
  现有功能零回归。
- 依赖：dsh-better-sidebar **v0.4.0+**（`registerTab` API；issue 报告者用的
  v0.14.0 验证通过）。

## 0.6.9 — 2026-08-20
### 修复 issue #4「选择目录时，如果有子目录时，选择框会遮挡确定菜单」
- **现象**：远程目录自动补全下拉从路径输入框向下绝对定位展开（`top: 100%`），
  展开后漂浮覆盖弹窗右下角的「设为远程工作区」确认按钮，用户无法点击确认。
- **根因**：补全下拉不参与文档流（`position: absolute`），且弹窗底部空间不足
  （`maxHeight: min(620px, 90vh)`），列表展开必然压住确认按钮；弹窗本身
  `overflow: hidden`，也没有滚动兜底。
- **修复**（纯客户端，刷新即生效）：
  - 自动补全下拉改为**流式展开**（参与文档流），展开时把确认按钮**推到下方**
    而不是覆盖，与目录浏览面板（`renderDirPopup`）既有的内联处理一致。
  - 远程 tab 容器 `overflow: hidden` → `overflowY: auto`：补全列表/浏览面板
    展开后弹窗内容超高时可滚动，确认按钮始终可达。
- 视觉验证：headless Chrome 渲染修复前后对比 —— before 中确认按钮被补全列表
  完全遮挡，after 中按钮完整可见、可点。

## 0.6.8 — 2026-08-20
### Windows 远程（cmd.exe / PowerShell）兼容
- **修复 issue #5「不兼容 Windows SSH 连接」**：远程机器为 Windows 时输入
  `D:\Code` 报 `not a directory (or unreachable): /D:\Code`。
- **根因**：`normalizeRemotePath` 按 POSIX 处理路径，把 `D:\Code` 破坏成
  `/D:\Code`；目录校验用 `if [ -d ]`（POSIX shell 语法），Windows 默认
  cmd.exe 下不可用。
- **路径层**：`normalizeRemotePath` 现支持 Windows 盘符（`D:\`、`C:/`）与
  UNC（`\\server\share`）路径，保留盘符与反斜杠分隔；`remoteDirname` /
  `remotePathBase` / `joinRemotePath` 同步支持两种分隔符。
- **SFTP 层**：新增 `toSftpPath`（`D:\Code` → `/D:/Code`，Win32-OpenSSH
  sftp-server 的 POSIX 风格）；`pool.sftp()` 所有方法自动转换路径并加
  超时保护（避免卡死的服务器挂住工具调用）。
- **浏览/校验**：`listDirStructured` 与 `rw_list_dir` 改用 **SFTP readdir**
  （协议级，不再依赖远程 `ls`）；目录存在性校验 `isRemoteDir` 用 SFTP
  stat 替代 `if [ -d ]`（rw_pick_workspace / workspace 路由 / mirror 路由）。
- **读写**：`rw_read_file` 从 `sed -n` 改为 SFTP readFile（分页不变）；
  `rw_write_file` / `rw_upload` 的 mkdir -p 用共享 `mkdirRemoteDirs`（支持
  `D:\a\b` 逐级创建）；`rw_search` 对 Windows 路径给出 PowerShell 提示。
- **连接探针**：`rw_info` / `rw_connect` 的 `echo ok; hostname; pwd` 改为
  `echo ok`（`;` 分隔在 cmd.exe 不可用）。
- 客户端 `lib/client.js`：远程目录浏览的路径拼接/补全支持反斜杠分隔符。
- POSIX 行为零回归（34 项单测通过：路径归一化 / dirname / SFTP 转换 /
  mkdir 链 / 回归）。

## 0.6.7 — 2026-08-20
### 远程目录浏览崩溃修复 + TOFU 主机指纹校验复活
- 修复「远程」目录选择器点浏览报 `The "data" argument must be of type string or
  an instance of Buffer, TypedArray, or DataView. Received undefined`。
- **根因**：ssh2 v1.17 的 `hostVerifier` 回调传入的是**裸 Buffer**（SSH
  host-key 二进制块，SSH wire 格式），而 v0.6.1 的 TOFU 实现按旧版
  `{ algo, hash }` 对象写的——`keyFingerprint` 对 `key.hash`（undefined）调
  `createHash().update()` 在**每次 SSH 连接**都抛错。ls/浏览走 SSH 连接 →
  每次必崩（单元测试用 mock 对象掩盖了契约漂移）。
- **修复**：`keyFingerprint` 兼容裸 Buffer（对整块 blob 做 SHA-256）与
  `{algo,hash}` 旧形态；算法名从 blob 头部解析（`blobAlgorithm`），known_hosts
  记录 `algo=ssh-ed25519`。
- 沙箱实测：ls 返回 myTower 真实目录列表（HTTP 200）；known_hosts 首次正确
  写入指纹；第二次连接指纹匹配；篡改指纹后新连接被**拒绝**（MITM 告警 +
  `/remote-forget-key` 重信任提示）。v0.6.1 的 TOFU 主机指纹校验首次在真实
  ssh2 下真正生效。

## 0.6.6 — 2026-08-20
### 本机目录选择器：真根因修复（DSH directoryPicker 服务实测缺失）
- 运行时诊断（沙箱临时路由）证实：`ctx.get('directoryPicker')` 实测为 **null**，
  `directoryPicker` 从未注册——web-app 的 `-auto` 行（`-auto` → native/browse
  后端）在桌面启动路径里不物化成 loader 条目（`loader.store` 只有 include+hmr；
  即便 `loader.create` 手动挂载 native 后端，服务也不出现）。之前"服务存在、
  只是 cordis 属性访问崩"的判断是错的，那只是 `without inject` 报错造成的误导。
- `/dsh-remote/local-pick` 改为**两级策略**：优先 `ctx.get('directoryPicker')`
  native 后端；服务缺位/非原生/抛错时**自持兜底**——插件自带原生选择器
  （macOS `osascript choose folder` / Linux `zenity→kdialog`，与 DSH native
  后端同一套调用约定），120s 超时 + 取消码识别。
- 沙箱端到端实测（真实对话框交互）：取消 → `{ok:true,cancelled:true,via:'own'}`；
  正选 → `{ok:true,path:"/Users/…",via:'own'}`，两分支均 HTTP 200。
- 客户端 `chooseLocal()` 无需改动（已兼容 path/cancelled/error 形状）。

## 0.6.5 — 2026-08-20
### 合并上游 0.5.8–0.5.10（客户端 UI 修复）
- 机器下拉从原生 `<select>` 改为自绘 dropdown（`ddRef` + 点击外部关闭），
  避免原生 select 的弹出层常驻遮挡下方按钮。
- 路径自动补全下拉支持点击外部空白处收起（`suggestRef` + `mousedown`）。
- 纯客户端改动：刷新页面即生效，无需重启。
### 开发模式
- 新增 `scripts/dev-run.sh`：**开发/沙箱模式**——在隔离的 DSH_HOME + 独立
  profile（硬链接拷贝产品 profile，`node_modules/dsh-remote` 换成指向源码的
  symlink）上启动桌面 harness，改源码即加载，**绝不触碰产品实例**。
  `--stop/--status/--refresh` 子命令见脚本头部。
- `scripts/dev-standards.md` 增加「沙箱优先」规则：日常迭代一律在沙箱验证；
  产品 profile 里的 `dsh-remote` 声明为 `^0.5.10`，任何 npm/plugin 重装都会
  覆盖手工部署的文件（v0.6.4 曾被重装回 0.5.10 顶掉，实证）。

## 0.6.4 — 2026-08-19
### Fixes（本机目录选择器崩溃）
- 修复「本机」目录选择器报错 `cannot get property "directoryPicker" without
  inject`：`/dsh-remote/local-pick` 路由取 picker 服务时用
  `ctx.directoryPicker` 属性访问作为兜底，但 cordis 规定**属性形式必须先在
  该插件的 `inject` 列表里声明**，未声明即抛错（与服务是否注册无关）。
  改为只用 `ctx.get('directoryPicker')`（按名解析、不要求 inject、缺失返回
  null）。修复后 DSH Desktop（macOS/loopback 绑定）下的**原生系统文件夹
  选择器可正常弹出**，不再需要退而手动填路径。
- 规范化补充：可选服务一律用 `ctx.get(name)`，禁用 `ctx.<name>` 属性形式
  （已并入 `scripts/dev-standards.md`，为第二条 cordis 约束教训）。

## 0.6.3 — 2026-08-19
### Fixes（启动崩溃）
- 修复 0.6.1 引入的**阻塞启动**回归：slash 命令原注册为 `remote.forget-key`，
  但 dsh-commands 框架要求命令名匹配 `/^[a-z][a-z0-9_-]*$/u`（不允许点号）。
  非法命令名导致**插件树加载失败、DSH Desktop 无法启动**。已改名为合法的
  `remote-forget-key`（帮助文案同步更新）。
### 开发流程硬化
- 新增 `check.mjs`（部署前闸门：校验所有 `commands.register()` 名符合框架约束）
  与 `scripts/boot-smoke.sh`（在隔离的 profile 拷贝上启动桌面 harness，证明
  插件树能加载）。`./sync.sh` 现在**拷贝前跑静态闸门、拷贝后跑启动冒烟**，
  阻塞启动的改动无法再被静默部署。
- 新增 `scripts/dev-standards.md`（dsh 插件开发规范，固化本次事故教训）。

## 0.6.2 — 2026-08-19
### Fixes
- **Remote directory picker**: structured listings now run `ls -1A -F` (classifies
  entries from readdir `d_type`, no per-entry `stat`) instead of a
  `for f in .[!.]* *` loop that stat'ed every entry. This fixes two real
  failure modes when browsing remote directories:
  - Directories with **no dotfiles** no longer fail with
    `zsh:1: no matches found: .[!.]*` (zsh `nomatch` aborts the old glob) —
    they now list normally.
  - Listing a directory that contains a **stuck FUSE/network mount** (e.g. an
    unresponsive s3fs/bucket mount) no longer hangs: the old loop's `[ -d ]`
    stat blocked in an uninterruptible kernel D-state (immune to SIGTERM),
    holding the SSH channel until the exec timeout. `ls -F` reads d_type
    without stat, so a dead mount can't stall the listing.
- Symlinked directories (`/bin@` …) remain enterable: symlink entries get one
  bounded `[ -d ]` follow-up (only symlinks are touched, never a stuck mount);
  if that stat is slow or fails the symlink degrades to a non-enterable file
  instead of failing the whole browse.

## 0.6.1 — 2026-08-18
### Security: host-key verification (TOFU)
- **New `hostKeyMode` config** (`accept-new` default · `verify` · `off`): the SSH host
  key is verified on every connect.
  - `accept-new` records a host's key on first connect and rejects any CHANGE
    afterwards (mirrors ssh's `StrictHostKeyChecking accept-new`) — closes the
    man-in-the-middle gap where ssh2 silently accepted any host key.
  - `verify` also rejects hosts never recorded before (strict).
  - `off` disables verification (not recommended).
- Trusted keys are stored at `$DSH_HOME/remote-workspaces/known_hosts.json`
  (SHA-256 base64 fingerprint per `host:port`), so they migrate with the data root.
- `rw_info` / `/remote` report host-key state; **`/remote forget-key`** and the
  `/dsh-remote/forget-key` endpoint drop a stale/mistrusted record so the next
  connect re-records it.
### Robustness
- `/dsh-remote/ls` parses `path` via URL search params (literal `+` decodes to space).
- POST request bodies are capped at 1 MiB.
- `/dsh-remote/mirror` now always verifies the directory over SSH (connecting if
  needed) instead of silently minting a mirror when disconnected.

## 0.6.0 — 2026-08-18
### Cross-platform & correctness fixes
- **Portable remote commands** — `rw_list_dir` and `rw_read_file` no longer use the
  GNU-only `ls --color=never` / `sed -n … --` forms, so macOS/BSD remotes work too.
- **Timeout now kills the remote process** — a timed-out `rw_exec`/`rw_read_file` sends
  `SIGTERM` to the remote command (then hard-closes the channel), instead of silently
  leaving it running and holding the SSH connection.
- **SSH connect race fixed** — `SshPool` gained a generational token; switching targets
  or closing mid-connect can no longer let a stale handshake claim the pool and point it
  at the old host. Dropped in-flight connects are swallowed, not unhandled rejections.
- **Mirror collision safety** — local mirrors are named `<host>-<user>-<port>/<base>`;
  when a different remote path already took that basename, a short path-hash suffix is
  appended so `/a/project` and `/b/project` never share a directory. First use keeps the
  clean basename label.
- **Persistent workspace** — picking a workspace (tool or UI) now saves it on the machine
  record, so it survives a restart.
- System-prompt injection text now says `rw_*` (matching the real tool names).
### Data location
- Machines + mirrors now follow `$DSH_HOME` (`remote-workspaces` under the harness home);
  pre-0.6 data under `~/.dsh/remote-workspaces` is migrated automatically on first run.
### Sync performance
- `rw_sync` / `rw_push` are **incremental** — files whose size+mtime match are skipped;
  local mtime is aligned on download so repeated syncs are cheap.
- New `maxFileBytes` cap (default 50 MiB) skips oversized files instead of yanking them
  into the mirror.
- Directory sweeps run with **bounded parallelism** (4-way) per level.
### New tools
- `rw_exec` accepts `cwd` and defaults to the current remote workspace.
- `rw_search(pattern, path?, glob?, ignoreCase?)` — portable recursive grep.
- `rw_download(path, localPath?)` / `rw_upload(localPath, path)` — single-file transfers.

## 0.5.7 — 2026-08-15
- **Fix boot crash (regression in 0.5.5/0.5.6):** tool schemas again use the DSH value-schema
  DSL form — `required: true` on leaf properties (the compiler derives the `required[]` array).
  The 0.5.5 "fix" moved `required` to a top-level array, which the DSL rejects
  (`schema.required is not supported by the value schema DSL`), making `dsh web` fail to boot
  with dsh-remote installed. Verified against the official `valueSchemaSpecToJsonSchema`
  compiler for both `parameters` and `output` schemas.

## 0.5.6 — 2026-08-15
- README previews now load from the jsDelivr CDN (`cdn.jsdelivr.net/gh/...`) instead of
  `raw.githubusercontent.com`, which is blocked/unstable in many networks. npm page README
  updated to match.

## 0.5.5 — 2026-08-15
- **Compliance fixes from the WhaleHarness audit** (https://github.com/flymysql/dsh-remote/issues/1):
  - Tool schemas no longer put `required: true` on leaf properties — required fields are now
    declared as a top-level `required: [ ... ]` array (the DSH-supported form).
  - Removed the implicit `~/.ssh/id_rsa` private-key default. `privateKeyPath` is now used
    **only when explicitly provided**; otherwise the plugin requires a password and fails with a
    clear message instead of silently reading a real key off disk.

## 0.5.4 — 2026-08-15

- **Publish metadata** — added `homepage` / `repository` / `author` / `bugs` so the
  npm page links back to the GitHub repo.

## 0.5.3 — 2026-08-15

### Workspace directory picker (fills the native “Add workspace” flow)
- The picker now renders as a **centered modal** (opaque panel + scrim), so it is
  never squeezed into the narrow sidebar.
- **Opens on the 本机 (local) tab** by default; the 远程 tab is one click away.
- **远程 / Remote**:
  - Path field **auto-prefills `/`** with a **live completion list** — selecting a
    directory immediately reveals its next level (OS/VSCode-style cascade).
  - A **浏览…** floating browser (opaque, height-capped, scrollable, follows symlinks)
    fills the field without committing; you review / edit, then **设为远程工作区**.
  - Fix: the modal no longer clips the native machine `<select>` dropdown.
- Real (desensitized, placeholder host) screenshot published in README.

## 0.5.2 — (baseline)
- Multi-machine SSH registry (add / edit / delete / set-current).
- `rw_info` `rw_connect` `rw_pick_workspace` `rw_list_dir` `rw_read_file`
  `rw_write_file` `rw_exec` `rw_sync` `rw_push` `rw_disconnect`.
- **测试连接** test-connection button. Password stored locally, never echoed.
- Directory-flow holes injected (client) at priority −100 — no `dsh-workspace`
  core is modified.
