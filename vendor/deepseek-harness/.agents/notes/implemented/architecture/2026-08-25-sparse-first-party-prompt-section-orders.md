# Agent Note: Centralize sparse first-party prompt-section orders

Status: implemented

English | [中文](2026-08-25-sparse-first-party-prompt-section-orders.zh.md)

## Problem

Repository-owned system-prompt sections declared unrelated numeric literals across more than twenty packages. The main tool sequence occupied consecutive values from 100 through 117 and then used half-step values for insertions. A later change could therefore collide with an existing section without seeing the complete allocation.

Equal orders used stable JavaScript sort behavior, which made plugin activation order the effective tie-breaker. The [Cordis/workflow prompt-order fix](../../archived/bug-fix/2026-08-24-system-prompt-section-order-ties.md) showed that clean compositions can activate the same plugins in different orders and produce different request headers and snapshot results. Fixing one collision locally did not prevent another package from reusing that value.

The shell guidance also followed filesystem guidance even though shell commands have the broadest execution and failure semantics. A model should read the shell result obligation before the narrower instructions that route file work to dedicated tools.

## Decision

`@deepseek-ai/dsh-system-prompt` exports `FIRST_PARTY_SECTION_ORDER` as the single allocation for repository-owned sections. Every first-party contributor imports its named placement instead of declaring a numeric literal. Values are unique integers, and adjacent allocated values differ by at least ten.

The allocation preserves the established first-party sequence except for two deliberate changes: Bash, or PowerShell in the Windows composition, leads per-tool guidance; and sections that shared an order receive an explicit sequence. The groups are:

| Group | Entries |
|---|---|
| Product opening | `harness:identity` −1000, `harness:source` −900, `app:web-surface` −800, `deployment:persona` 0 |
| Work modes | `plan:policy` 500, `team:policy` 600 |
| Invocation prelude | `tools:ptc-only` 800, `context:file-reference` 900 |
| Local tools | `tool:bash` 1000, `tool:pwsh` 1010, `tool:read` 1100, `tool:write` 1200, `tool:edit` 1300, `tool:glob` 1400, `tool:grep` 1500, `tool:jobs` 1600, `tool:pty` 1700 |
| Higher-level tools | `tool:web_search` 2000, `tool:web_fetch` 2100, `tool:lsp` 2200, `tool:session-query` 2300, `tool:goal` 2400, `tool:cordis` 2500, `tool:workflow` 2600, `tool:ralph` 2700, continuable-subagent guidance 2800, `tool:report` 2900 |
| Generated protocol | `tools:sdk` 5000 |
| Final-output obligations | deliverable file references 9000, `tool:structured_output` 9900 |

`SystemPrompt.assemble()` sorts equal-order sections by code-unit section name after comparing `order`. This makes third-party collisions deterministic without locale-sensitive comparison. First-party contributors still receive distinct ranks so their intended sequence remains explicit rather than depending on the fallback.

Dynamic `PromptContext` order and tool-schema `toolOrder` are separate sequences and remain unchanged. A scoped `deployment:persona` continues to shadow the global section by name before section sorting, so it shares `PERSONA_ORDER` rather than consuming another placement.

## Verification

The system-prompt unit suite verifies that every exported first-party value is an integer, every value is unique, adjacent values differ by at least ten, and opposite registration permutations produce the same code-unit name order for a tie. Real-composition snapshots pin the model-visible ordering change, including Bash before filesystem guidance and the explicit Cordis, workflow, Ralph, subagent, and report sequence.

## Alternatives considered

**Keep package-local numeric literals and review collisions manually.** Rejected because a contributor cannot see the complete allocation locally, and the collision that motivated the earlier fix recurred after that fix merged.

**Continue inserting fractional values.** Rejected because fractions provide no durable spacing rule, obscure the semantic groups, and still permit unrelated packages to choose the same value.

**Normalize only snapshot comparisons.** Rejected because the runtime request header and model prompt would remain activation-order dependent while the test hid the difference.

**Preserve activation order for equal ranks.** Rejected because activation order is not a prompt-order decision and varies across valid compositions. Name order is deterministic for external collisions; explicit named placements carry first-party intent.

**Renumber dynamic contexts and tool schemas in the same allocation.** Rejected because they are independently assembled sequences. Combining them would imply cross-sequence ordering that the runtime does not perform.

## Consequences

Numeric ranks are not rendered, so the renumbering alone does not change model text. Bash or PowerShell moves before other per-tool guidance, and previously tied sections acquire deterministic order; those model-visible changes update request-header snapshots and may invalidate provider prefix reuse from the first moved paragraph.

An external plugin that chose a raw number specifically to sit between old first-party values may move relative to repository sections. This repository is pre-release and provides no compatibility shim for the old allocation; extensions can select positions from the exported current allocation. Equal external ranks remain supported and deterministic by name.

The system-prompt package now knows the names and relative placement of repository features. That centralized coupling is deliberate: the registry already owns the ordering semantics, while distributed numeric literals made the same relationship implicit and uncheckable.
