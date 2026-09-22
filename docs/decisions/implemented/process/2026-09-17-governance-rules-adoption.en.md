# Decision: Adopt upstream DSH governance machinery as DSHD rules

Status: implemented

[中文](2026-09-17-governance-rules-adoption.md) | English

## Problem

DSHD already has feature cards (current contracts) and `.cursor/rules` (short invariants), but decision motivation and rejected alternatives scatter across `docs/superpowers/` working documents and rot over time; rules have no mechanically checked format; documentation has no bilingual consistency mechanism; and the external contributor surface (PR/issue templates, CONTRIBUTING, label taxonomy) is missing.

## Decision

Per the [plan](../../../superpowers/plans/2026-09-16-dshd-governance-rules.md), port the governance machinery of upstream `vendor/deepseek-harness` (dsh-v0.1.5-rc.2): a `docs/decisions/` decision-record tree (this directory; lifecycle and class encoded in paths), an enumerated feature-card `status`, a `scripts/verify-*` gate family aggregated by `run-gates.mjs` (`npm run doc-sync` / `npm run check:governance`), a mandatory `Decision:` field in card `## Sources` (`none` or a link to a decision record), the one-command `scripts/archive-decision.mjs` archive flow, full bilingual pairing (zh source + `.en.md` + `.i18n.yaml` + merge driver; scope in [2026-09-17-bilingual-pairing-contract](2026-09-17-bilingual-pairing-contract.en.md)), zero-dependency git hooks (`core.hooksPath` installed by `prepare`), the contributor surface (CONTRIBUTING / PR/issue templates / dependabot), and `docs/postmortem/`.

## Alternatives considered

- **Keep using feature cards only** — rejected: cards only state what is; rejected alternatives have no home and get re-litigated.
- **Copy upstream `.agents/notes` naming and English-source convention verbatim** — rejected: DSHD documents are Chinese-source with `.en.md` counterparts; keep the existing convention.
- **Adopt lefthook / vitest / pnpm** — rejected: zero new dependencies; `node:test` + npm `prepare` + small scripts suffice.
- **Weighted approval and an issue Projects state-machine bot** — deferred: unneeded at single-maintainer-plus-agent scale; revisit when contributor volume grows.
- **Gates enforced by reviewer memory only** — rejected: upstream's conclusion is that "convention without a gate" is no convention at all; every mechanically checkable clause becomes a `verify-*`.

## Consequences

Every non-trivial change costs one more record; in return the repo gets a mechanically checked format, a rejected area that prevents re-litigation, rules an external contributor can read, and a standing obligation to maintain the gate scripts themselves (each `verify-*` ships with a spec).
