# Agent Note：焦点在 Ghostty 终端内时 Ctrl+` 仍能开关抽屉

Status: implemented

[English](2026-08-25-terminal-drawer-chord-ghostty.md) | 中文

## 问题

标题栏抽屉快捷键恰好在终端持有焦点时失效。两处独立断裂：`keybindings.isEditableKeyboardTarget` 仍匹配已退役的 `.xterm` 容器（Ghostty 渲染在 `[data-terminal-pane]` 内），而抽屉监听器用的 `isTextEntryTarget` 把 Ghostty 的隐藏输入 `textarea` 当成文本输入框，Ctrl+` 被跳过。此外 Ghostty surface 的 `onKeyDown` 会把该和弦编码送 PTY 并 `stopPropagation`，window 监听器根本收不到。keybindings fixtures 钉死了废弃的 `.xterm` DOM，测试常绿而产线已断。

## 决定

三处对齐修改。`keybindings.ts` 钉 `[data-terminal-pane]`：面板内 `isEditableKeyboardTarget` 为 true（Ctrl+\ 留给 PTY），`isTextEntryTarget` 为 false（隐藏 textarea 是终端而非文本框）。`terminalKeyShortcuts.isTerminalDrawerShortcut` 镜像标题栏判定，`TerminalPane.handleBeforeKey` 对该和弦仅 `preventDefault` 并返回 false——不 `stopPropagation`——事件冒泡到标题栏 window 监听器完成开关；返回 false 使 release 走 `suppressedKeyCodes`，Kitty report-event-types 会话不会收到孤立 keyup。fixtures 改为产线 DOM：`[data-terminal-pane]` 内含 textarea。

## 备选方案

**让面板在 `beforeKey` 里直接调 `toggleTerminalDrawer`** ——否决：toggle 在 ui-titlebar 的 inject face 里，跨包引用其它插件符号被禁止；让现有 window 监听器消费冒泡事件无需新缝。

## 后果

- 无论焦点在哪，Ctrl/Cmd+` 都能开关抽屉；终端内 Ctrl/Cmd+\ 仍送 PTY（SIGQUIT 等）。
- 产线选择器与 fixtures 不再引用 `.xterm`；测试钉 Ghostty DOM。
- Composer 等文本框对两个和弦保持豁免，行为不变。
