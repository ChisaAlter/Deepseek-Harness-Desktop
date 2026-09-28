# Decision: Launcher "stop desktop" is pre-confirmed — no dialog at all

Status: implemented

[中文](2026-09-27-launcher-stop-preconfirmed.md) | English

## Problem

Clicking 停止桌面端 in the slim launcher makes the desktop run `coordinate('stop')` via the peer `stop-desktop` op; a dirty inspection (live remote connections) required confirmation — but every desktop window was hidden (app parked in the tray), so `confirmTaskStop` lost its anchor and fell back to a native `dialog.showMessageBox`: a detached native box belonging to no product window, doubly intrusive. The user ruled that clicking "stop" in the launcher is itself an explicit instruction — no second confirmation should exist — and the same "explicit action re-confirmed" prompt class has been rejected repeatedly.

## Decision

`coordinate()` gains a `preConfirmed: true` option: the inspect → acquire → drain → recheck → commit sequencing still runs, while both user-confirm gates (dirty first inspection, fresh-work recheck inside the lock) are skipped. Both launcher-initiated stop chains — the peer `onPeerStop` (slim launcher) and `launcher-service` `stopOp` (the desktop's own launcher window) — pass `preConfirmed`. `confirmTaskStop`'s anchor is also fixed to the first *visible* window (it previously picked the main window, falling back to native when that was hidden even though the launcher was on screen). Confirm semantics are unchanged for window-close/tray/menu quit and install/update paths.

## Alternatives considered

- **Route the confirm back into the launcher's in-window `app-confirm`** (peer round-trip carrying the inspection, then a `confirmed` re-call) — rejected: still a second confirmation for a button the user just clicked; adding a two-leg protocol hop only buys one more interruption, and the user explicitly chose zero confirms.
- **Confirm only when a window is visible, skip otherwise** — rejected: the same button behaving differently by window state is unpredictable.
- **Skip inspect/acquire too** — rejected: the lock and drain are Host admission semantics, not interruptions; `preConfirmed` removes only the confirm gates.

## Consequences

Clicking 停止桌面端 commits coordination immediately — zero dialogs, forever; the "active work will be interrupted" notice disappears on this path (explicitly accepted by the user). `preConfirmed` is a coordinator opt-in reusable for other "explicit action re-confirmed" cases; it must not spread to window-close/tray/menu quit or install/update paths — confirmation there remains the designed behavior. **(2026-09-27 revision: a full audit later classified the install/update lanes as the same double-confirm defect, so `preConfirmed` was extended there too — see [update-install-preconfirmed](2026-09-27-update-install-preconfirmed.en.md); the quit/restart/reload constraint stands.)**
