# Agent Note: Drop the user-message edit stub

Status: implemented
Archived: 2026-09-04

English | [中文](2026-07-31-drop-user-message-edit-stub.zh.md)

## Problem

The user bubble's IconActions row carried an edit button beside copy and branch. Nothing backed it: the control had no click handler, no client mutation, and no host operation for resending an edited message. A user who found it saw an affordance the product cannot honor.

## Decision

`MessageIconActions` renders clock / copy / branch only, and its `edit` prop is gone with the button; `MessageItem` no longer passes it. The user bubble and the assistant chrome now differ only by clock side. A plugin may occupy `conversation.chat.user-actions` and `conversation.chat.user-editor` to put the control back; that path is [inline edit then fork-on-confirm](../feature/2026-08-15-inline-user-message-edit.md), not an in-log mutation.

The common locale keeps its generic `edit` term, which is shared vocabulary rather than this component's copy.

## Alternatives considered

**Disable the button with a tooltip.** A visible-but-dead control still advertises editing and costs the same explaining; removal is the honest state.

**Wire it to the queue editor.** The queue edits a message that has not been sent. A settled user message is already in the transcript and in the model's context, so reusing that editor would silently mean something else.

## Consequences

Web core chrome still has no edit button. The shipped reintroduction is a plugin that edits the bubble in place and forks before that message on confirm, because the Host still has no mutation over a settled user event.
