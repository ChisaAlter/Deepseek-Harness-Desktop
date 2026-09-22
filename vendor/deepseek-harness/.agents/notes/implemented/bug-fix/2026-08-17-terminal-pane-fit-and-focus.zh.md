# Agent Note: 终端窗格 fit 与焦点

Status: implemented

[English](2026-08-17-terminal-pane-fit-and-focus.md) | 中文

## Problem

在右边栏 Terminal surface 里打开四个平铺 PTY 后，只有部分窗格能打出完整的 PowerShell 提示符并接收输入。先打开的窗格会在列边界截断 `PS C:\…`；后打开的窗格可能显示完整提示符，但按键仍进另一个 xterm。会话列底栏抽屉共用同一个 `TerminalWorkspace`，四向分屏会以同样方式失败。

宿主还没有 CSS 盒子时，FitAddon 仍会报出 xterm 默认 80×24（或最小 2×1）。该尺寸会立刻转给 ConPTY。随后 PowerShell 按错误的列数打印提示符。把 `.xterm-screen` 拉到 100% 会盖住这一失配。点击窗格画布会 stopPropagation，`activate` 从不运行；`activeId` 变化时也不调用 `Terminal.focus()`，因此侧栏高亮与获得焦点的 xterm 会分叉。

## Decision

`TerminalPane` 只在 `hostHasFitSize` 为真（`clientWidth` 与 `clientHeight` 都 > 0）时 fit。它在 rAF、30 ms 之后、`ResizeObserver`、以及 `document.fonts` 的 `loadingdone` 上重新 fit。`ptyResize` 防抖 150 ms，网格未变则跳过。本地 xterm 网格仍在每次成功 fit 时更新。活动窗格在 rAF 上调用 `term.focus()`。宿主上的 pointerdown 激活该会话；click 仍停在宿主，以免铬的 `tabIndex` 组抢走插入符焦点。`.xterm-screen` 与 `.xterm-viewport` 不会被拉到 100%。抽屉与 surface 共用这一窗格。

## Alternatives considered

**等第一次成功 fit 后再 spawn PTY。** 拒绝，因为创建已经在和 shell 横幅赛跑；推迟 spawn 只会多出空白窗格，并不能省掉对零尺寸 fit 的跳过，以及对后续分屏的防抖。

**保持立刻 `ptyResize`，只修焦点。** 拒绝，因为即使后来的窗格已聚焦，四向分屏过程中 ConPTY 仍会按 1 行网格重打提示符。

**用 CSS 把 80×24 画布缩放到窗格。** 拒绝，因为字形单元格将不再匹配 PTY 网格，点击与折行仍然是错的。

## Consequences

折叠的抽屉或尚未完成布局的 grid 单元格不会去 resize ConPTY。布局稳定后，每个可见窗格报告同一套 fitted 网格，侧栏的活动行拥有 xterm 输入。若 shell 快于 150 ms 防抖，第一条 PowerShell 提示符仍可能按 spawn 默认 80×24 打印；一旦宿主有盒子，xterm 会在本地重折行。矮列里四个上下平铺窗格仍可能只有一两行高；那是平铺本身，不是跳过了 fit。

## Testing

`ui-user-terminal` 钉住：零尺寸宿主不调用 `ptyResize`；有盒子的宿主防抖调用 `ptyResize(id, 80, 24)` 且同一网格不重复通知；FitAddon 抛错与 0×0 网格跳过；缺少 `ResizeObserver`；窗格重挂载时重放 buffer；活动窗格的 `focus()` 跟随侧栏激活；pointerdown 激活；以及 CSS 不拉伸 `.xterm-screen`。`hostHasFitSize` 拒绝 0×0 和高度为 0。`sessionBuffer` 返回记录字节或 `''`。

## Related

安置该窗格的工作环见 [右边栏与终端工作环](../feature/2026-08-16-surfaces-terminal-work-loops.zh.md)。
