# Agent Note: Message editing uses the resident composer and keeps the Session

Status: implemented

English | [中文](2026-08-25-message-edit-composer-edit-session.zh.md)

## Decision

The resident composer is the edit surface. `SessionInput.beginEdit` stashes the user's draft and images, seeds the original prompt, publishes edit state, and redirects submit. There is no second bubble editor. Cancel restores the stash; composer cancellation keeps focus in the composer, while bubble cancellation returns focus to the pencil. Edit entry and exit publish even when draft text is unchanged.

Confirmation always keeps the current Session ID, including its first user message. The scoped conversation service uses the ordinary attachment admission and prompt receipt with `editMessageSeq`, never fork or navigation. Host admission checks the latest turn-opening human message, idle status, and absence of pending work after attachment preparation. Pre-step repeats the target check and supplies a message-id-keyed `surfaceIntents` entry. The loop commits the revised prompt through the existing Session surface replacement validator. Earlier turns survive; replaced user input, model output, and tool results leave model history. Still-needed injected instructions remain logged as retained copies, while fresh context from the same producer takes precedence.

The revision's Host-owned `source.edit` records the target message and turn. Chat materializes user replacements and accumulates superseded turn ids, hiding their rows, navigation entries, and legacy contributions during live append, replay, and pagination. Compaction replacements remain model-only. Original log events stay immutable and contiguous, and already-executed tool side effects are not undone.

## Alternatives

File-instruction contexts accumulate across revisions; fresh snapshots from the same producer take precedence, while old one-off notices, relays, and recalls are not retained. The Client obtains the scoped conversation service through `scope.get('conversation')`, because that Session scope does not declare the feature's injected properties.

Fork-and-open violates the product requirement that editing never creates another conversation. Physical truncation would invalidate append-only persistence and event cursors. A second bubble editor duplicates the composer's state and loses references, attachments, and keyboard behavior. The existing surface replacement preserves replayability without either change.

## Verification

The plugin tests pin no fork or open calls for first and later messages, cancellation, and admission failure. Controller tests drive the real inbox and loop, checking model-visible history, repeated edits, original-log preservation, and replay. Chat assembly tests cover live updates, reload-equivalent replay, and older-page materialization. The keyless Web scenario boots the real profile and exercises both first and second messages, both cancel paths, repeated edits, sidebar count, draft restoration, and refresh.

## Limits

Only the latest text user message is editable while idle. Compacted targets absent from the model surface are rejected. Diagnostic views retain the append-only log, and edits do not undo tools. Failed admission retains the revision for retry or cancellation.
