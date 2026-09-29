# Decision: Direct desktop workspace entry

Status: implemented

[中文](2026-09-29-direct-desktop-entry.md) | English

## Problem

The user wants to skip upstream DeepSeek first-run welcome and enter the desktop directly. The credential gate retained by [desktop bridges](../architecture/2026-09-26-upstream-desktop-bridges.en.md) and [welcome resource repair](../bug-fix/2026-09-29-welcome-resource-closure.en.md) no longer matches the requested flow. Sign-out and expiration also reopened welcome.

## Decision

Remove main-process welcome creation, deferred workspace entry and sign-out/expiration redirection. Keep launcher and boot recovery unchanged; reveal the workspace when Harness is ready. Initialize account watching and locale reading in the background without inspecting credentials to authorize entry. Retain Settings sign-in, external browser authorization and Platform identity refresh. Do not write fake keys, pretend the user is signed in or modify user settings.

Smoke no longer clicks API Key/set up later automatically; any upstream welcome window fails the check immediately. Retained welcome resources and standalone rendering tests are not startup-entry acceptance evidence.

The first-use purpose/process wizard is also disabled: the trusted main-frame preload exposes `dshDesktop.onboarding: false`, so the account plugin creates neither its controller nor its overlay. Missing capability preserves upstream behavior for other shells. Existing preferences and onboarding progress remain untouched; General Settings and account entry stay available. Smoke removes automatic Continue/Configure later clicks and fails if the root remains inert or a blocking dialog persists.

## Alternatives considered

Automatically calling welcome skip still creates a potentially flashing window and lets tests conceal entry regressions; rejected.

Persisting first-use setup as completed changes user data and can trigger controller writes of default preferences. A pre-render capability opt-out avoids creating onboarding instead.

Removing all account integration would remove welcome but break Settings sign-in, browser authorization and Platform pages; rejected.

## Consequences

Users can enter without credentials but must configure a model in Settings before using it. Focused tests cover entry, sign-out/expiration and background account initialization; isolated source smoke covers credential-free startup. Installer builds remain paused, and installed old packages do not update automatically.
