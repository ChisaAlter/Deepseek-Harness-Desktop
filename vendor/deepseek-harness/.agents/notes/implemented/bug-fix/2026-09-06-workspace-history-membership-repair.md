# Agent Note: Repair surviving Workspace history membership

Status: implemented

English | [中文](2026-09-06-workspace-history-membership-repair.zh.md)

## Problem

An initialized registry can retain incomplete session membership after imports or an older registration implementation. The sidebar intentionally excludes unaccounted non-scratch sessions, so existing active and archived histories disappear even when their directory remains registered. The archived-list preference cannot reveal rows excluded by membership.

## Decision

Workspace startup reuses its canonical header index to adopt unaccounted histories into surviving registrations before the service becomes available. It uses the same candidate selection as explicit directory re-addition and the existing entity attach path. New members are prepended newest-first; previous member order, Workspace identity, and archive state are preserved. No event bodies are read, and directories without a registration remain hidden.

## Alternatives considered

**Show every session by cwd in the Client.** This bypasses Host membership and restores deleted Workspace histories in search and archived views. Repairing the Host account keeps all clients on the same data.

**Require users to re-add every existing directory.** The explicit re-add path repairs membership, but it leaves ordinary startup and the archive preference unable to recover imported histories without an unrelated action.

## Consequences

Startup can write missing members. A storage failure rejects startup; the next startup retries remaining members. Repeated successful starts perform no membership writes. Header-only registry tests cover recovery, archive preservation, deleted-directory exclusion, original ordering, and idempotence. Component tests cover the shared preference in grouped and flat views.
