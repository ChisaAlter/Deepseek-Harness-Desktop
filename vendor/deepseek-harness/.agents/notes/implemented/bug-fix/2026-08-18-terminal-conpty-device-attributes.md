# Agent Note: ConPTY device attributes must not echo as typed input

Status: implemented

English | [中文](2026-08-18-terminal-conpty-device-attributes.zh.md)

## Problem

A new Windows PTY shows `[?1;2c` after the PowerShell prompt as if the user had typed it. That string is xterm's default primary device-attributes (DA1) answer. ConPTY 1.22+ sends `CSI c` during handshake and waits for a VT-level 61 report. xterm answers `ESC [?1;2c` through `onData`, the pane writes that to the PTY, ConPTY does not consume it as DA1, and PowerShell echoes it.

## Decision

`attachConptyDeviceAttributes` registers `term.parser.registerCsiHandler({ final: 'c' })`. Primary DA (`[]` or `[0]`) swallows the query so xterm does not emit `?1;2c` on `onData`. The first such query for a PTY id writes `ESC [?61;4c`; later parses of the same id, including remount buffer replay, return true without writing. Other `CSI c` parameters fall through. `TerminalPane` installs the handler (and `onData`) before replaying the session buffer. Spawn without the bundled DLL, and the one-shot latch, are owned by [ConPTY spawn matches T3code; DA1 is one-shot per PTY](2026-08-18-terminal-conpty-oneshot-no-dll.md).

## Alternatives considered

**Filter `onData` for `ESC [?1;2c` and drop it.** Rejected: a live ConPTY 1.22+ handshake still waits for a conforming DA1, which stalls for seconds.

**Replace `?1;2c` with `?61;4c` only on the `onData` path.** Rejected: the default handler would still fire; swallowing at parse time is the VS Code ConPTY path.

**Answer every remounted `CSI c` so a late pane still completes handshake.** Rejected: after handshake, that write is PowerShell stdin (`[?61;4c`). One-shot per PTY id is in the note above.

## Consequences

A leftover `CSI c` in the replay buffer cannot emit xterm's `?1;2c` through `onData`. Secondary DA (`CSI > c`) still uses xterm's default `onData` report. `windowsPty` wrapping heuristics remain unset; missing ConPTY wrap workarounds are a separate gap.

## Testing

`conpty-da.client.spec.ts` pins `CSI c` / `CSI 0 c` as primary DA, other parameters as fall-through, and the ConPTY response `ESC [?61;4c`. The drawer spec drives the registered handler and asserts `ptyWrite(id, ESC [?61;4c)`, and remount replay registers that handler before writing the seeded buffer.

## Related

[ConPTY spawn matches T3code; DA1 is one-shot per PTY](2026-08-18-terminal-conpty-oneshot-no-dll.md) owns `useConptyDll` unset and the per-id latch. [Terminal pane fit and focus](2026-08-17-terminal-pane-fit-and-focus.md) owns FitAddon and ConPTY resize. [Terminal panes are opaque canvas wells](2026-08-19-terminal-pane-opaque-tui-stage.md) owns the PTY well fill.
