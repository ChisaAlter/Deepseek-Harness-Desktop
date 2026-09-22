# Agent Note: New-origin clients open the latest conversation

Status: implemented

English | [中文](2026-08-14-restore-latest-conversation-on-new-origin.zh.md)

## Problem

Current session id lives in origin-scoped `localStorage` (`dsh.sessions.current`). A phone through the desktop gateway is a new origin, so restore fails. `startInitialSelection` then connected the recent Workspace's blank session. The composer looked empty even though the Host still had the desktop conversations, which sat in the phone overlay drawer. A later visit that still holds that blank id as current stays on the empty composer.

## Decision

`WorkspaceRuntime.startInitialSelection` still prefers a restored current session when that row is live (present, non-blank, non-archived). A restored blank, missing, or archived id does not win. Otherwise it opens the most recently updated non-blank, non-archived session from the list baseline. Only when none exists does it connect the recent Workspace blank session. New Session (`connectWorkspace` / `startSession`) is unchanged.

## Alternatives considered

**Keep minting a blank session on every new origin.** Rejected: phone remote is the same Host; users expect the conversation they already have, not an empty composer.

**Share `dsh.sessions.current` through the pairing cookie.** Rejected: selection is a browser-local viewing fact. The cookie is the per-phone access token; see [paired-remote-devices](2026-08-14-paired-remote-devices.md).

## Consequences

A first visit from any new origin — phone, another browser, a cleared origin — lands on the latest live conversation. A later visit that still holds a blank current from an earlier mint is treated the same way. Tests cover that a newer blank or archived row does not win, and that a restored blank current is replaced.
