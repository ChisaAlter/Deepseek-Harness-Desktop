# Blank Session reuse repair

Scope: `plugin-session-navigation` and `no-directory-sessions`. Preserve current branch, unrelated changes, all user logs, explicit title pins, and ordinary draft configuration.

## Diagnosis

New Session selected an old blank dshbot session after its presentation was released. Its durable user title remained pinned. `blank` means no turn has started, not that a Session has no identity.

## Implementation

1. Add a read-only `session.blankReuse({ sessionId })` RPC returning `{ reusable: boolean }`. Inspect current attached history or persisted history without activating an Agent. Missing sessions are ineligible; other read failures and cancellation remain errors. Reject forks, seeded/inherited sessions, subagents, started turns, system/user/assistant messages and tool results, title events, non-empty inbox input, goal/schedule work, and any prior non-null plugin presentation. Ordinary model, permission, and plan setup remains reusable. No new persistent fields or cache-version changes.
2. Expose `ISessions.canReuseBlank(sessionId, signal?)`. Both navigation paths prefilter obvious ineligible summaries, then obtain Host confirmation, recheck current membership/archive/summary state, and reuse or create. Coalesce the entire inspection-plus-create operation per target; release the in-flight entry on success and failure. Keep existing superseded-navigation behavior.
3. Add regression coverage for the exact bot-name/release sequence, untitled released plugin sessions, cold logs, title preservation, stale hints, missing candidates, positive ordinary drafts, failure/retry, and concurrent calls. Exercise first-send and restart in an isolated profile using the existing real-shell harness where available.
4. Update feature cards, design-language behavior notes, package contracts, Desktop decision/Agent Note, and vendor divergence documentation. Record bilingual pairs.

## Validation

- Focused Host/Client tests, existing workspace and presentation suites, title-pin tests, and keyless integration evidence.
- Host/Client typecheck, official build, Desktop tests and documentation/governance checks appropriate to touched files.
- Restart the repository app after the integrated code change, retaining the user's live session data.
- ChatGPT independently reviews the final diff and released verification output.

## Exclusions

Do not clear or regenerate existing user titles, rewrite old logs, change `blank` list visibility semantics, modify bot deletion semantics, or disable ordinary blank reuse. No branch, commit, publication, or deployment.
