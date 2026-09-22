# Agent Note: Inline edit of a sent user message

Status: implemented

English | [中文](2026-08-15-inline-user-message-edit.zh.md)

> Partially superseded: the bubble-textarea edit surface described below was replaced by the composer edit session — see [2026-08-25-message-edit-composer-edit-session](2026-08-25-message-edit-composer-edit-session.md). The seat layout, the no-fork pencil, and the `beforeSeq` fork transaction still hold.

## Problem

The edit pencil on the latest user message forked a child session and moved the original text into the bottom composer as soon as it was clicked. The operator never edited the bubble they pointed at; the sidebar grew a child session before any revision existed.

A settled `user/message` is already in the session log and in the model's context. The Host has no in-place mutation for that event, so the product cannot rewrite the bubble in the same session.

## Decision

`ui-conversation` declares `conversation.chat.user-editor` (single, session) next to `conversation.chat.user-actions` on the finalized user node. `UserMessageNodeView` keeps a local `editing` flag: `startEdit` on the action-strip owner replaces the static bubble and IconActions with the editor occupant; `cancelEdit` restores them. Core conversation still ships no edit copy and no textarea.

`ui-message-edit` occupies both seats. The pencil calls `startEdit` and does not fork. The editor is a textarea in the user-bubble chrome plus Cancel / Send (`Button` `sm` ghost / primary). Escape cancels; Enter sends; Shift+Enter inserts a newline; all three are IME-safe. Confirm runs `sessions.fork({ beforeSeq, increaseTitle: true })`, resolves the child scope, `sessions.open(childId)`, then the child's input `setDraft(text)` and `submit()`. A failed fork or a missing child scope stays on the source session, notifies on that composer, and keeps the editor armed with the draft; the mid-edit guards and the focus-return store are settled in the [production-polish note](2026-08-25-message-edit-production-polish.md).

The log is unchanged: the child is cut before the edited turn, so the model never sees the old prompt twice. [Dropping the dead edit stub](../../archived/simplification/2026-07-31-drop-user-message-edit-stub.md) remains in force for `MessageIconActions`; the control lives only in the plugin.

## Alternatives considered

**Keep fork-on-click and composer prefill.** Rejected: the operator asked to edit the sent bubble, not to jump to a new session and the bottom composer.

**Mutate the settled `user/message` in the source log.** Rejected: no Host operation rewrites a consumed user event or the turn that already used it; inventing one is a session-format change, not a UI plugin.

**Replace the whole user node renderer from the plugin.** Rejected: the user bubble owns images, reference chips, and IconActions; a plugin that takes `conversation.chat.node` `user` must reimplement all of that. The editor seat is the additive replacement.

**Disable the bottom composer through `conversation.blocks` while editing.** Rejected: that registry holds one block per session; an edit block would clobber an existing reason (model routing, missing workspace).

## Consequences

Clicking the pencil is local React state on that user node. The first Host write is the confirm-time `beforeSeq` fork. Tests pin: the pencil does not fork; the editor prefills joined text; cancel restores the bubble; send is the fork/open/draft/submit sequence; a failed resend does not `open` and keeps the editor armed with the draft. The message-actions aria golden names the pencil `Edit`. Historical user messages, running turns, and non-text content stay without an armed editor.
