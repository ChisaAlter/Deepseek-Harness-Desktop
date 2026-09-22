# Agent Note: PTY 的 ANSI 颜色跟随 T3code Pierre，而不是 UI 状态 token

Status: implemented

[English](2026-08-19-terminal-ansi-pierre-palette.md) | 中文

## 问题

CodeBuddy 斜杠菜单用 Ink 的 `bold` 加 `colors.info`（青色）标记选中行，未选中行用 dim／secondary。T3code 的 web 终端是 Ghostty：只从应用覆盖 fg/bg/cursor，ANSI 1–15 留在引擎的鲜艳色板，并且不重映射对比度。T3code 在 Windows 上的 PTY `name` 是 `xterm-color`，因此 Ink 发出 16 色 SGR。桌面 xterm 把青色映射到 `--dsw-alias-state-success-secondary`（green-400），蓝色映射到 business-primary，并把 `minimumContrastRatio` 设为 4.5，于是 dim 行被提升到与正常文字接近的亮度。选中态只剩几乎同色上的粗体，13px 下看不见。把窗格涂实并不能恢复 T3code 的观感，因为色板和对比度重映射仍然是错的。

## 决策

Windows 的 `ptySpawnOptions` 复制 T3code `NodePtyAdapter`：Windows 上 `name` 为 `xterm-color`（其它平台 `xterm-256color`），env 为 `createTerminalSpawnEnv`。Windows 上丢掉 Electron 的 `TERM=dumb`，使 Node 色深与 T3code 未设置 `$TERM` 时一致。交互窗格是 T3code 的 Ghostty 适配，ANSI 1–15 留在引擎色板，应用只覆盖 fg/bg/cursor/selection；见 [交互式 PTY 窗格使用 T3code 的 libghostty-vt 适配](2026-08-19-terminal-ghostty-libghostty-vt.zh.md)。`TERMINAL_MINIMUM_CONTRAST` 仍为 `1`，留给任何剩余的 xterm 调用方。窗格仍不画猜出来的选中条。

## 曾考虑的替代方案

**保留 UI token 的 ANSI，只关掉对比度提升。** 否决：青色仍会是 green-400，既不是 T3code，也不是 Ink 的 `info`。

**整表采用 xterm 默认 16 色。** 否决：Pierre 是 T3code 已命名、移动端在用的色板；菜单选中需要的就是青色 `#08c0ef`。

**恢复客户端选中行 overlay。** 否决：TUI 已经发出高亮；是渲染器把它冲掉了。

## 后果

会话和设置铬不变。Windows PTY 的 `name` 为 `xterm-color`；`TERM` 沿用宿主进程已有值。交互 PTY 字形是 Ghostty 引擎 ANSI，不是客户端 Pierre 表。

## 测试

`ptySpawnOptions(..., 'win32')` 钉住 `name` 为 `xterm-color` 以及继承的 `TERM`；省略尺寸时为 120×30；Linux 保持 `name` 为 `xterm-256color`。`TERMINAL_MINIMUM_CONTRAST` 为 1。Ghostty 主题测试钉住 fg/bg/cursor，没有 ANSI 表。

## 相关

井不透明见 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md)。已删除的行画笔见 [终端窗格以最小对比度如实渲染 TUI](2026-08-19-terminal-verbatim-tui-contrast-and-follow.zh.md)；对比度重映射在本笔记退役。不带 DLL 的 ConPTY 见 [ConPTY 启动与 T3code 对齐；DA1 每个 PTY 只应答一次](2026-08-18-terminal-conpty-oneshot-no-dll.zh.md)。
