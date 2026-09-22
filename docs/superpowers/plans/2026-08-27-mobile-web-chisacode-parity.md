# Mobile/Web ChisaCode parity plan

Date: 2026-08-27

Feature: `mobile-remote`

Base: `cursor/android-chisacode-parity-ed5c`

## Goal

Make the shipped mobile Web SPA and Android WebView asset copy a complete ChisaCode v2 client for
session creation, existing-session control, workspace Git reads/actions, and file listing. Retain
honest disabled states for desktop-only operations. Remove stale HTTP v1 documentation without
restoring `RemoteGateway`, cookie login, Bearer Host APIs, or `chisacode.sh` production relay URLs.

## Baseline and audit

- Baseline `node --test "mobile/web/**/*.test.js"`: 67 pass, 0 fail.
- ChisaCode session paths already use `fetchAgents`, `fetchAgentTimeline`, `sendAgentMessage`,
  `cancelAgent`, and `respondToPermission`.
- `createSession()` is the P0 gap: it deliberately throws instead of calling `createAgent`.
- Legacy Host RPC is still reached by ChisaCode Git (`gitStatus`, branch/actions), file
  (`listDir`), and desktop-window request (`openSettings`, `openGallery`) paths.
- The bundled `DaemonClient` already includes `createAgent`, checkout status/action/branch/PR RPCs,
  `getBranchSuggestions`, and `listDirectory`; no desktop-side proxy or protocol fork is needed.
- There is no equivalent RPC for creating a plain branch or controlling the desktop UI. Those
  controls must be disabled with direct “请在电脑端操作” guidance rather than throwing.

## Delivery phases

1. Add testable ChisaCode parity adapters:
   - derive `provider` and `cwd` from the first valid agent;
   - when the agent directory is empty, derive `cwd` from the most recently active workspace and
     choose an enabled `ready` provider from the daemon provider snapshot;
   - create an agent with the derived inputs;
   - translate checkout status, PR status, branch suggestions, Git actions, and directory entries
     into the existing mobile view model.
2. Wire the SPA:
   - make “新会话” create and open an authoritative daemon agent;
   - use native ChisaCode Git and file RPCs;
   - surface agent-directory, create, Git, file, and host-control failures in visible banners/toasts;
   - disable unsupported plain branch creation and desktop-window opening controls.
3. Regenerate the browser client bundle and run all mobile Web tests plus focused remote/session/scan
   gates.
4. Run Android JVM tests and APK assembly when the cloud image has a usable Android SDK.
5. Exercise the real bundled SPA in a browser/static server. Pairing, sticky reconnect, and live
   agent execution require Trent’s running desktop and relay and must be marked blocked when absent.
6. Rewrite the pairing flow, mobile README, mobile handbook module, feature card, and dated QA
   result for the ChisaCode v2/WebView model.
7. Perform a final diff review against the feature card and kill list, including searches for
   product-path HTTP login, Host shell calls under ChisaCode, production ChisaCode relay references,
   token violations, and silent catches.

## Acceptance criteria

- “新会话” calls `DaemonClient.createAgent({ provider, cwd })`, inserts the returned agent, opens
  it, and reports discovery or daemon errors visibly.
- ChisaCode workspace status, pull, commit, push, PR creation, branch switching, and root file
  listing use daemon RPCs, never `__remote__` Host RPC.
- Unsupported branch creation and desktop-window controls are visibly disabled and explain that
  they require the computer.
- Existing offer-v2 pairing, E2EE relay role, sticky `deviceSecret`, timeline, send, cancel, and
  permission behavior remains covered and green.
- `node --test "mobile/web/**/*.test.js"` and the focused `chisacode-remote`, `session`, and `scan`
  tests pass.
- Android tests/build and browser/manual results are recorded as PASS, FAIL, or BLOCKED with the
  environment limitation stated exactly; no real-device claim is inferred from browser tests.
- Documentation contains no product instructions for cookie/JSON login, Bearer `/api/*`, or
  `/__remote__/shell/*`, and does not point users at a `chisacode.sh` production relay.

## Adversarial review

- Empty-agent daemons are not treated as impossible: workspace plus provider-snapshot fallback is
  required, while a truly empty daemon gets an actionable error rather than a guessed cwd/provider.
- ChisaCode checkout payloads do not match the old Electron Git JSON. A dedicated conversion is
  required; passing them directly to `parseVcsStatus` would silently render incorrect state.
- Successful transport calls may still return structured `error` fields. Adapters must reject those
  fields so the UI cannot display false success.
- A browser preview proves asset loading and disconnected/error UI only. It does not prove relay
  pairing, Android WebView persistence, device revocation, or real provider execution.
- Legacy HTTP helper files and their compatibility tests may remain in the tree, but no shipped v2
  startup or user path may invoke or document them as the product flow.
