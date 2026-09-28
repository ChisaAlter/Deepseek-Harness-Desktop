# Decision: Native-first shortcut interception (upstream semantics)

Status: implemented
Supersedes: [2026-09-25-local-first-shortcut-bridge](../../archived/architecture/2026-09-25-local-first-shortcut-bridge.en.md)

[中文](2026-09-26-native-first-shortcut-interception.md) | English

> Supersedes [2026-09-25-local-first-shortcut-bridge](../../archived/architecture/2026-09-25-local-first-shortcut-bridge.en.md)

## Problem

The `local-first` policy protected terminal/editor keys at the cost of deciding accepted bindings only after the top-frame renderer received `keydown`: preemptive bindings (`workspace.associate`, debug keys, user-rebound Ctrl+W) raced local semantics at the physical layer, and accepted bindings inside iframe/webview guests never reached the top frame at all. The upstream adoption plan requires shortcut behavior matching the official desktop (`native-priority`). The user chose upstream-first interception; this record supersedes the 09-25 local-first decision.

## Decision

`src/main/shortcuts.js` `attach()` now runs the upstream `keyboard.ts` interception algorithm; `before-input-event` adjudicates before DOM dispatch:

1. **Acceptance set adjudicates before render**: `before-input-event` consumes only physical keys matching a currently accepted binding and calls `preventDefault()`; unbound keys pass through to DOM/editors/terminals untouched. Editing keys (`Control+C`/`Control+V`/`Control+W`) still resolve locally while unbound — once a user binds Ctrl+C to a command, upstream semantics treat it as authorized preemption, identical to official.

2. **Held-chord tracking**: main keeps a pressMap (code→held) plus sequence; modifier state rebuilds from held codes, not the DOM; repeats carry `repeat:true`; one physical input one executor — accepted chords also suppress same-named menu accelerators (`contents.setIgnoreMenuShortcuts`).

3. **Guest takeover**: while an iframe/webview guest holds focus, bound keys dispatch as `{kind:'iframe'|'webview'}` payloads straight to the registry; unbound guest keys stay in the guest (no async key loss). `sendEditingKey` remains the bypass for unaccepted editing keys.

4. **Security invariants retained**: overlay blocking still `event.preventDefault()` + `setIgnoreMenuShortcuts(true)` (upstream lacks preventDefault; we keep the stronger semantics); recording suppression, closeWindow revision re-check, IPC sender+mainFrame+origin triple validation, atomic persistence, and the narrowed preload surface are unchanged. `data-shortcut-policy` flips to `native-first`; the local-first path is deleted.

## Alternatives considered

- **Keep local-first**: permanent divergence from official behavior and guest-bound keys can never be accepted (the plan requires the webview browser panel); rejected.
- **Hybrid policy (guest native, main-frame local)**: two adjudication paths cannot guarantee "one physical input one executor" under concurrent timing; rejected.
- **Hard-code terminal-protected keys as local exceptions**: freezes Ctrl+C/Ctrl+W outside the registry — user rebinding would silently fail; rejected in favor of registry adjudication.

## Consequences

- `keybindings.json` schema and migration unchanged; existing user rebinds keep working.
- Accepted bindings inside iframe/webview guests (the WP1 browser panel) now function.
- Known trade-off: if a user binds a terminal-common key globally, the native layer intercepts before xterm — official-consistent authorized semantics, recorded here so it is not "fixed" as a bug later.
