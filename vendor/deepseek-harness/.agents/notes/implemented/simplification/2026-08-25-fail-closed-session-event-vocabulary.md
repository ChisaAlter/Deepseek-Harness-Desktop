# Agent Note: Require known session event types on read

Status: implemented

English | [中文](2026-08-25-fail-closed-session-event-vocabulary.zh.md)

## Problem

A session reader must not silently omit a durable event it does not understand. An unknown event can change later request reconstruction, policy state, recovery, or another plugin-owned projection, so successful JSON parsing is not enough to establish a faithful read. The reader before [issue #1901](https://github.com/deepseek-ai/deepseek-harness/issues/1901) passed unknown event types through while core folds ignored them, allowing a resumed session to lose semantics without a diagnostic.

The first refusal mechanism combined a generated known-event set with an optional per-record `ignorable: true` assertion intended for informational event additions. No production writer used the assertion, and `Session.append()` did not expose a way to set it. Event types added after the mechanism remained required-on-read. The unused field nevertheless expanded the canonical event type, seed validation, persistence formats, SQLite schema, session transport, DeepSeek request extension, generated catalogs, documentation, and tests.

## Decision

Every session event type is required-on-read. After supported legacy records are normalized, `PersistenceCoordinator` compares each event type with `KNOWN_SESSION_EVENT_TYPES`, the generated set of every `SessionEventMap` member declared in this repository. Any unknown type refuses reconstruction with `SessionFormatUnsupportedError`; the diagnostic names the event and sequence, identifies the likely newer writer, and includes the raw artifact path when the backend has one. The guard remains read-side only because rejecting an append after a live event is committed would interrupt durability before the session can report the unsupported log on its next load.

`SessionEvent` has no optional unknown-event skip field. JSONL continues to serialize the same event objects because no production append path emitted that field, and `SESSION_FORMAT_VERSION` remains `0`. The SQLite provider replaces the overloaded `ignorable` column with the schema-18 `is_packed` discriminator: scalar logical events store `0`, packed chunk rows store `1`, and an event name equal to a physical chunk tag remains unambiguous before the coordinator applies the known-type guard.

`SESSION_FORMAT_VERSION` remains one monotonic integer. A writer bumps it when an older runtime cannot interpret a structural or semantic change with full correctness: session header fields, event envelope fields, core event semantics, or the `SurfaceEventType`/`SurfaceOp` mechanism. Adding an event type alone does not require a bump because an older reader refuses that exact unknown type instead of misreading the log. Equal versions read normally; unequal versions currently refuse with a directional diagnostic. The n→n+1 upgrader chain remains deferred until a real v0→v1 step provides an input and output to test. A future view upgrade belongs in memory, with durable replacement only when the user continues the session; a missing step leaves the source artifact available for raw viewing.

Repository-external `SessionEventMap` members remain outside the generated set. They can run and persist during the live process, but a first-party persistence reader refuses them on reload until a real external-event consumer justifies a registration mechanism. This preserves the existing loud pre-release limitation without a composition-dependent known set.

## Alternatives considered

**Keep the per-record skip assertion.** Rejected because it has no production producer, is not expressible through `Session.append()`, and requires every storage and transport representation to preserve a speculative choice. A real need should first define which event type is safe to omit, then make the append implementation emit that classification consistently instead of relying on each call site.

**Ignore every unknown event.** Rejected because a reader cannot infer that an unknown durable fact is informational. Silent omission can resume a session with incorrect model input or plugin state.

**Bump the session format for every new event type.** Rejected because the generated type guard already makes older readers fail safely at the exact unsupported record, while newer readers continue to accept older logs. The format integer remains reserved for changes that alter how known records must be interpreted.

**Register known event names from mounted plugins.** Rejected without a current external consumer because the same build would accept or reject one stored log according to runtime composition. A future registration design must distinguish required plugin state from genuinely optional records and preserve that distinction on disk.

**Use major/minor versions or rewrite on view.** Rejected because upgrade availability is a property of each version step, not a promise encoded by two counters, and opening a session must not destructively rewrite its only artifact. A converter defect must not turn browsing into data loss or make an older runtime lose access merely because a newer one viewed the log.

## Consequences

An older build cannot resume a newer same-version log once that log contains any event type it does not know, even when the new event is informational. This is a deliberate loss of unused forward-degradation behavior in exchange for one event envelope and one failure rule. If a real producer later requires older readers to continue around an optional event, the design must classify the event type once, make `Session.append()` emit the persisted classification automatically, and cover both persistence backends and the wire representation.

First-party JSONL session bytes remain unchanged, including packed rows and `SESSION_FORMAT_VERSION = 0`. Existing first-party JSONL sessions remain readable. SQLite is opt-in and follows the pre-release schema policy: schema 18 has no migration from schema 17, and incompatible databases refuse rather than being rewritten. The [SQLite physical compression decision](../architecture/2026-08-18-sqlite-physical-chunk-row-compression.md) owns that backend's packed-row representation.

The assembled headless refusal test proves that a user sees the unknown type, sequence, newer-writer direction, and raw JSONL path. Core seed tests reject fields outside the current event envelope; persistence contract tests reject every unknown type; SQLite codec and differential tests cover scalar and packed discrimination, suffix reads, repair, and cross-backend logical equality. The generated persistence catalog and known-event module keep the reader's set synchronized with repository-owned declarations.
