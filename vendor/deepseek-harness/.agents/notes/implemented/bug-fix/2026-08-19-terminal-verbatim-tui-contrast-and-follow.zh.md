# Agent Note: 终端窗格以最小对比度如实渲染 TUI

Status: implemented

[English](2026-08-19-terminal-verbatim-tui-contrast-and-follow.md) | 中文

## 问题

桌面终端窗格（会话底栏抽屉与右边栏 surface）为了让 CodeBuddy 斜杠菜单在壁纸毛玻璃上可读，曾抓取 DomRenderer 行、用正则把文本归类为"菜单行"，再把 info 填充条涂到本地箭头索引猜出的选中行上。这面镜子在两个方向上都失灵：`MENU_COMMAND` 正则（小写单词后跟两个空格）会匹配 `git status`、目录列表等普通对齐输出，随机行被刷上蓝条；本地箭头索引在过滤、重挂载或漏掉一次按键后与 TUI 真实选中态永久脱同步，画出的条落在错误的菜单行上。重涂环路（MutationObserver 加 `onRender` 加 rAF 二次通过）还会重复处理每一次视口变更。另外几个独立缺陷：每次成功 refit 都强制 `scrollToBottom()`，任何布局变化都把用户从回滚位置拽回底部；`pty.js` 仍以 `useConptyDll: true` 启动，与已定案的[一次性 DA 决策](2026-08-18-terminal-conpty-oneshot-no-dll.zh.md)相悖；256 KiB 回放缓冲封顶从任意字节掐头，重挂载回放可能从转义序列中间开始并弄乱解析。

## 决策

窗格如实渲染 PTY 发来的内容，绝不重涂 TUI 自己画的行。删除 `tui-selected-row.ts`、其 overlay 层、箭头追踪器与变更重涂环路。PTY 井不透明，由 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md) 拥有。ANSI 1–15 与对比度重映射由 [PTY 的 ANSI 颜色跟随 T3code Pierre，而不是 UI 状态 token](2026-08-19-terminal-ansi-pierre-palette.zh.md) 拥有。xterm 的 `minimumContrastRatio` 为 1；TUI 的真实高亮（粗体加 info／青色）就是 TUI 画的那个。refit 只在 `shouldFollowOutput` 看到视口本就停在最后一行（`viewportY >= baseY`）时才调用 `scrollToBottom()`；在其上方任何位置，回滚保持不动。win32 的 `ptySpawnOptions` 为 `{ useConpty: true }` 且不含 `useConptyDll`，与一次性 DA 笔记一致；`conpty-da.ts` 的 DA1 闩锁保留，因为回放缓冲仍含 `CSI c`。`appendData` 把封顶掐头切点在 `BUFFER_REALIGN_WINDOW`（4096）内对齐到下一个行首或 ESC，回放绝不从转义序列内部开始。`hostHasFitSize` 按去掉 padding 的内容盒测量：挂在收起右侧栏里的终端只剩 4px 内边距（`clientWidth` 为 8），对它 fit 会把网格夹到 FitAddon 的 2 列下限并把活的 ConPTY 一起压成 2 列（修复前实机观察到）。

## 曾考虑的替代方案

**保留画条机制并把箭头跟得更紧（捕获 keydown、夹取索引）。** 否决：该索引是对远端 TUI 状态的客户端猜测；过滤菜单的输入、鼠标选择、Home/End 或漏掉一次按键都会让它永久脱同步，行正则也仍会误伤普通输出。没有真值源的镜子怎么跟都跟不齐。

**加厚窗格结霜让原生 ANSI 可读。** 否决：字形背后仍是照片。井改为不透明，见 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md)。

**重涂 `.xterm-bold` 或反色 class 来标记选中。** 之前否决，现在依然：CodeBuddy 在数百个节点上设粗体，而它的菜单从不设反色。

**改为在数据到达时总是滚动而不是在 fit 时。** 否决：xterm 本就在贴底时随写入跟进；缺陷只是 `fitNow` 里的强制滚动。

## 后果

普通输出（`git status`、对齐列表、man 手册页）再也不可能得到幻影选中条。CodeBuddy 的菜单选中就是 CodeBuddy 画的那一行，随它自己的箭头处理移动、不会漂移。dim 对 info 的对比是 Ink 发出的 Pierre 青色对 dim SGR；`minimumContrastRatio` 为 1，不重映射这些色相。回滚阅读在分屏、抽屉拖高、字体加载后都不被打断。Windows 用系统 ConPTY 启动且不带捆绑 DLL，实时 SGR 与 T3code 参照一致。重挂载回放从干净边界开始；为找到边界最多丢弃封顶切点之后 `BUFFER_REALIGN_WINDOW` 字节。

## 测试

`terminal-drawer.client.spec.tsx` 钉住构造终端上的 `minimumContrastRatio`、只从底部跟随的 refit（`keeps the scrollback position on refit unless the viewport was at the bottom`）、反色单元格 token CSS，以及样式表中不存在 `data-dsh-tui-selected`／`dsh-tui-selected-bar`。`fit.client.spec.ts` 覆盖 `shouldFollowOutput`（贴底、在其上方、缺失 buffer/字段）与 `TERMINAL_MINIMUM_CONTRAST` 为 1。`terminal-session-store.client.spec.ts` 覆盖 `realignBufferStart`（取行首/ESC 中最早者、窗口回退）以及 `appendData` 的溢出路径。`fit.client.spec.ts` 还让 `hostHasFitSize` 拒绝只剩 padding 的宿主（收起的右侧栏）。`src/main/pty.test.js` 断言 `useConpty: true` 且不含 `useConptyDll`。

## 相关

[终端画布使用应用背景](2026-08-18-terminal-canvas-app-background.zh.md) 拥有透明工作区根与壁纸压暗。[终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md) 拥有 `--dsw-alias-terminal-pane` 不透明度。[PTY 的 ANSI 颜色跟随 T3code Pierre，而不是 UI 状态 token](2026-08-19-terminal-ansi-pierre-palette.zh.md) 拥有 ANSI 1–15 与对比度重映射。[不带 DLL 的 ConPTY 一次性 DA](2026-08-18-terminal-conpty-oneshot-no-dll.zh.md) 拥有本笔记 spawn 选项如今对齐的 DA1 闩锁。[终端窗格 fit 与焦点](2026-08-17-terminal-pane-fit-and-focus.zh.md) 拥有 FitAddon 门控与 resize 防抖。
