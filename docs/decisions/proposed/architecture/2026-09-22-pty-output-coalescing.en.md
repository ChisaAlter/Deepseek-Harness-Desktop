# Decision: Coalesce PTY output by burst before it crosses IPC

Status: proposed

[中文](2026-09-22-pty-output-coalescing.md) | English

## Problem

`src/main/pty.js` publishes `shell:pty-data` from its `onData` callback for every single backend
chunk, and `registerPtyIpc` sends one message per publish to the owning webContents. On the renderer
side, `ui-user-terminal/src/client/pty-bridge.ts` fans every event out to all live stores, and
`stores.ts`'s `appendData` runs `session.buffer + data` and truncates at 256 KiB (a JavaScript
string length, not a byte count).

A build log, a `cat` of a large file, or `npm test` output produces thousands of small chunks. IPC
message count, store publications, and string copies all grow linearly with the chunk count; once
the replay buffer is full, every `appendData` also copies a nearly buffer-sized string. The
user-visible symptom is renderer main-thread jitter and laggy input echo during high-throughput
output.

Nothing here is a rendering bug or data loss. The entire cost is in the **number of deliveries**:
the same bytes, delivered in fewer messages.

## Proposal

Coalesce output per PTY inside `createPtyController` instead of de-duplicating in the renderer:

- The first chunk after an idle gap is published **immediately**, so interactive echo never pays the
  coalescing window.
- Later chunks in the same burst are appended to a per-PTY queue and flushed as one
  `shell:pty-data` message at `8 ms` or `32 KiB` (UTF-8 bytes), whichever comes first.
- Capacity is checked **before** appending: when pending already holds `n` bytes and the new chunk
  holds `m`, `n + m > limit` flushes the pending bytes first and then queues the new chunk. The limit
  is therefore a real payload bound, not a "flush trigger" evaluated after the append — the latter
  lets two in-limit chunks coalesce into one oversized payload. A single backend chunk that already
  exceeds the limit is forwarded as-is; it cannot be split further.
- `onExit`, `kill`, and `killAll` flush before continuing, so `shell:pty-exit` always follows all
  buffered output.
- Timers and queues are cleared with the owner generation, and a late callback arriving after `kill`
  must not recreate batching state; this deliberately does **not** use the `unref()` pattern that was
  rejected in `pty.js`, which would silently strand the final chunk.

The first iteration only **coalesces**. Whether `node-pty`'s `pause`/`resume` actually constrains
ConPTY/backend production is unverified, so this decision claims no backpressure and drops no data.
The renderer replay buffer remains the completeness backstop; this change only reduces message
count.

## Alternatives considered

- **Raise the renderer replay buffer or move it to a ring buffer** — deferred: buffer size does not
  reduce IPC message count or string copies; it only matters if copies or GC still dominate after
  coalescing. Fix delivery count first.

- **Coalesce events in `pty-bridge.ts` on the renderer side** — rejected: the IPC and
  `webContents.send` cost is already paid; renderer-side coalescing only reduces store updates and
  saves none of the main-process-to-renderer half.

- **Coalesce purely by byte threshold with no timer** — rejected: a threshold alone leaves
  interactive small output invisible in the queue until the next large write arrives. The time
  window is required for interactivity.

- **Use an `unref()`ed timer so tests and exit are never held open** — rejected: `unref()` lets the
  process exit while the last chunk is still buffered, losing tail output. The lifetime instead
  flushes explicitly on exit, kill, and killAll.

- **Implement `pause`/`resume` backpressure in the same change** — deferred: `node-pty` uses ConPTY
  on Windows, and pause semantics are not proven to propagate to the producer. Calling batching
  "backpressure" without measurement would be a false completion.

- **Push first, then check whether the limit was reached** — rejected (implemented, then overturned):
  two ordinary chunks that are each below the limit can coalesce into one payload above it (for
  example 20 KiB + 20 KiB → a single 40 KiB message). The existing limit test used uniform 4 KiB
  chunks and hid that path. The bound must be computed before the append.

## Acceptance criteria

- 10,000 synthetic 1 KiB chunks: at most 2,000 data messages (at least 80% fewer than the chunk
  count), with the concatenated stream identical to the input.
- 100,000 synthetic 1 KiB chunks on the same implementation count 100,000 → 3,126 (-96.9%).
- A single output after an idle gap does not wait for the window (with `coalesceMs` set to 5 s it is
  still published immediately).
- No coalesced payload exceeds 32 KiB (UTF-8 bytes) unless a single backend chunk is larger. Negative
  cases cover `20 KiB + 20 KiB`, non-divisible sizes, multi-byte UTF-8 text, and one oversized chunk.
- All buffered output is published before `shell:pty-exit`; `kill` and `killAll` leave no timers or
  queues behind, and a late callback arriving after `kill` does not recreate batching state.
- Every existing case for ownership, sender generation, size normalization, and post-kill no-ops
  keeps passing.

## Risks

- ANSI/OSC/CSI sequences can straddle backend chunks; coalescing only concatenates strings and does
  not parse them, so sequences still reach the renderer in the original byte order. Flush ordering
  and loss are the real concerns, constrained by flushing before exit/kill and by not using
  `unref()`.
- The 8 ms window adds bounded queueing latency to high-throughput output: the window or 32 KiB,
  whichever comes first. Interactive (first-after-idle) output is exempt.
- Coalescing changes the event granularity the renderer observes; any future consumer that needs
  exactly one event per backend chunk (for example per-chunk protocol parsing) must buffer on its
  own rather than reverting the coalescing.
- Backpressure remains unsolved: during sustained high throughput the main process still enqueues
  and flushes continuously, only with fewer messages. That item stays incomplete.
