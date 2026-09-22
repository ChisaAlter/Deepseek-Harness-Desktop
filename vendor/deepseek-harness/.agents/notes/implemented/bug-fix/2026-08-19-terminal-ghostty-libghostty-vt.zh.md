# Agent Note: 交互式 PTY 窗格使用 T3code 的 libghostty-vt 适配

Status: implemented

[English](2026-08-19-terminal-ghostty-libghostty-vt.md) | 中文

## 问题

CodeBuddy 的斜杠菜单用 Ink 的 `bold` 加 `colors.info`（青色）标出选中行，未选中行用 dim / secondary。没有反色单元格、没有背景条、也没有 `>` 前缀。桌面窗格用 `@xterm/xterm`，连续多日改主题 token、`minimumContrastRatio`、井底不透明度和猜测的叠加层。单元测试和 bundle 哈希变绿，实机斜杠菜单仍不可用：xterm 的 DOM/canvas 路径不是 T3code 上线的渲染器。

## 决策

`ui-user-terminal` 窗格复制 T3code 的 web Ghostty 适配（`libghostty-vt` WASM + Canvas 2D `GhosttyTerminalSurface`），不再调 xterm。复制的模块是 `core.ts`、`runtime.ts`、`renderer.ts`、`surface.ts` 和 `keyCodes.ts`，外加钉死的 wasm/字体产物。接线文件只替换 Vite `?url`（`assets.ts`，由 `/plugins/<id>/assets/` 提供）、`isMacPlatform`，以及 T3code 的 `isMonospaceFamily` 探测。`terminalThemeFromApp` 是 T3code 的 fg/bg/cursor/selection 覆盖（本桌面的暗色标记是 `data-ds-dark-theme`，外加 T3code 的 `html.dark`）。种子回放调用 `resetAndWrite`。`beforeKey` 复制 T3code 的导航／删除／清屏辅助；T3code 应用专属和弦（`ResolvedKeybindingsConfig`）省略，因为本壳没有那份配置。窗格不再挂 xterm 的 DA1 解析器；Ghostty 在内部应答设备属性，回放时断开 PTY writer。

## 考虑过的方案

**继续用 xterm，继续调 Pierre / 对比度 / 透明度。** 否决：这条回路已经对 vitest 宣称「改好了」，实机斜杠菜单像素没有变。

**用 `coder/ghostty-web` 当 xterm 风格 API。** 否决：产品选择是 T3code 的适配，不是第三个 Ghostty 包装。

**在本包里重写一套更小的 Canvas VT。** 否决：规则是复制能用的适配，不是照着再写一遍。

## 后果

插件 `client.js` 从 `/plugins/@deepseek-ai/dsh-client-ui-user-terminal/assets/` 拉取 `ghostty-vt.wasm`、`ghostty-write-pty.wasm` 和 symbols Nerd Font。`@xterm/xterm` 不再是窗格依赖。对话里的 bash 卡片（`TerminalBlock`）不变。Windows PTY 启动复制 T3code 的 `createTerminalSpawnEnv` 和 `name: xterm-color`。Windows 上丢掉 Electron 的 `TERM=dumb`；T3code 的 Windows node-pty 不会把 `name` 写进 `$TERM`。选区的复制 / 加入对话 / 打开仍是现有工作环工具条。实机斜杠菜单只能用选中行的 CDP 截图证明，不能靠单元测试。

## 测试

复制来的 T3code helper/ABI 规格在 `tests/ghostty/`。`terminal-drawer.client.spec.tsx` mock `GhosttyTerminalSurface.create`，钉住种子 `resetAndWrite`、PTY 输入、选区操作、Ctrl-click 链接和 settle-fit 跟随。`node-half.client.spec.ts` 提供 `/plugins/<id>/assets/ghostty-vt.wasm`。覆盖率排除这份 vendored 适配目录；`TerminalPane.tsx` 和 `terminal-theme.ts` 的接线仍受门禁。

## 相关

[PTY 的 ANSI 颜色跟随 T3code Pierre，而不是 UI 状态 token](2026-08-19-terminal-ansi-pierre-palette.zh.md) 描述了已放弃的 xterm Pierre 映射；此处 ANSI 1–15 由 Ghostty 引擎色板拥有。[终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md) 拥有 `--dsw-alias-terminal-pane`。[ConPTY 启动匹配 T3code；DA1 每个 PTY 只应答一次](2026-08-18-terminal-conpty-oneshot-no-dll.zh.md) 拥有 Windows 启动；xterm 的 DA1 锁存器不被此窗格使用。
