# Decision: 上游优先原生快捷键拦截（native-first shortcut interception）

Status: implemented
Supersedes: [2026-09-25-local-first-shortcut-bridge](../../archived/architecture/2026-09-25-local-first-shortcut-bridge.md)

中文 | [English](2026-09-26-native-first-shortcut-interception.en.md)

> Supersedes [2026-09-25-local-first-shortcut-bridge](../../archived/architecture/2026-09-25-local-first-shortcut-bridge.md)

## Problem

`local-first` 策略保护终端/编辑区按键，代价是注册表绑定在主帧渲染器收到 `keydown` 之后才裁定：抢占式绑定（`workspace.associate`、Debug 键、用户改绑的 Ctrl+W）在物理层与本地语义竞争，iframe/webview guest 内的已受理绑定根本不会到达顶帧。上游采纳计划要求快捷键与官方桌面行为一致（`native-priority`）。用户拍板采用上游优先拦截语义，本记录取代 09-25 的 local-first 决策。

## Decision

`src/main/shortcuts.js` 的 `attach()` 换成上游 `keyboard.ts` 拦截算法，`before-input-event` 在 DOM 分发前完成裁定：

1. **接受集裁决先于渲染**：`before-input-event` 只消费命中当前受理绑定的物理键并 `preventDefault()`；未命中键原样放行进入 DOM/编辑区/终端，本地语义不因"路过"被吞。覆盖键（`Control+C`/`Control+V`/`Control+W`）在用户未显式改绑时仍走本地，因为它们的默认绑定不在注册表里；一旦用户把 Ctrl+C 绑给某命令，上游语义即"用户授权压制本地"，与官方一致。

2. **Held 和弦跟踪**：主进程维护 pressMap（code→held）+ sequence，修饰键态从 hold 集合重建而非读 DOM；repeat 键仍带 `repeat:true` 供注册表续连；物理输入一执行者——命中受理绑定的和弦同时压同名菜单 accelerator（`contents.setIgnoreMenuShortcuts`）。

3. **Guest 接管**：owner 主帧拦截 `will-attach-webview` 之外的 `focus`/iframe 焦点时，绑定键按 `{kind:'iframe'|'webview'}` payload 直发注册表，guest 内未绑定键留在 guest（不异步丢键）。`sendEditingKey` 对 unaccepted 编辑键的旁路保留。

4. **安全不变量保留**：overlay 阻断仍 `event.preventDefault()` + `setIgnoreMenuShortcuts(true)`（上游无 preventDefault，保留我们的更强语义）；recording 抑制、closeWindow revision 复核、IPC sender+mainFrame+origin 三重校验、原子持久化、preload 收窄面全部不变。`data-shortcut-policy` 标记值改为 `native-first`，`local-first` 代码路径删除。

## Alternatives considered

- **保留 local-first**：与官方行为持续分叉，iframe/webview guest 的绑定键永远无法受理（计划明确要 webview 浏览器面板），不采用。
- **混合策略（guest native、主帧 local）**：两套裁定路径并发时序无法保证"一物理输入一执行者"，拒。
- **回写默认绑定到终端保护键**：把 Ctrl+C/Ctrl+W 固定为本地例外会破坏与官方注册表的一致性，用户改绑将无声失效，不采用——交给注册表裁定。

## Consequences

- `keybindings.json` schema/迁移不变；既有用户改绑继续生效。
- iframe/webview guest（WP1 浏览器面板）内绑定键正式生效。
- 已知取舍：用户若把终端常用键绑给全局命令，原生层会在 xterm 之前拦截——这是官方一致的授权语义，记录于此避免后续当 bug 修。
