# Agent Note: Message-edit production polish — failure keeps the draft, mid-edit guards, focus return

Status: implemented

English | [中文](2026-08-25-message-edit-production-polish.zh.md)

> Partially superseded: the bubble textarea this note polishes was replaced by the composer edit session — see [2026-08-25-message-edit-composer-edit-session](2026-08-25-message-edit-composer-edit-session.md). Failure-keeps-draft, confirm-time latest-and-idle guards, IME-safe Escape, and the focus-return store all carried over; the textarea-specific chrome (height refit, `editor.field`, in-bubble Send) is gone.

## Problem

The [inline user-message editor](2026-08-15-inline-user-message-edit.md) shipped its transaction correctly but rough at the edges. A failed fork cancelled the editor and threw the operator's typed revision away. The idle-and-latest preconditions were checked only at the pencil: a session that started running mid-edit (a queued message admitting, another client submitting) or a newer user message arriving left Send armed, and confirming would fork a cut that silently drops the newer turns. An IME Escape — which only dismisses the candidate list — discarded the whole edit. Cancelling dropped keyboard focus on `<body>`. The fitted textarea height went stale on window or panel resize, the unavailable pencil still painted a hover echo (unlike the shared IconActions chrome), and the edit-mode bubble was indistinguishable from the static one.

## Decision

Five behaviors, all inside `ui-message-edit` (the `ui-conversation` seats are unchanged):

**A failed resend keeps the editor armed.** The rejection notifies on the source composer as before, but the editor stays mounted with the draft intact, re-enables, and refocuses the field. Retry is another Send; discarding is still one Escape.

**The entry preconditions hold through the whole transaction.** The editor self-selects `running` and latest-user-seq via its session hook; while the session runs or a newer user message exists, Send blocks and a `role="status"` line beside the buttons (also `aria-describedby` on the field) names the reason (`editor.hint.running` / `editor.hint.stale`). The draft is never auto-discarded.

**Escape is IME-safe.** The same composition guard the Enter path uses (`isComposing` / keyCode 229 / the composition-window ref) now also gates Escape, so dismissing an IME candidate list cannot cancel the edit.

**Cancel returns focus to the pencil.** The editor and the pencil never coexist in the DOM, so the handshake rides a shared session-scoped store (`createMessageEditStore`, one handle passed to both registers): cancel records `returnFocusSeq`, the remounted pencil consumes it one-shot and focuses itself. A pencil that no longer renders (the message stopped being latest) still clears the request so it cannot leak onto a later mount.

**Presentation parity.** A ResizeObserver refits the textarea height on width changes. The unavailable pencil gets the same hover reset as the shared IconActions chrome. The edit-mode bubble carries an inset ring in the composer's input-border token (`--dsw-alias-border-l2-darkmode-thin`, box-shadow so the geometry stays byte-identical). The pending row is `aria-busy`; the buttons carry `aria-keyshortcuts`; the textarea label is the dedicated `editor.field` key.

## Alternatives considered

**Restore the bubble on failure (the shipped behavior).** Rejected: the revision is the operator's work and a transient fork failure must not destroy it; the composer's own failed-send path keeps the draft too.

**Auto-cancel the editor when a newer user message arrives.** Rejected for the same reason — it destroys the draft without the operator's consent. Blocking with the reason spelled out lets them copy the text or cancel deliberately.

**Allow sending from a stale editor (the `beforeSeq` cut is still well-formed).** Rejected: the product rule is latest-message-only, and a cut before an older seq silently drops the newer turns from the child — surprising data loss dressed as success.

**Focus return via a `returnFocus` owner prop on the `user-actions` seat.** Rejected: it widens the ui-conversation contract for one contributor's private handshake; the slot-system store is the sanctioned channel for exactly this cross-entry, remount-surviving interaction state.

**Window `resize` listener instead of ResizeObserver.** Rejected: the bubble width also moves with panel drags the window never sees; ResizeObserver is already the repo-wide pattern.

## Consequences

A fork failure is now recoverable in place; the operator can retry, edit further, or cancel. The latest-only invariant holds at confirm time, not just at entry. Keyboard and IME behavior match the composer. The cost is one more store in the plugin (shared by its two entries) and two more locale keys per language. Package tests pin every new path: composition Escape, running/stale guards with their announcements, failure re-arm with retry, focus return including the stale-request clear, and the width-refit observer.
