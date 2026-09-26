# Decision: self-healing injected window controls and geometry-based maximize for the transparent frameless window

Status: implemented

[中文](2026-09-25-window-chrome-self-heal.md) | English

## Problem

User report: after editing plugins and restarting several times, the main window's rounded corners disappeared, the top-right minimize/maximize/close buttons went missing, and a dark line appeared at the far-right viewport edge. The main window is `frame:false + transparent:true`; the rounded silhouette and window controls are all painted by `harness-chrome-inject.js` inside the Harness BrowserView page. All three symptoms share one source — the inject script never ran or its nodes were wiped afterwards.

Investigation confirmed two independent defects:

1. **The injection lifecycle does not heal.** `syncHarnessChrome` ran `executeJavaScript` once at each of `did-finish-load` / `dom-ready` / `did-navigate-in-page` plus once at reveal, with no retry. An eval racing a navigation frame swap rejects and is swallowed silently; a later page DOM rebuild that drops the injected nodes has no fallback either — the window stays chromeless until the next navigation happens to land.
2. **The transparent window's maximize state is fake** (verified on Electron 43.4.0): `maximize()` resizes the window to the work area and emits `maximize`, but `isMaximized()` stays `false`, `unmaximize()`/`restore()` are no-ops, and `getNormalBounds()` returns the maximized rect. The maximize button could therefore never restore, and `data-window-maximized` never applied (corners stayed rounded at full screen).

## Decision

The injection side is now three layers: main-process retry + event coverage + page-side self-heal.

- `syncHarnessChrome` retries transient eval rejections on `CHROME_INJECT_RETRY_MS` (250/700/1500 ms), re-checking the `isHarnessUrl` gate every round; only a final failure falls back to a white base paint.
- `window.js` adds a `did-navigate` binding and re-asserts the injection on `focus`/`show`, throttled at 800 ms (inside the `_dshHarnessResizeBound` once-guard, so listeners do not accumulate).
- The inject script installs a `MutationObserver` (childList+subtree) inside the `__dshShellChromeBound` once-block: if any of the three injected nodes (style/controls/frame-canvas) disappears, the existing `schedule()` debounce rebuilds them. It queries only its own injected ids and never touches app layout — the "chrome owns only the window-control plate" contract still holds.

Maximize state is now geometry-based: `isEffectivelyMaximized(win)` = native `isMaximized()` OR "the window rect covers its display's work area". `attachIntegratedChrome` syncs the effective state on `resize`/`moved`: push `shell:window-state` on transitions, and while not maximized refresh `_dshNormalBounds` to the current rect. The `shell:window` maximize branch: native-maximized windows take `unmaximize()`; fake-maximized ones (geometry says maximized but `isMaximized()` is false) restore via `setBounds(restorableNormalBounds(win))` — when `_dshNormalBounds` is missing or itself covers the work area (a small display where the normal size already fills it), the restore target falls back to a centered default 1440×920 rect so restore can never be a no-op; otherwise the current rect is saved before `maximize()`. The `shell:window-state` query returns the same geometry verdict. On first run the inject script also seeds the flag via `getWindowState()` in addition to subscribing `onWindowState` — state pushes only happen on geometry transitions, so a fresh document injected while the window is already maximized would otherwise open with the rounded silhouette until the next geometry event.

## Alternatives considered

- **Renderer-side self-heal only (MutationObserver alone)** — rejected: when the eval rejects on a frame swap the script never ran, so no observer exists on the page; the main-process retry is the prerequisite, and the observer only covers the "injected then wiped" segment.
- **Poll `getComputedStyle` / re-assert on `setInterval`** — rejected: equivalent coverage but more main-process round-trips and coarser granularity; the observer fires only on structural changes and reuses the existing 80 ms debounce.
- **Drop `transparent:true` to regain native maximize semantics** — rejected: the transparent layered window is what carries the rounded-silhouette design (the current feature-card contract); abandoning the whole visual scheme for a workaround-able state quirk does not hold up.
- **Read `getNormalBounds()` when restoring** — rejected: on transparent windows that API returns the maximized rect and is measurably untrustworthy; the last normal rect must be tracked ourselves.
- **Cover the right-edge black line with an overlay** — rejected: the line is a symptom of absent injection (viewport scrollbar groove / transparent backing); the cure is making injection reliable, not pasting a second implementation over it.

## Consequences

Across plugin/page restart cycles, an injection interrupted by a frame swap or a page rebuild now recovers through any of four paths — bounded retries, navigation events, window re-focus, or observer self-heal — so the rounded silhouette and window controls no longer stay absent, and the dark edge line disappears together with the stable `html{overflow:hidden}`. The maximize button genuinely round-trips on the transparent window: clicking it sets `data-window-maximized`, squares the corners, and flips the icon to restore; clicking again snaps back to the tracked normal rect. Costs: `_dshNormalBounds` is a private main-process convention rather than an Electron API; the observer adds three `getElementById` calls per DOM mutation, negligible. Verified: all 26+13 unit tests in `chrome-theme` / `window-harness-cover` / `harness-chrome-inject` pass (including new cases for retry, abort-after-origin-leave, geometry maximize, and observer self-heal); live Electron + CDP verification — force-removing the three injected nodes regrew them, maximize→restore round-tripped 1440×920 ↔ 1646×960 with state/icon/radius in sync, and six `retryFullPlugins` restart rounds stayed green on every chrome assertion.
