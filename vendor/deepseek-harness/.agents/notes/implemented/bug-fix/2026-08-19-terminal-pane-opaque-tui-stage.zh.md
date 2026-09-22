# Agent Note: 终端窗格是不透明的画布井

Status: implemented

[English](2026-08-19-terminal-pane-opaque-tui-stage.md) | 中文

> 可读性理由仍然有效，现在拥有 `TERMINAL_PANE_MIN_SOLIDITY` 底线（`terminalOpacity` 滑杆的默认值与提示线）；「从不混色」条款已被 [终端窗格以保底实心度承载壁纸玻璃](../feature/2026-09-17-terminal-pane-glass-floor.zh.md) 取代。

## 问题

CodeBuddy 斜杠菜单用 Ink 的 `bold` 加 `colors.info` 标记选中行，且 `showIndicator: false`——没有反色、没有单元格背景、没有 `>` 前缀。桌面窗格把这些字形放在 alpha-0 的 xterm 填充上，下面是 12% 壁纸结霜，info 对 secondary 被冲掉，选中态无法分辨。客户端 overlay 用正则和本地方向键索引猜行，会把条画错。`minimumContrastRatio` 对着 alpha-0 画布 RGB 只能让字能读，造不出选中行。

## 决策

PTY 井保持足够不透明以读出 TUI 选中态。设计表上 `--dsw-alias-terminal-pane` 为 `var(--dsw-alias-bg-base)`；背景生效时 `mixWallpaperSurfaces` 按专属的 `terminalOpacity` 设置混色（40–100，默认 `TERMINAL_PANE_MIN_SOLIDITY` = 75，Appearance 把它当作可读性提示线）——见上方取代说明。`.paneTerminal` 铺该 token，没有 `backdrop-filter`。`terminalThemeFromApp` 把计算填充的 alpha 报为 `backgroundOpacity`，Ghostty 画布因此清回 DOM 填充而不是二次合成。壁纸仍把会话画布与侧栏混得比井更深。窗格仍不画猜出来的选中条，选中态就是 TUI 自己的 SGR。ANSI 青／蓝为 Pierre，见 [PTY 的 ANSI 颜色跟随 T3code Pierre，而不是 UI 状态 token](2026-08-19-terminal-ansi-pierre-palette.zh.md)。

## 曾考虑的替代方案

**保留壁纸玻璃，在猜出的行上铺自适应 hover 洗色。** 否决：洗色可控，行不可控；本地方向键索引会与 TUI 脱同步，SGR 刮取还会误伤普通输出。

**加厚 12% 结霜直到粗体加 info 可读。** 否决：字形背后仍是半透明照片，并且为修一个菜单在全局出卖壁纸。

**单元格继续 alpha-0，只靠 `minimumContrastRatio`。** 否决：对着画布 RGB 提对比并不能在 TUI 从未画背景时重建选中行。

**窗格铺 `--dsw-alias-bg-layer-2`。** 否决：layer-2 是抬起对话框标记；井跟随画布家族，而不是叠一层对话框。

## 后果

CodeBuddy 原生的粗体加 info 高亮落在永不低于四分之三实心度的井上，选中态仍是 TUI 自己的 SGR 且舞台可读。会话、侧栏和抬起铬仍走完整玻璃滑杆；井只参与到底线为止。

## 测试

`terminalThemeFromApp` 钉住从计算窗格填充读出的 `backgroundOpacity`，以及不可绘制颜色的哨兵回落。抽屉套件钉住 `.paneTerminal` 背景 `--dsw-alias-terminal-pane` 且无 `backdrop-filter`。`mixWallpaperSurfaces` 把窗格钉在显式 `terminalSolidity` 入参的底线处、其上与其下（含透明主题 0% 表面输入）；`renderGhosttySnapshot` 在半透明底下清空重绘区。`wallpaper.css` 不含 `--dsw-terminal-pane-blur`。

## 相关

[终端画布使用应用背景](2026-08-18-terminal-canvas-app-background.zh.md) 拥有透明工作区根、壁纸压暗，以及嵌套铬不在会话画布上重涂 `--dsw-alias-bg-base` 的规则。[终端窗格以最小对比度如实渲染 TUI](2026-08-19-terminal-verbatim-tui-contrast-and-follow.zh.md) 拥有已删除的行画笔与反色单元格 CSS。[PTY 的 ANSI 颜色跟随 T3code Pierre，而不是 UI 状态 token](2026-08-19-terminal-ansi-pierre-palette.zh.md) 拥有 ANSI 1–15 与 `minimumContrastRatio`。
