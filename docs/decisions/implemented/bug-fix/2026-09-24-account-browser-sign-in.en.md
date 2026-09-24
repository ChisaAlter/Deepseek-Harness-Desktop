# Decision: Open the browser for Desktop account sign-in

Status: implemented

[中文](2026-09-24-account-browser-sign-in.md) | English

## Problem

DSHD uses the Harness account plugin but does not use the account-state listener in the native Harness Desktop main process. The Host supplies an authorization link after creating an attempt, and the dialog waits for browser sign-in, but nothing opens that link automatically. Users must copy it manually.

## Decision

When DSHD provides `window.shell.openExternal`, the account plugin opens the system browser on the first `waiting-browser` state with an authorization link. It appends the effective Desktop light or dark theme, matching the dialog's copied link. The attempt id prevents repeated opens from duplicate state notifications. An open failure leaves the Host attempt active and the existing copy-link fallback available. Native Harness Desktop retains its own main-process browser opener.

## Alternatives considered

- **Keep only the copy-link action**: this does not satisfy the click-to-open sign-in path.
- **Open the browser in the click handler**: `startSignIn` first returns `initializing`; the state stream supplies the authorization URL later.
- **Add another Host subscription in the DSHD main process**: this duplicates connection and lifecycle handling already owned by the account plugin's stream and Desktop external-link bridge.

## Consequences

DSHD opens the authorization page once per login attempt. Browser launch errors do not change login state, and users can still copy the link. Focused tests cover the initial open, duplicate state, a new attempt, and browser-open failure.
