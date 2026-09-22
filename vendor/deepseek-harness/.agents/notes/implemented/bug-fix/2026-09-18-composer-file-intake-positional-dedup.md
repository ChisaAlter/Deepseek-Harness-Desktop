# Agent Note: Composer file intake dedupes transfer lists by position

Status: implemented

English | [中文](2026-09-18-composer-file-intake-positional-dedup.zh.md)

## Problem

Pasting one image into the composer drafted two identical attachments; dropping files did the same. Both intake sites — the composer keymap's `PASTE_COMMAND` and the `ui-attachment` drop listener — collect from `dataTransfer.items` and then sweep `dataTransfer.files` for entries no item claimed (the recovery the [folder-intake note](2026-09-14-composer-folder-intake-rejection.md) added), deduplicating the two lists by `File` object identity. Real transfer objects mint a fresh `File` at every accessor: `items[i].getAsFile()` never shares identity with `files[i]` — two calls to the same `getAsFile()` do not even equal each other — so the identity set never matched and every real pasted or dropped file landed in the intake twice. Both the unit specs and the Playwright e2e missed it because they hand `items` and `files` the same `File` instances (fixture objects and `new DataTransfer()` share identity, real clipboard transfers do not).

## Decision

Dedup by position. `dataTransfer.files` mirrors the items' file entries in order, so the sweep skips one leading entry per item that produced a `File` (a `productive` count) and collects only the leftovers. A folder stub counts as productive — its `files` mirror stays rejected-only — and an `items` list that produces nothing (string-kind entries or `getAsFile` returning `null`) still sweeps every `files` entry, so the unclaimed-file recovery is unchanged. The same loop now runs in both intake sites.

## Alternatives considered

**Drop the `files` sweep.** It is the only recovery for files the item list cannot produce; without it a non-enumerating engine silently loses drops and pastes, which is the case the sweep was added for.

**Dedup by content signature (name + size + type).** Two genuinely different files can share all three (identically named screenshots of equal size), so the signature collapses a real second file — a silent loss worse than the duplicate it prevents.

**Dedup by reading bytes.** Comparing file contents on the synchronous paste/drop path adds async reads to a hot gesture and still cannot order which duplicate survives.

## Consequences

One real pasted or dropped file produces exactly one draft attachment; the accepted batch keeps item order. `classified`/`Set<File>` bookkeeping is gone from both sites. Regression specs in `input-bar.client.spec.tsx` and `composer-attachments.client.spec.tsx` model real-transfer identity (fresh `File` per accessor) so the fixture can no longer mask the mismatch.
