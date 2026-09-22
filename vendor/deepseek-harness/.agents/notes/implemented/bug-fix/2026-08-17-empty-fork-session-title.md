# Agent Note: Empty-fork sessions keep an automatic first-prompt title

Status: implemented

English | [中文](2026-08-17-empty-fork-session-title.zh.md)

## Problem

Editing the first user message, or otherwise `beforeSeq`-forking before the first `turn/start`, creates a blank child. The client then `rename`s that child to `Parent (1)` with `source.kind: 'user'`. A user pin blocks automatic title generation, and first-prompt scheduling also refused any session with `parentSession` set. The child's first new prompt therefore keeps the parent's topic in the sidebar even when the conversation is unrelated.

## Decision

First-prompt schedules when the eligible human-message count is 1 and the latest title is not user-pinned, including a parented session. Continuation forks still skip that cadence because they inherit at least one eligible human message.

`SessionRuntime.fork` applies `increaseTitle` only when the Host reports `blank: false`. A blank child keeps an unpinned inherited or absent title so fallback and first-prompt can run from the new first message. A true `session.rename` on a fork still pins.

Log-backed title ownership stays in [log-backed session titles](../feature/2026-07-21-log-backed-session-titles.md). The Web fork action and `(N)` increment stay in [Web session fork actions](../feature/2026-07-27-web-session-fork-actions.md).

## Alternatives considered

**Treat fork-incremented titles as a non-pinning `fork` source kind.** Rejected because blank children do not need a durable `(1)` suffix, and a new source kind would widen the title invariant and persistence catalog for a client-only numbering policy.

**Retitle every fork from its first child-owned prompt.** Rejected because a continuation fork is still the same topic; first-prompt would either restate the inherited first message or ignore later follow-ups. `messages.length === 1` already distinguishes an empty seed.

**Keep first-prompt root-only and skip only the client rename.** Rejected because a parented blank child would still never schedule the provider after fallback.

## Consequences

A first-message edit or empty `beforeSeq` fork titles from the new prompt. Continuation forks still show `Parent (1)`. A manual rename on a blank child continues to pin.

## Testing

`session-title` pins a parented empty child whose first prompt runs first-prompt, a user rename on that child that still blocks it, and a continuation fork that still skips first-prompt. Client `sessions-service` pins `increaseTitle` with `blank: true` skipping `session.rename` while `blank: false` still increments.

## Related

[Log-backed session titles](../feature/2026-07-21-log-backed-session-titles.md). [Web session fork actions](../feature/2026-07-27-web-session-fork-actions.md).
