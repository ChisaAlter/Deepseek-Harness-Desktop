# Decision: Launcher stop failure and mutually exclusive controls fix

Status: implemented

[中文](2026-09-27-launcher-stop-controls.md) | English

## Problem

The user reported two launcher defects: clicking "关闭桌面端" left the desktop running, and the running state showed both "打开桌面端窗口" and "关闭桌面端" instead of mutually exclusive controls. Live diagnosis found three independent bugs stacked on the stop path — any one of them was enough to break or distort stopping:

1. **Control URL swallowed by the token query**: the `dsh web` ready line prints the authenticated URL (`http://127.0.0.1:3080/?token=…`), which `dsh.js` stores verbatim in `baseUrl` (the BrowserView load and session cookie also consume it). `task-protection.js`'s `controlOp` concatenated the path, producing `GET /?token=…/dshd-task-control/inspect` — path still `/`, hitting the SPA fallback for a 405. Inspect never succeeded, coverage read as unknown, acquire returned 405 as well, and commit never ran.
2. **Upgrade sockets held in pending for their lifetime made drain always time out**: `gateUpgradeHandler` held the admission from accept until socket close. The Web UI keeps two persistent `/api/remote.mux` WebSockets, so acquire's drain waited on promises that never settle and returned `dshd/drain-timeout` after 40 seconds. After the 405 fix, stop actually reached this stage — the real cause of death, presenting as "nothing happens after confirming".
3. **Schedule coverage falsely reported unavailable**: `collectSchedule` ignored `DSHD_SCHEDULE_ENABLED` — the desktop leaves schedule off by default (stock overlay `disabled: true`), so the service is permanently absent and every stop prompted "部分后台服务状态未知". The README contract already said an unset flag should report `intentional-disabled` (`collectBots` complied; schedule missed the gate).

Meanwhile, the renderer's `syncDesktopControls` deliberately kept start visible (renamed "打开桌面端窗口" in the running state to ride single-instance focus), putting both controls on screen.

## Decision

1. Normalize `baseUrl()` in `task-protection.js`: pin the origin via `new URL(raw).origin` before appending the control prefix, keeping `dsh.baseUrl` verbatim for BrowserView/cookie use (same convention as `workspace-rpc.js`).
2. `gateUpgradeHandler` becomes connect-time admission: `done()` right after accept — an upgraded socket's lifetime is its transport's, not drainable work; new upgrades still 503 while locked (README behavior unchanged), and work delivered over the socket stays gated at the `resolveAgent`/`jobs.start` chokepoints. `collectSockets`'s inspect counting stays — established remote connections as activeWork ("2 条已建立的远程连接") is a deliberate prompt surface that does not join the drain set.
3. `collectSchedule` checks `DSHD_SCHEDULE_ENABLED` first: unset reports `intentional-disabled` and skips the service lookup; set-but-absent still reports `unavailable` (a load failure must never read as "deliberately off"), exactly mirroring `collectBots`.
4. `syncDesktopControls` mutual exclusion: running shows only "关闭桌面端", stopped shows only "启动桌面端"; re-showing a dismissed window while running moves to the tray `showMain`.
5. Diagnostic byproduct kept: `admit(state, label)` lets drain-timeout replies carry `pendingCount` + `pendingLabels` (e.g. `upgrade /api/remote.mux`), turning the hardest-to-locate step of this incident into a first-class observable signal; README and tests register it. All temporary file/console STOPDBG lines were removed.

## Alternatives considered

- **Force-close existing upgrade sockets during drain**: empties pending, but non-terminal ops like stop/restart would kill healthy client connections — a socket is transport, not a work unit; refusing new connections suffices.
- **Drop upgrade sockets from inspect's activeWork too**: fewer confirmation prompts, but remote clients are genuinely connected and a terminal op will cut them — keep the prompt and fix the drain semantics, so prompting and draining each stay honest.
- **Strip the query when `dsh.js` stores baseUrl**: "cleaner", but the cookie probe and BrowserView first load both consume the token — stripping would break the login chain; normalizing on the control consumer (`controlOp`) is the smallest blast radius.
- **Fully revert pendingLabels**: smallest diff, but drain-timeout was an unobservable black box this whole incident; with labels the stuck admission kind reads directly off the acquire response.

## Consequences

- The stop chain works end to end: verified live — inspect → confirm → acquire (drain completes instantly) → commit → `proceeded=true`, the `dsh web` child exits, and the launcher falls back to only "启动桌面端".
- Default config (schedule/bots off) no longer falsely reports unavailable coverage; a stop still prompted once while remote connections existed. Same-day follow-up: launcher-initiated stops now run `preConfirmed` with no dialog (the user ruled an explicit click is consent, see [launcher-stop-preconfirmed](../product/2026-09-27-launcher-stop-preconfirmed.en.md)).
- Lock semantics narrowed: pending holds only admissions that finish (HTTP requests, resolveAgent, jobs.start, fallback writes, connection waterfall); transport-lifetime objects never enter the drain set.
- `acquire` drain-timeout replies gain a `pendingLabels` field; existing consumers read only `code` and are unaffected.
- Regression surface: `src/main/task-control-plugin.test.js` + `task-protection.test.js` = 23 cases (new: token-URL control posting, sockets not blocking drain + locked 503, schedule flag tri-state, pendingLabels assertion); full `npm test` 2537 green.
- Related record: [Task-protection coordinator and Host admission lock](../architecture/2026-09-25-task-protection-coordinator.en.md).
