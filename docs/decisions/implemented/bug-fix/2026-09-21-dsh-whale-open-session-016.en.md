# Decision: dsh-whale session-open migrates to uiWorkspace.openSession (0.1.6 client contract)

Status: implemented

[中文](2026-09-21-dsh-whale-open-session-016.md) | English

## Problem

`vendor/dsh-whale`'s client plugin was written against the 0.1.5 API: all three "open her session" paths (the sidebar panel redirect, the footer fallback entry, and the pet `__dshWhaleOpen` jump bridge) called `sessions.open()`. Runtime 0.1.6 moved view selection out of the Session Controller — the `sessions` service now carries catalog/retention only and no `open()` — so the panel fails with `sessions service unavailable` while the footer and pet bridge silently no-op. A field repair package already proved the fix on an installed copy; without carrying it in the vendored source, every release/upgrade ships the broken code again.

## Decision

All three entries route through one `openSession(sessionId)` resolved in `apply`: prefer `ctx.uiWorkspace.openSession(id)` (0.1.6+, which also clears the selected panel), fall back to `sessions.open(id)` (≤0.1.5), and throw `sessions service unavailable` only when neither exists. The dependency is declared in both layers: `exports.inject` gains `"uiWorkspace"` and `package.json`'s `dsh.client.inject` gains `@deepseek-ai/dsh-client-ui-workspace` so the service is guaranteed present in the client plugin graph. A new `src/main/dsh-whale-client.test.js` pins the contract at the module boundary: each entry runs under both 0.1.6 and 0.1.5 host shapes, plus the no-service error surface and the inject declarations.

## Alternatives considered

- **Keep `uiWorkspace.openSession` only, drop the fallback** — rejected: the plugin enters `profiles/web/node_modules` through a junction, so a runtime downgrade or an older copied profile can land it on a 0.1.5 host; the fallback is a few lines and keeps the error contract unchanged.
- **Patch only installed copies (keep the field repair path)** — rejected: `vendor/dsh-whale` is the shipped implementation source and `extraResources` overwrites the install directory on every upgrade, so this never holds.
- **Add `sessions.open` back to the runtime** — rejected: moving view selection out of the Session Controller is a deliberate upstream split; restoring it would fork the upstream API surface.

## Consequences

The whale panel, footer entry, and the pet "ask her" jump work again on 0.1.6 hosts; 0.1.5 hosts behave exactly as before. The `sessions` inject stays (the fallback still uses it) but is no longer the only channel. The pet bubble "this turn didn't run" is a separate matter — when her persistent session has an unanswered `ask_user_question`, bubble messages queue and time out; answering or stopping that turn drains the queue and is out of scope here.
