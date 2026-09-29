# Decision: Upstream desktop capability bridges (update modal / webview browser / welcome / platform embed)

Status: implemented

[中文](2026-09-26-upstream-desktop-bridges.md) | English

## Problem

Upstream `apps/desktop` binds several desktop capabilities to its Desktop Host (`profiles/desktop` plus a private process channel): the shell-modal confirmation layer, webview browser guests, the Welcome sign-in window, and embedded Platform documents (usage/top-up). Whale Isle runs `profiles/web` + overlays; mounting the upstream desktop app wholesale would replace the entire shell. The required shape: adopt the capabilities, keep our shell, narrow the bridges.

## Decision

Each capability gets a minimal main-process port plus a narrowed preload surface, consumed by official client code unchanged:

1. **Shell-modal confirmation layer** (ported `update-dialog.js`/`update-overlay.js`/`update-attention.js`/`update-presentation.js`): the transparent child-window modal keeps upstream geometry/focus contracts, restyled to our dark design language; `dshDesktop.updates = {status, open, subscribe}` feeds our own GitHub Releases state machine — upstream `ui-updates` and update-attention consume it directly while the update backend stays ours (launcher/delta).

2. **Webview browser guests** (`src/main/browser-guests.js` + `dshDesktop.browser`): workspace-scoped leases over process-lifetime partitions; the main process validates lease ownership in `will-attach-webview` before allowing the attach and rewriting the full webPreferences; Host-origin navigation denied, external https allowed, nested webviews/downloads/credential prompts denied. The presence of `dshDesktop.browser` makes upstream `ui-sidebar-browser` select `createElectronPage` automatically — the right-sidebar chrome/layout stays ours while entries open the official implementation.

3. **Welcome sign-in window** (`welcome-backend.js`/`account-backend.js`/`welcome-window.js` + `dshWelcome` preload + vendored renderer assets): authenticated Web RPC (session cookie) reads account state; sign-in/cancel/copy-authorize-link/API-key save/set-up-later all stay in the main process. The gate hooks the `showHarness` dependency injection — with no account login and no provider key, the welcome window owns the entry and the workspace load defers until `enterWorkspace`; an existing API key passes straight through. Sign-out/session expiry reopens welcome.

4. **Embedded Platform documents** (`platform-view.js` + `dshPlatform` + the `vendor/dsh-platform-session` Host plugin): upstream desktop-host pushes PlatformSession over process IPC — `dsh web` has no such channel, so the session travels over the same Bearer-gated loopback pattern as task control (`GET /dshd-platform/session`, per-boot token via env). The overlay also rewrites the `deepseek-account` row's `desktopPlatform` from web's `null` to `'win32'`. WebContentsView partitions per userId with credential header injection and origin-locked navigation.

5. **Small ports**: `update-journal` (launch diagnostics banner on the next run after a crash/failure), `crash-report` (render-process-gone → `logs/crash/*.json`), console tail (harness-view console mirroring into the app log, view-only object serialization suppressed to keep GPU frame noise out), media-permissions (getUserMedia → notAllowed → camera+microphone only), tray-hide notice (one-time toast on first hide, marker in userData; since 2026-09-27 see [tray-close-once-toast](../product/2026-09-27-tray-close-once-toast.en.md)).

6. **`__DSH_HOST_PATHS__`**: the `webUtils.getPathForFile` bridge gives dragged files real paths, activating `ui-file-reference-local` `@path` references (no byte upload, always current).

The Platform session route resolves the current Cordis `deepseekAccount` on every request instead of capturing the service at route installation. The account service can become ready after WebServer, be replaced, or be removed; retaining its initial reference makes usage queries fail persistently with `Platform account unavailable` even after sign-in. Regression coverage exercises late startup, replacement, and removal while preserving Bearer authorization and credential boundaries.

## Alternatives considered

- **Mount upstream apps/desktop wholesale**: replaces our Electron shell/launcher/profile — conflicts with standing architecture decisions; rejected.
- **Replicate the desktop-host `process.send` channel**: `dsh web` has no IPC pipe; hard-wiring forks the upstream launch path — the Bearer loopback route reuses the already-proven task-control pattern.
- **Plain BrowserWindow for platform documents**: loses partition-scoped credential injection and origin-locked navigation; WebContentsView child views track host-window bounds — official approach adopted.
- **Keep native `dialog.showMessageBox`**: upstream clients (update banner/page) expect the `dshDesktop.updates` semantic layer; the shell modal gives confirmation/progress/recovery one skin — adopted.

## Consequences

- Official client desktop branches (webview/page/desktop-only surfaces) activate on the web profile without `profiles/desktop`.
- New Host plugin `vendor/dsh-platform-session` + overlay `desktop-platform-session.patch.yml` (mounted on every start, full and skip; failures are log-only and never block boot).
- Credentials/tokens stay inside the main process and the loopback boundary; every preload surface is read-only or narrow-command.
