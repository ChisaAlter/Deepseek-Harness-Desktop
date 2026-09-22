# Agent Note: ConPTY spawn matches T3code; DA1 is one-shot per PTY

Status: implemented

English | [中文](2026-08-18-terminal-conpty-oneshot-no-dll.zh.md)

## Problem

Closing and reopening a Windows terminal types `[?61;4c` (often twice) at the live PowerShell prompt. The session buffer still contains ConPTY's handshake `CSI c`. DSH disposes xterm on pane unmount and `term.write`s that buffer into a new parser, which answers DA1 on stdin after handshake is over, so PowerShell echoes the bytes. The same PTY also stored diagnostic shell writes, so remount replays that junk as if it were history.

T3code (`ChisaTerminal`) does not set `useConptyDll`, caches the xterm instance across remounts, and has no CSI `c` handler. DSH's T3code port added `useConptyDll: true`, which is what makes ConPTY 1.22+ send `CSI c`.

## Decision

Windows `ptySpawnOptions` keeps `useConpty: true` and omits `useConptyDll`, matching T3code's node-pty spawn. `attachConptyDeviceAttributes` still swallows primary `CSI c` so a leftover buffered query cannot emit xterm's `?1;2c` through `onData`. It writes `ESC [?61;4c` at most once per PTY id. `bindPtyListeners` calls `forgetConptyDeviceAttributes` on `onPtyExit` so a later session may handshake; xterm dispose does not forget, because drawer remount is not a new PTY.

## Alternatives considered

**Keep `useConptyDll: true` and answer every parsed `CSI c`.** Rejected: that is the live remount leak. Handshake is already finished; a late DA1 write is PowerShell stdin.

**Mute DA replies only while seeding, then enable them.** Rejected: a first mount whose buffer already holds handshake `CSI c` must still answer once. One-shot per id covers first seed and forbids remount.

**Cache xterm across remounts as T3code does.** Deferred: that removes parser replay entirely, but it is a pane-lifetime change. One-shot DA1 plus omitting the DLL fix the echo without that cache.

**Drop the CSI handler once the DLL is off.** Rejected: existing session buffers still contain `CSI c`. Remount would then send `?1;2c` through `onData`.

## Consequences

New Windows PTYs follow T3code's ConPTY backend and do not opt into the 1.22+ DA1 handshake. A pane hide/show of an already-answered PTY swallows replayed `CSI c` and does not type `[?61;4c`. Killing the PTY is still required to drop junk already stored in the replay buffer; remount is not a screenshot restore. [ConPTY device attributes must not echo as typed input](2026-08-18-terminal-conpty-device-attributes.md) still owns the parser intercept.

## Testing

`pty.test.js` pins `useConpty: true` and `useConptyDll` unset. `conpty-da.client.spec.ts` pins a second attach for the same id does not write, and `forgetConptyDeviceAttributes` allows a later write. The drawer spec remounts pty-1 after a DA1 answer and asserts one stdin write, then drives `onPtyExit` and a reused id for a second write.

## Related

[ConPTY device attributes must not echo as typed input](2026-08-18-terminal-conpty-device-attributes.md) owns the CSI handler. [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md) owns the PTY well fill.
