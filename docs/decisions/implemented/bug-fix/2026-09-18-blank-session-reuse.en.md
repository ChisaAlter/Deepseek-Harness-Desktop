# Decision: Host-authoritative blank Session reuse after presentation release

Status: implemented

[中文](2026-09-18-blank-session-reuse.md) | English

## Problem

New Session could select an old blank dshbot Session after its plugin presentation had been released. A durable user title remained pinned, so summary-only checks could mistake the row for an ordinary draft even though its history had previously carried plugin presentation metadata. Workspace and no-directory navigation also needed one shared decision about cold logs, stale summaries, and concurrent create races.

## Decision

The Host exposes a read-only `session.blankReuse({ sessionId })` RPC returning `{ reusable: boolean }`, and the Client exposes `ISessions.canReuseBlank(sessionId, signal?)`. The Host inspects current attached history or persisted history without activating an Agent. A missing Session returns `reusable: false`; other read failures and cancellation remain errors.

`blank` continues to mean that no turn has started. Any `session/title` in history makes a Session ineligible for New Session reuse; when the user explicitly opens it, the old pin remains unchanged. A Session is also ineligible when its current or historical presentation metadata is non-null, or when history contains `system/message`, `user/message`, `assistant/message`, `tool/result`, or `turn/start`; seeded, forked, inherited, and subagent identities are also ineligible. Ordinary model, permission, and plan setup remains reusable.

Both Workspace and no-directory navigation prefilter obvious ineligible summaries, await Host confirmation, recheck current membership and archive state before reuse, and coalesce the complete inspection-plus-create operation per target. A stale or rejected candidate creates a new Session. No Agent is activated, no cache schema or version changes, and no old log or title is rewritten.

Historical non-empty `agent/inbox/spliced` input, `goal/change`, or `schedule/change` also excludes reuse: these events can persist pending work before the first turn. Later cancellation or goal clearing does not turn that identity into a new draft; empty inbox operations and ordinary configuration remain eligible.

## Alternatives considered

- **Summary-only client filtering** — rejected: a stale summary cannot establish that a released plugin presentation never existed, and it lets cold or concurrent navigation bypass Host authority.
- **Clear or regenerate titles when releasing presentation** — rejected: releasing presentation must not destroy an explicit user title or rewrite durable history.
- **Allow existing title pins to participate in reuse** — rejected: a title pin means the user has already established the Session's identity; New Session must not reclaim it, while explicit opening must preserve the pin.

## Consequences

New Session reuse now follows one Host decision for both Workspace and no-directory paths. Ineligible, missing, or changed candidates are skipped for creation, while real read and cancellation errors propagate and do not create, allowing a retry. Existing user titles, logs, pins, ordinary draft configuration, membership data, and layout are preserved. Validation passed 25 Host boundary tests, 272 Workspace tests, and both real-browser New Session, first-send, and reload flows. Cold JSONL/zstd and browser checks preserved old logs. The official Host/Client/Web build passed.
