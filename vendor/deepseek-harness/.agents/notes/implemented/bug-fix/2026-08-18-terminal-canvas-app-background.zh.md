# Agent Note: 终端画布使用应用背景

Status: implemented

[English](2026-08-18-terminal-canvas-app-background.md) | 中文

## Problem

对话列底栏终端与右边栏 Terminal occupant 会画一层不透明的 xterm 画布。AppFrame 已经铺了 `--dsw-alias-bg-base`，壁纸开启时还是对 transparent 的 `color-mix`。把该计算得到的 rgba 写入 xterm 的 `theme.background`、同时 `allowTransparency` 为 false，xterm 会把颜色换成 `#000000`。窗格还铺了 `--dsw-alias-bg-layer-2`（工作区根再铺一层 `--dsw-alias-bg-base`），因此 PTY 落在抬起层或叠加上，而不是与会话同一张画布。

## Decision

`TerminalWorkspace` 的 `.root` 保持 `background: transparent`。PTY 井本身是 `--dsw-alias-terminal-pane` 填充，由 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md) 拥有，现在按专属 `terminalOpacity` 滑杆取值（默认 `TERMINAL_PANE_MIN_SOLIDITY`）向背景混色，见 [终端窗格以保底实心度承载壁纸玻璃](../feature/2026-09-17-terminal-pane-glass-floor.zh.md)：没有 `backdrop-filter`，填充带 alpha 时 Ghostty 画布清回该 DOM 填充。`#dsh-wallpaper::after` 铺 `--dsw-alias-bg-mask-1`，对应 T3code 的 0.28 照片压暗。`theme.cursorAccent` 与 ANSI 0（`black`）用该不透明 RGB。鼠标 `selectionBackground` 为 `--dsw-alias-interactive-bg-hover-solid`。井上的 ANSI 1–15 与对比度重映射见 [PTY 的 ANSI 颜色跟随 T3code Pierre，而不是 UI 状态 token](2026-08-19-terminal-ansi-pierre-palette.zh.md)。反色单元格 CSS 见 [终端窗格以最小对比度如实渲染 TUI](2026-08-19-terminal-verbatim-tui-contrast-and-follow.zh.md)。`TerminalPane` 在 `open()` 后再铺一次主题，并观察壁纸／配色突变。工具条与会话列表铬仍用 `--dsw-alias-bg-base`。`.xterm-viewport` 在不透明窗格上保持透明。

## Alternatives considered

**无论有没有壁纸，都把 mix 后的会话画布涂实。** 拒绝：会话周围仍应透出壁纸；不透明井只在 `.paneTerminal`，见 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md)。

**有壁纸且浅色画布时，一律把 xterm 单元格涂成深色井。** 拒绝：井跟随主题半（浅井／深井）。PTY 挡住原图由 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md) 拥有；浅底强制深井是第二层皮肤。

**窗格继续铺 `--dsw-alias-bg-layer-2`，只打开 `allowTransparency`。** 拒绝作为对齐会话的填充：layer-2 是抬起对话框标记。井用 `--dsw-alias-terminal-pane` 作为不透明画布家族，而不是叠一层对话框。

**工作区根继续铺 `--dsw-alias-bg-base`，只清空 xterm 单元格填充。** 拒绝：在 AppFrame 上再叠两层 `color-mix` 会像会话列二次填充一样盖住壁纸。

**把 `theme.background` 留在 `rgba(0, 0, 0, 0)`，鼠标选区映射 `--dsw-alias-interactive-bg-hover`。** 拒绝：xterm 的 `opaque(background)` 变成 `#000000`，8% 白叠在这块黑上接近纯黑，TUI 选中行在壁纸上看不见。

**窗格完全透明，只透出 AppFrame 的 mix。** 拒绝：T3code 的 `.terminal-pane` 是透明 xterm 下的 `var(--glass-pane)` 加模糊。直接挖到原图会让 CodeBuddy 粗体加 info 的斜杠行没有台面。

## Consequences

空单元格、窗格 4px 内边距、以及 fitted 网格周围的空隙落在 `.paneTerminal` 不透明的 `--dsw-alias-terminal-pane` 上。壁纸位图由 `#dsh-wallpaper::after` 上的 `--dsw-alias-bg-mask-1` 压暗，仍透过会话画布、不透过 PTY 井。工具条芯片和会话列表仍落在 `--dsw-alias-bg-base` 上。工作区 `.root` 保持透明。

## Testing

`readXtermTheme` 钉住由 `--dsw-alias-bg-base` RGB 得到的不透明 `rgb(...)` 单元格填充（包括 `data-dsh-wallpaper` 下）、不透明的 `--dsw-alias-interactive-bg-hover-solid` 选区，以及 ANSI 0 等于该画布 RGB 而不是字形色。它解析 `color-mix(in srgb, #hex …)` 画布标记。抽屉套件钉住 `allowTransparency: false`、`.root` 保持透明、`.paneTerminal` 铺 `--dsw-alias-terminal-pane` 且无 `backdrop-filter`、窗格不用 `--dsw-alias-bg-layer-2`。反色单元格 token CSS 钉在如实渲染那条笔记。`mixWallpaperSurfaces` 钉住 `--dsw-alias-terminal-pane` 为不透明画布回退。壁纸表钉住 `#dsh-wallpaper::after` 为 `--dsw-alias-bg-mask-1`。

## Related

安置该窗格见 [右边栏与终端工作环](../feature/2026-08-16-surfaces-terminal-work-loops.zh.md)。FitAddon 与不拉伸的 `.xterm-screen` 见 [终端窗格 fit 与焦点](2026-08-17-terminal-pane-fit-and-focus.zh.md)。嵌套铬不重涂 `--dsw-alias-bg-base` 的规则见 [外观导航选中对比与壁纸画布实心度上限](2026-08-15-appearance-nav-contrast-and-wallpaper-canvas-cap.zh.md)。PTY 井不透明见 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md)。ANSI 1–15 与对比度重映射见 [PTY 的 ANSI 颜色跟随 T3code Pierre，而不是 UI 状态 token](2026-08-19-terminal-ansi-pierre-palette.zh.md)。反色单元格填充见 [终端窗格以最小对比度如实渲染 TUI](2026-08-19-terminal-verbatim-tui-contrast-and-follow.zh.md)。
