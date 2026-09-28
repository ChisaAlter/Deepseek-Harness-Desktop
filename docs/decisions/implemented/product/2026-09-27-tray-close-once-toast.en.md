# Decision: First hide-to-tray becomes a one-time toast; no dialogs on close

Status: implemented

[中文](2026-09-27-tray-close-once-toast.md) | English

## Problem

`closeToTray` was already settings-controlled (desktop Settings → General → close behavior; the launcher's "minimize to tray" toggle), but the `TrayHideNotice` ported from upstream used a native `dialog.showMessageBox` for first-close education — ugly and it blocked the close. A shell-modal two-button replacement (minimize to tray / quit, persisted on pick) made it worse: choosing "quit" chains straight into the task-protection confirm, so **one close produced two prompts**. The close path should never carry a button-driven prompt — the setting already expresses the preference; the hint only needs to say where the window went.

## Decision

`TrayHideNotice` collapses into a "one-time toast on first hide":

- the close hides immediately — no interaction is awaited;
- only the first hide fires a system `Notification` (where the window went + the Settings → General → close behavior entry), then writes the `userData/tray-hide-acknowledged` marker and never appears again;
- a toast failure blocks neither the hide nor the marker;
- the quit branch keeps task-protection coordination — it only confirms when real running/scheduled work exists, decoupled from the close behavior.

Same shape as the slim launcher's `trayHintShown` notification — the established "one-time passive hint" pattern, not a new interaction surface.

## Alternatives considered

- **Shell-modal two-button dialog (pick = change setting)** — rejected: shipped and reverted — after "quit" every close chained into the task-protection confirm, doubling the prompts; turning a one-time hint into a settings questionnaire was over-designed.
- **Shell-modal one-button teaching dialog (reskinned "got it")** — rejected: still forces an extra click before hiding; a toast carries the same information.
- **Fully silent first hide** — rejected: unaware users assume the app exited; a zero-interaction one-time toast is the lighter disclosure.

## Consequences

`TrayHideNotice` no longer holds `show`/`focus`/pending state — just marker + notify. No button-driven prompt exists on the close path; the native messagebox is fully retired from it. Task-protection confirmation frequency is governed by real work, not by how the window closes. Existing users' markers stay valid. On systems without notification support the hide is silent (equivalent to a returning user).
