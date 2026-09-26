# Decision: 本地优先快捷键桥（desktop shortcut bridge）

Status: implemented

中文 | [English](2026-09-25-local-first-shortcut-bridge.en.md)

## Problem

上游 0.1.7-rc.2 的快捷键体系由 `ctx.shortcuts` 注册表 + 官方 `apps/desktop` 键盘桥组成：native-priority 策略下 Electron `before-input-event` 拦截物理键、port 到 BrowserView 由注册表裁定。鲸屿的壳没有这套桥，且官方策略会让桌面绑定键压制终端/编辑区的本地语义（Ctrl+C/Ctrl+W）。直接 vendor 上游包无法激活桌面快捷键能力；不做桥则键帽、设置面板、命令分派全部缺失。

## Decision

实现拆为四层，输入策略显式而非隐式：

1. **显式策略位**：上游包新增 `policy.ts`（`ShortcutInputPolicy = 'native-priority' | 'local-first'`），registry 与 DOM 安装器读 `data-shortcut-policy` 文档标记；缺省保持官方行为，绝不从 `runtime === 'desktop'` 推导。`local-first` 下物理键不被主进程 preventDefault——顶帧 DOM 分派器先同步裁定 region/modal，保护键（editable/terminal 的 Ctrl+C/Ctrl+W、terminal 裸 Ctrl+R）一律放行本地。

2. **壳侧服务** `src/main/shortcuts.js` + 协议快照 `src/main/shortcuts-protocol.mjs`：协议层是上游编译产物的桌面侧快照——打包后 vendored Harness 整树收进 `deepseek-harness.tar`，asar 里不存在 `vendor/.../shortcuts/lib/protocol.js`，主进程直接 import 会在启动即 `ERR_MODULE_NOT_FOUND`；快照把 `assertNever`/`randomUUID` 两个 vendored 依赖就地等价实现，协议语义与上游一致。`userData/keybindings.json` 唯一写入方（原子写）；`ShortcutPersistence` 提供 revision/sequence；缺失文件=官方默认，损坏/future schema=unreadable 且不会被 Restore All 回写。IPC 只收可信主帧（sender+mainFrame+origin 三重校验）。`before-input-event` 只做两件事：overlay 阻断时吞掉全部输入并压菜单 accelerator；命中已受理绑定的和弦压掉同名菜单 accelerator（一物理输入一执行者）。菜单点击经 `dispatchMenuCommand` 发 `{kind:'menu', commandId, revision}` 进 registry invoke， revision/焦点/recording/overlay 全查；closeWindow 复核 revision 后走 `win.close()`——P1 守卫照常生效。

3. **收窄的 preload 外观**：harness 主帧标记 `data-platform` + `data-shortcut-policy="local-first"`，暴露 `window.dshDesktop` 仅含 `keyboard`/`shortcuts` 两个窄面（不含 browser/updates），底层走 `shell:shortcuts-*` IPC；web localStorage 旧配置在目标文件缺失且 schema 合法时一次性迁入并留 `keybindings-migration.json` 回执，源数据保留。

4. **桌面 fork 收编 DOM 直听**：`PanelToggles` 的 keydown listener 在 desktop runtime 停用，Ctrl+\ / Ctrl+` 收进注册表（`surfaces.toggle`/`terminal.drawer.toggle`）；`pane.split`/`terminal.new` 让位 primary+shift；TerminalPane 补 `xterm` 类让 region 判定成立。菜单 `打开工作区/设置` 的键帽随有效绑定刷新，配置受理后解绑命令不再显示键帽；`重新加载界面` 让位 Ctrl+R 改 F5。全部 fork 变更登记进 `harness-desktop-forks.js` markers。

## Alternatives considered

- **照搬官方 native-priority**：物理键主进程拦截再 port——实现量相近但违反计划 §7.2 策略表（终端/编辑区保护键须本地优先），且 native 先于 DOM 消费无法保证"先同步裁定再消费"，不采用。
- **伪造完整 `dshDesktop` 对象**：少写一层适配，但会让无关插件误判运行时能力（browser/updates 不存在）；收窄到 keyboard+shortcuts 两面。
- **菜单项直连旧 handler 不进注册表**：菜单键帽与用户配置会漂移；改经 `dispatchMenuCommand` 让 invoke 统一跑 modal/revision 检查，dispatch 失败才回退本地 handler。
- **Ctrl+R 保留为窗口重载**：上游 `page.refresh` 占用 Ctrl+R 且语义是"刷新聚焦面板"；两个 owner 一个键违反单主原则，窗口重载移到 F5。
- **iframe/webview 按键转发**：官方有 'iframe'/'webview' 输入种类需要同步可信的 owner 证明；本地优先下无法同步证伪就让输入留在 guest（计划允许的默认），不异步丢键。

## Consequences

- 用户改键立即生效并持久化到 `keybindings.json`；写失败保留已受理配置与录制草稿；菜单键帽随配置重建。
- `Ctrl+\`/`Ctrl+`` 在 desktop 只有注册表一个 owner，terminal/editable 区域内不触发业务命令。
- `page.close`（Ctrl+W）链路为 registry → `keyboard.closeWindow(revision)` → 壳复核 → `win.close()` → P1 任务保护，关闭不绕过检查。
- 录制状态同时压 DOM 与菜单两条路；overlay 期间物理输入与菜单 accelerator 全被吞。
- Web 部署路径完全不变（webShortcutStorage + localStorage + PanelToggles DOM listener）。
- 测试面：`src/main/shortcuts.test.js` 覆盖持久化/迁移/sender 拒绝/overlay/录制/菜单分派/closeWindow revision；vendor client 侧策略分支依赖现有 upstream spec 继续回归。
