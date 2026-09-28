# Decision: Launcher closeout fixes for data preservation, recovery cancellation, and control reachability

Status: implemented

[中文](2026-09-28-launcher-audit-closeout-fixes.md) | English

## Problem

The external 2026-09-28 `audit-closeout/REPORT.md` confirmed A1–A6 and U1–U2: failed MCP/settings/credential reads became empty data, publication could partially overwrite files or follow links, stale plugin recovery could restart after stop or during import, Electron error logs were filtered and single lines exceeded the cache budget, failed overwrite validation removed the previous plugin, zoom collapsed the import list, and recovery typography missed its role. U3 is a long-confirmation stress risk.

Prior-decision audit: [import transaction remediation](2026-09-28-import-transaction-and-launcher-remediation.en.md) partially overlaps; its directory transactions and maintenance slot remain. [Desktop bridges](../architecture/2026-09-26-upstream-desktop-bridges.en.md) retains its diagnostic architecture; this change corrects the event contract and capacity boundary. Neither decision is superseded; other marketplace and recovery product paths keep their current contracts.

## Decision

1. MCP, settings, and credential destination reads treat only ENOENT as empty; other errors stop the corresponding write. Publication uses a random exclusively created sibling temporary file followed by atomic replacement after a complete write, rejecting file and ancestor links. Failed publication preserves original bytes and cleans its own temporary file.
2. Plugin recovery belongs to a startup generation. Stop, cancellation, and shutdown invalidate old recovery; asynchronous recovery checks ownership at side-effect boundaries and shares maintenance admission with import.
3. The console tail accepts Electron's actual string `error` level while retaining numeric compatibility. Oversized lines retain their suffix at complete UTF-8 boundaries, keeping the total byte budget bounded. Regression coverage includes class behavior and the real Electron event-to-report-file chain.
4. Plugin installation snapshots the pre-overwrite state. CLI or validation failure restores the previous installation instead of uninstalling the overwritten package. Failed restoration is reported explicitly and retains the recovery backup.
5. Update both design-language documents first: recovery titles use 16/24; the import body keeps at least 120px with outer vertical scrolling when space is tight; confirmation cards are viewport-bounded with independently scrolling text and non-shrinking headings and actions.
6. Real Electron regressions cover light/dark themes, default/minimum windows, 100%–200% browser zoom, expanded instructions, individual checkbox and import-button hit testing, and 600-character and oversized confirmation bodies. Tests use isolated windows and read-only IPC fixtures, never real user imports, plugins, or installers.

## Alternatives considered

- Replace direct writes with rename alone: prevents partial publication but not read-error erasure or fixed temporary links; rejected.
- Check maintenance admission only at explicit launcher buttons: simple, but stale recovery still bypasses the same boundary; rejected.
- Reinstall the old plugin online after failed validation: smaller backups, but offline failures, version drift, and changed dependencies undermine the previous working state; use local snapshots.
- Increase minimum window size or shrink typography: masks current geometry but misses zoom and expanded instructions; use scrollable content constraints.

## Consequences

Read and path-validation failures explicitly refuse import while preserving existing data. Install snapshots add disk and copy costs in exchange for offline restoration. Oversized logs are truncated without broken UTF-8. Small viewports may have nested scrolling so choices and actions remain reachable.

Verification is not release acceptance: fault injection and CLI substitutes do not prove real pnpm installation or power-loss behavior. Layout assertions use Chromium geometry and hit testing; screenshots do not establish human aesthetic or complete keyboard acceptance.

Validation: `npm test` ran 2758 tests, with 2756 passed, 0 failed, and 2 skipped; governance passed 6/6 and documentation sync 8/8. The original external A2 regressions passed 4/4 without modifying original audit evidence. Source `npm start` passed prestart and launched the main process and launcher renderer.
