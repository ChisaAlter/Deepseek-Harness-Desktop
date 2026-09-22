# Agent Note: ConPTY 设备属性不得回显成键盘输入

Status: implemented

[English](2026-08-18-terminal-conpty-device-attributes.md) | 中文

## Problem

新建的 Windows PTY 会在 PowerShell 提示符后出现 `[?1;2c`，像是用户敲进去的。这是 xterm 默认的主设备属性（DA1）应答。ConPTY 1.22+ 在握手时发送 `CSI c`，并等待 VT 61 级报告。xterm 通过 `onData` 回答 `ESC [?1;2c`，窗格把它写入 PTY，ConPTY 不把它当 DA1 消费，PowerShell 就把它回显出来。

## Decision

`attachConptyDeviceAttributes` 注册 `term.parser.registerCsiHandler({ final: 'c' })`。主 DA（`[]` 或 `[0]`）吞掉该查询，这样 xterm 不会再经 `onData` 发出 `?1;2c`。某个 PTY id 的第一次查询写入 `ESC [?61;4c`；之后同一 id 的解析（包括重挂载缓冲回放）返回 true 且不再写入。其它 `CSI c` 参数继续走默认处理。`TerminalPane` 在回放会话缓冲区之前安装该处理器（以及 `onData`）。不启用 bundled DLL、以及按 id 一次性锁存，见 [ConPTY 启动与 T3code 对齐；DA1 每个 PTY 只应答一次](2026-08-18-terminal-conpty-oneshot-no-dll.zh.md)。

## Alternatives considered

**在 `onData` 里过滤掉 `ESC [?1;2c`。** 拒绝：仍在进行的 ConPTY 1.22+ 握手还在等合规 DA1，会卡住数秒。

**只在 `onData` 路径把 `?1;2c` 换成 `?61;4c`。** 拒绝：默认处理器仍会触发；在解析时吞掉才是 VS Code 的 ConPTY 路径。

**对重挂载解析到的每个 `CSI c` 都应答，以便迟到的窗格仍能完成握手。** 拒绝：握手结束后那次写入是 PowerShell 的 stdin（`[?61;4c`）。按 PTY id 一次性应答见上一份笔记。

## Consequences

回放缓冲里残留的 `CSI c` 不会再经 `onData` 发出 xterm 的 `?1;2c`。次要 DA（`CSI > c`）仍走 xterm 默认的 `onData` 报告。`windowsPty` 包装启发式仍未设置；缺少 ConPTY wrap 变通是另一处缺口。

## Testing

`conpty-da.client.spec.ts` 钉住 `CSI c`／`CSI 0 c` 为主 DA、其它参数放行，以及 ConPTY 应答 `ESC [?61;4c`。抽屉套件驱动已注册的处理器，并断言 `ptyWrite(id, ESC [?61;4c)`，以及重挂载回放在写入已缓冲输出之前先注册该处理器。

## Related

不设 `useConptyDll` 与按 id 锁存见 [ConPTY 启动与 T3code 对齐；DA1 每个 PTY 只应答一次](2026-08-18-terminal-conpty-oneshot-no-dll.zh.md)。FitAddon 与 ConPTY 尺寸见 [终端窗格 fit 与焦点](2026-08-17-terminal-pane-fit-and-focus.zh.md)。PTY 井填充见 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md)。
