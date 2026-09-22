# Agent Note: Host-authoritative blank Session reuse after presentation release

Status: implemented

English | [中文](2026-09-18-blank-session-reuse.zh.md)

## Problem

New Session could reuse an old blank Session after a plugin presentation was released. A durable title pin and a stale list summary did not prove that the Session was an ordinary draft. Workspace and no-directory navigation also needed the same answer for cold history, missing candidates, changed membership, and concurrent creation.

## Decision

The Host owns a read-only `session.blankReuse({ sessionId })` decision. It inspects attached or persisted history without activating an Agent. This replaces the summary-only blank reuse rule recorded in the [Web client scope note](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md). `blank` means that no `turn/start` has occurred, but any `session/title` history, parent/seed/inherited/subagent identity, `turn/start`, `system/message`, `user/message`, `assistant/message`, or `tool/result` history disqualifies the Session. A non-null `session/presentation` at any point disqualifies it even if a later null presentation releases the current display; an isolated null presentation remains eligible when the other checks pass. Ordinary model, permission, and plan setup remains eligible. A missing Session returns `reusable: false`; real read failures and cancellation propagate.

The Client exposes the same decision as `ISessions.canReuseBlank(sessionId, signal?)`. Workspace and no-directory New Session connectors prefilter obvious summary exclusions, await Host confirmation, recheck current membership and archive state, and coalesce the complete inspection, recheck, and creation operation per target. Ineligible, missing, or changed candidates are skipped and a new Session is created; a real read error or cancellation propagates and does not create. Main-area navigation retains the target, runs `beforeOpen` only for the current request, commits selection, and releases the previous reference in the existing order.

The decision adds no projection-cache field or version. It does not clear a title pin, rewrite an old log, or alter ordinary draft configuration. A user can explicitly open a titled or otherwise ineligible Session and continue it with its existing data.

Historical non-empty `agent/inbox/spliced` input, `goal/change`, or `schedule/change` also excludes reuse: these events can persist pending work before the first turn. Later cancellation or goal clearing does not turn that identity into a new draft; empty inbox operations and ordinary configuration remain eligible.

## Alternatives considered

- **Use only list summaries in the Client** — rejected: stale summaries cannot establish whether a Session has historical title, presentation, identity, or transcript events, and concurrent navigation could bypass Host authority.
- **Clear or rewrite title pins and old logs** — rejected: New Session reuse is a navigation choice and must not destroy user data or durable evidence.
- **Treat a released presentation as ordinary again** — rejected: a historical non-null presentation remains an ownership fact even after its current display is released.

## Verification

Validation passed 25 Host boundary tests, 272 Workspace tests, and both real-browser New Session, first-send, and reload flows. Cold JSONL/zstd and browser checks preserved old logs. The official Host/Client/Web build passed.

## Consequences

Both New Session paths use one authoritative eligibility decision. Ordinary configuration and an isolated null presentation remain reusable, while title history, historical presentation, identity, turn, and transcript content cause creation of a new Session. Explicit opening retains the old Session, title pin, and log. Read failures and cancellation remain visible to callers and do not silently create a replacement.
