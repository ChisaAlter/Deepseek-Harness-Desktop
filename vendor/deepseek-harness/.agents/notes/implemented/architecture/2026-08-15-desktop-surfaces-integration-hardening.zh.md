# Agent Note: 桌面 surfaces 集成加固

Status: implemented

[English](2026-08-15-desktop-surfaces-integration-hardening.md) | 中文

> 范围：把标题栏 / Git / 终端 / 右边栏 surfaces 整合进桌面壳时做的生产加固。组合结构见 [surfaces note](2026-08-14-desktop-surfaces-and-titlebar.zh.md)；本 note 记录只有真实桌面运行才暴露的缺陷，以及让该功能可以安全交付的信任、生命周期与打包决策。

## 问题

surfaces 分支通过了单元测试和浏览器测试，但真实 Electron 启动暴露了四类缺口：session 作用域的 store 在 `session-maybe` 下从未绑定；多个包重复声明了同一批 slot；终端是原始缓冲区而非 VT；打包后首次运行在解压运行时归档时挂起。此外，桌面能力接受了渲染层传入的任意 `cwd`，因此插件市场安装的插件可以借 `shell.gitPush` / `shell.readFile` 操作任意目录。

## 决策

**session-maybe 的 store 绑定到空 key。** `standardKit` 在无当前会话时跳过了 `session-maybe` 条目的 store 座位，于是 `SurfacesRoot` 与终端工作区在会话出现前挂载、永远拿不到 `useStore`。渲染器现在以空字符串作为 scope key 解析 `session-maybe` 的 store；surfaces 与终端 store 都用 `sessionId ?? ''` 作为自身桶 key，因此空实例在会话解析前是正确的。（`packages/client/ui-renderer/src/client/scoped-slots.tsx`）

**每个 slot 只有一个包声明。** catalog 门禁拒绝在两处声明同一个 slot。`ui-surfaces` 拥有 `surfaces.*` 子座，`ui-layout` 拥有 `shell.titlebar.trailing` / `shell.terminalDrawer`；占用方导入这些拥有者的 slot 类型，而不是重复声明 `SlotMap` 键。

**终端是真正的 VT。** 原始 `<pre>` 回放视图被替换为 `xterm` + `addon-fit`（`TerminalPane`）；store 的回放缓冲区播种并回填终端，实时 PTY 字节直接写入，拟合后的几何尺寸驱动 `ptyResize`。`@xterm/xterm` 同时是 `ui-user-terminal` 和 `dsh-client-web`（导入 `xterm.css`）的依赖。

**所有涉及文件系统的桌面 IPC 都锁定在工作区。** `workspace-authority` 模块授权配置的启动工作区，以及运行中 harness 工作区注册表里的每一条路径（`$DSH_HOME/storages/workspace.json`，即 `dsh-workspace` 持久化的 JSON unit）。渲染层传入的 `cwd` 必须落在其中一个根之内（`..`、绝对路径逃逸、缺失/非目录目标仍拒绝）。每次授权都会重读该注册表文件，因此在官方侧栏里新加的文件夹不必重建 authority 对象即可生效。`git.js`、`pty.js`、`workspace-fs.js` 都经它授权；测试注入临时根，因为 `node:test` 在 Electron 之外运行。

**PTY 与 BrowserView 随渲染器销毁。** `createPtyController` 增加 `killAll()`，`createPreviewController` 增加 `closeAll()`；`registerIpc` 返回这两个 controller，主进程在退出、Harness 重启和重载时清理它们。

**打包运行时归档用可移植的 tar 参数解压。** GNU tar（Git for Windows）把 `-f` 和 `-C` 上的 `C:` 盘符前缀当成远程主机、或无法打开反斜杠路径，而 Windows 自带的 bsdtar 拒绝 GNU 的 `--force-local`。`harness-extract.js` 和 `after-pack.js` 从归档目录运行 tar，并把 `-f` 与 `-C` 都写成正斜杠相对路径——这是两种实现都接受的形式。禁用 `build.npmRebuild`，让 electron-builder 直接使用 node-pty 的 N-API 预编译产物，而不是触发 node-gyp（后者需要 Visual Studio）。`DSH_SMOKE=1` 启动探针驱动真实 Electron 壳：组装后的 chrome，以及一次 PTY 创建 / 写入 / 终止往返。

## 曾考虑的替代方案

**保留原始缓冲区终端。** 它丢弃方向键、Home/End、Delete 和粘贴；交互 shell 不可用。完整 VT 渲染才是交付契约。

**按占用方重复声明 slot key。** TypeScript 会静默合并重复项，但 client-catalog 门禁无法归属文档并导致构建失败。单一拥有者规则是 catalog 接受的唯一形式。

**让渲染层选择文件系统根。** 第三方插件以渲染层权限运行；信任它的 `cwd` 会让它随意提交、推送或读取文件。主进程解析启动工作区与 harness 已注册路径，不接受渲染层任意传入的 cwd。

**用 node-gyp 重编 node-pty。** 不必要：node-pty 提供 N-API 预编译产物，在 Electron 中可直接加载。强制重编既需要 Visual Studio，又破坏了默认的预编译路径。

## 后果

surfaces 壳、终端和文件系统控件现在在打包安装中与单元测试里行为一致。首次运行解压运行时归档，随后终端完成一次 shell 往返，标题栏渲染其尾簇。打包冒烟（`DSH_SMOKE=1`）可在任何装有 Git for Windows 的 CI Windows runner 上复现。

## 测试

`workspace-authority.test.js` 钉住根/子目录的接受、第二个 harness 已注册根、局外人拒绝，以及 `..` / 绝对 / 缺失 / 文件目标的拒绝。`pty.test.js` 与 `preview.test.js` 钉住 `killAll` / `closeAll` 及 IPC controller 回传。`terminal-drawer` mock 了 xterm 并断言 write/data/resize 接线。根 `npm test` 覆盖桌面主进程模块和 `src/shared/post-merge-ui.test.js` 源码标记。`desktop-chrome.e2e.ts` 在浏览器 lane 钉住组装后的标题栏与五卡网格。`post-merge-desktop-ui.e2e.ts` 在同一 lane 走查 composer mention、Files/Agents/终端工作环、Appearance 图库图源，以及 MCP/Skills。`DSH_SMOKE=1` 在真实 Electron 里钉住启动 chrome、标题栏命中和一次 PTY 往返。`DSH_QA=1`（`npm run qa:source`）在同一 `webContents` 走查组装后的桌面 UI：composer、终端抽屉、Files/Agents/Diff/Browser/Terminal、Appearance 图库图源、MCP/Skills/Plugins/Market，以及 dshbot 插件挂上的侧栏贡献。

## 相关

[Slot 系统标准](2026-07-22-slot-type-chain-implementation.zh.md) 拥有组合模型。[桌面 surfaces 与标题栏](2026-08-14-desktop-surfaces-and-titlebar.zh.md) 拥有布局、标题栏尾簇与窗口控件避让。
