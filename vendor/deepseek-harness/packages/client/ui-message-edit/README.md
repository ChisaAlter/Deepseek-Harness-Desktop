# @deepseek-ai/dsh-client-ui-message-edit

English | [中文](README.zh.md)

The latest finalized text user message has an edit action. It promotes the resident bottom composer into an edit session: the current draft and images are stashed, the original prompt is seeded, and the existing banner and bubble marker expose cancellation. Clicking the pencil writes nothing to the Host.

Confirm sends the revision through the current scope's conversation service and Session Controller `prompt` with `editMessageSeq`. First and later messages always keep the same Session ID; no fork, title increment, or sidebar navigation occurs. The Host requires the latest turn-opening human message, an idle agent, and no queued work. Its pre-step consumer uses the existing surface replacement to remove that turn's old prompt and output from model history. Chat hides the superseded turn on live updates, reload, and pagination. The original append-only log remains available for diagnostics; prior tool side effects are not rolled back.

The editor retains the normal composer features, including references, image attachments, IME, and keyboard policy. Slash adjudication and draft persistence are suppressed while editing. Success ends the edit and restores the stashed draft; failure retains the revision for retry or cancel. Composer cancellation keeps focus in the composer; bubble cancellation returns focus to the pencil. Edit state publishes even when the seed or restored text is unchanged.

## Model Experience

The revised prompt replaces the latest user turn in the current Session's model history. Earlier turns and still-needed injected instructions remain; the old prompt and its generated output do not reach the new request.

#### KV Cache effect

A surface replacement starts a new request series. Provider reuse depends on the unchanged earlier prefix.

## Known Limitations and Deferred Work

- Only the latest finalized text user message is editable; running sessions and non-text originals remain unavailable.
- A target removed from the model surface by compaction cannot be edited.
- Chat displays the revision; diagnostic views retain the original log.
- Cancellation discards the revision and restores the pre-edit draft.
