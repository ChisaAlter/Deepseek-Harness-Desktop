# Decision: Include v3 session logs in the desktop import gate

Status: implemented

[中文](2026-09-23-v3-session-import-gate.md) | English

## Problem

Harness now writes current sessions as `session.v3.jsonl` or `session.v3.jsonl.zstd`, while the desktop importer recognized only the legacy `session.jsonl` names. It therefore treated a desktop home containing v3 sessions as empty and omitted v3 sessions from official import sources. With importable official data present, the import gate blocked automatic desktop start on every cold launch.

## Decision

The importer recognizes legacy and v3 names through the same file-name predicates. `probeImportHold`, `scanImport`, conflict checks, and display metadata use those predicates; compressed v3 logs follow the existing zstd reader. The cold-start probe still checks names only and never decompresses or migrates sessions.

## Alternatives considered

- **Count v3 files only in the cold-start gate** — rejected: the import page would still call the same home empty and omit current sessions from official sources, giving the two entry points conflicting answers.
- **Treat any session directory as data** — rejected: empty directories and unfinished staging directories would bypass the first-run import check; the existing gate requires an actual session log.

## Consequences

Existing v3 sessions no longer trigger a false first-run import hold. Users still select and confirm imports, and the official home remains read-only. Regression tests cover a compressed v3 destination and a plain v3 source; the real desktop home's shallow probe changes from `hold:true` to `hold:false`.
