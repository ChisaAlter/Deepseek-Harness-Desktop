# Agent Note: 终端窗格以保底实心度承载壁纸玻璃

Status: implemented

[English](2026-09-17-terminal-pane-glass-floor.md) | 中文

## 问题

[终端窗格是不透明的画布井](../bug-fix/2026-08-19-terminal-pane-opaque-tui-stage.zh.md) 把 `--dsw-alias-terminal-pane` 钉成实心，因为 CodeBuddy 这类 TUI 只用粗体加前景色标记选中行、没有单元格背景——深度半透明让选中行无法分辨。但这也让终端成为壁纸／渐变永远透不进来的唯一铬面，用户把实心井读成背景没有生效。

## 决策

窗格加入壁纸混色，但不吃玻璃滑杆原值，而是吃独立的 `terminalOpacity` 持久化设置（40–100，默认 `TERMINAL_PANE_MIN_SOLIDITY` = 75）——井的实心度由 Appearance 里专属的「终端透明度」滑杆决定，终端可以比周围铬面更沉稳或更通透，包括透明主题下（否则窗格会继承 0% 输入）。低于 75 时 Appearance 只提示 TUI 选中行可读性而不钳制：75 是默认值和警告线，不是硬保底。`.paneTerminal` 仍铺该 token；`terminalThemeFromApp` 探读计算填充并把 alpha 报为 `GhosttyTheme.backgroundOpacity`。Ghostty 画布带 alpha（`getContext("2d", { alpha: true })`），`renderGhosttySnapshot` 把每个重绘区清回 DOM 填充，而不是重铺半透明底色——只有一层染色，DOM 与画布不会二次合成。显式 SGR 单元格背景仍画实心，光标与选区覆盖层同样。

## 曾考虑的替代方案

**窗格直接吃玻璃滑杆原值。** 否决：透明主题下该输入为 0，恰好复现不透明井当初修掉的 alpha-0 CodeBuddy 冲刷问题；专属设置在每种背景模式下都拥有自己的取值。

**混色保底 75、不给单独控件。** 否决：终端成了用户唯一调不动的表面，玻璃拉高时仍读作「背景没生效」；滑杆把可读性底线留作出厂默认，同时尊重显式取值。

**画布上也重铺半透明底色。** 否决：同一个 color-mix 合成两次会把透明度平方（80% DOM 填充叠 80% 画布填充约读作 96% 实心），窗格会比滑杆所示更实。

## 后果

开箱时终端井透出壁纸／渐变的四分之一——足以让窗格明显参与，又足够克制让「粗体加颜色」的选中行保持可读。拉到 75 以下是用户自己的选择，Appearance 只警告不禁止。透明主题下终端没有特殊规则：窗格同样按自己的设置混色。任何 `backgroundOpacity < 1` 的路径必须先清屏再重绘，否则旧字形会残留在透明帧不再铺色的位置。

## 测试

`mixWallpaperSurfaces` 规格把窗格钉在显式 `terminalSolidity` 入参上——75 处、其上与其下，含透明主题的 0% 表面输入。`terminalThemeFromApp` 规格钉住从计算填充读出的 `backgroundOpacity`，以及不可绘制颜色的哨兵像素回落。`renderGhosttySnapshot` 规格钉住半透明底时画布与脏行的 `clearRect`，且显式单元格背景仍填充。Appearance 规格钉住滑杆写入，以及背景生效／低于底线／无背景三种提示的切换。

## 相关

[终端窗格是不透明的画布井](../bug-fix/2026-08-19-terminal-pane-opaque-tui-stage.zh.md) 拥有 75 底线所保留的可读性理由；本 note 取代其「从不混色」条款。[终端画布使用应用背景](../bug-fix/2026-08-18-terminal-canvas-app-background.zh.md) 拥有透明工作区根与壁纸压暗。
