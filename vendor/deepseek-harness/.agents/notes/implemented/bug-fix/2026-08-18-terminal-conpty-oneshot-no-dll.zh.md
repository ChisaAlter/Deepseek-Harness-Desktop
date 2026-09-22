# Agent Note: ConPTY 启动与 T3code 对齐；DA1 每个 PTY 只应答一次

Status: implemented

[English](2026-08-18-terminal-conpty-oneshot-no-dll.md) | 中文

## Problem

关闭再打开 Windows 终端会在当前 PowerShell 提示符打出 `[?61;4c`（常常两次）。会话缓冲区里仍留着 ConPTY 握手的 `CSI c`。DSH 在窗格卸载时销毁 xterm，再把这段缓冲 `term.write` 进新解析器，于是在握手结束后把 DA1 写到 stdin，PowerShell 就把它回显出来。同一 PTY 还会存下诊断用的 shell 写入，重挂载时那些垃圾会像历史输出一样重放。

T3code（`ChisaTerminal`）不设 `useConptyDll`，跨重挂载缓存 xterm 实例，也没有 CSI `c` 处理器。DSH 在移植 T3code 时加了 `useConptyDll: true`，这才会让 ConPTY 1.22+ 发出 `CSI c`。

## Decision

Windows 的 `ptySpawnOptions` 保留 `useConpty: true`，不设 `useConptyDll`，与 T3code 的 node-pty 启动一致。`attachConptyDeviceAttributes` 仍吞掉主 `CSI c`，避免缓冲里残留的查询经 `onData` 发出 xterm 的 `?1;2c`。它每个 PTY id 最多写入一次 `ESC [?61;4c`。`bindPtyListeners` 在 `onPtyExit` 调用 `forgetConptyDeviceAttributes`，以便后续会话可以握手；xterm dispose 不清除锁存，因为抽屉重挂载不是新的 PTY。

## Alternatives considered

**保留 `useConptyDll: true`，并对解析到的每个 `CSI c` 应答。** 拒绝：这就是线上重挂载泄漏。握手已经结束；迟到的 DA1 写入是 PowerShell 的 stdin。

**只在 seed 期间静音 DA 应答，然后再打开。** 拒绝：第一次挂载时若缓冲里已有握手 `CSI c`，仍须应答一次。按 id 一次性覆盖首次 seed，并禁止重挂载再写。

**像 T3code 一样跨重挂载缓存 xterm。** 推迟：那会彻底去掉解析器回放，但是窗格生命周期改动。一次性 DA1 加上不启用 DLL 就能止住回显，不必先做缓存。

**关掉 DLL 之后删掉 CSI 处理器。** 拒绝：已有会话缓冲里仍有 `CSI c`。重挂载会经 `onData` 发出 `?1;2c`。

## Consequences

新建 Windows PTY 走 T3code 的 ConPTY 后端，不选择 1.22+ 的 DA1 握手。对已应答过的 PTY 隐藏／显示窗格会吞掉回放的 `CSI c`，不会打出 `[?61;4c`。回放缓冲里已经存下的垃圾仍须杀掉该 PTY 才能丢掉；重挂载不是截图恢复。[ConPTY 设备属性不得回显成键盘输入](2026-08-18-terminal-conpty-device-attributes.zh.md) 仍负责解析拦截。

## Testing

`pty.test.js` 钉住 `useConpty: true` 且不设 `useConptyDll`。`conpty-da.client.spec.ts` 钉住同一 id 第二次 attach 不再写入，以及 `forgetConptyDeviceAttributes` 允许之后再写。抽屉套件在 DA1 应答后重挂载 pty-1 并断言 stdin 只写一次，再驱动 `onPtyExit` 与复用 id 的第二次写入。

## Related

CSI 处理器见 [ConPTY 设备属性不得回显成键盘输入](2026-08-18-terminal-conpty-device-attributes.zh.md)。PTY 井填充见 [终端窗格是不透明的画布井](2026-08-19-terminal-pane-opaque-tui-stage.zh.md)。
