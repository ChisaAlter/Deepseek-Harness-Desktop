# Agent Note: SessionQuery.readSession restores persisted logs with Session.fromRestore

Status: implemented

English | [中文](2026-09-18-session-query-seeded-restore.zh.md)

## Problem

`SessionQueryEngine.readSession` loaded a complete persisted log and then validated it with `Session.create`, the snapshot/fork-creation constructor. For a seeded session `Session.create` requires `seed.length === inheritedEventCount` — the seed must be exactly the inherited prefix. A stored seeded log is longer than that: inherited prefix, the `session/end-seed` marker, and the session's own events. Every persisted seeded session therefore failed its exact read with `seeded session constructor seed must equal its inherited prefix`, even though the artifact was intact — verified by replaying a real 25-session corpus where the 4 failures were exactly the seeded ones and `Session.fromRestore` accepted all 25.

## Decision

Validate the loaded log with `Session.fromRestore(id, events, header, inheritedEventCount, 'detached', projections)` — the constructor built for restoring a complete stored log. `readSession` passes the full loaded event list, the persisted `inheritedEventCount`, detached event ownership (the load owns its decoded clones), and the same `currentSessionMessageProjections` catalog as before.

## Alternatives considered

**Truncate the event list to the inherited prefix before `Session.create`.** That throws away the session's own events and validates an artifact that does not exist on disk; the read path must confirm the complete log, not a prefix of it.

**Relax the `Session.create` invariant.** The invariant is correct for what `create` models — a fork snapshot whose seed is exactly the inherited prefix. Widening it to accept post-seed events would blur the two construction modes that the `Session` type deliberately keeps distinct.

## Consequences

Persisted seeded sessions read back through `readSession`; unseeded sessions are unaffected because `fromRestore` performs the same structural replay for them. A regression spec in `session-query.spec.ts` stores a seeded entry (nonzero inherited prefix plus session-local events) and drives the real `readSession` path, and `TestPersistence` entries now carry an optional `inheritedEventCount` to express it.
