# Agent Note: Models form offers every pi-ai thinking level

Status: implemented

English | [中文](2026-08-19-models-form-thinking-levels.zh.md)

## Problem

The Models catalog editor could declare only five of pi-ai's seven thinking levels (`low` through `max`), labeled `max` as Extreme, and left `off` / `minimal` as YAML-only. Adding a third-party reasoning model therefore could not offer Off or Minimal, and users looking for Max did not see it.

## Decision

Each pi-ai model row lists every canonical level — `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` — as wrapping equal-width chips. A checked level other than `off` writes that same string as the wire spelling (`high: high`). Checking Off writes `off: null`: Off is offered and dispatch sends nothing, matching the valueless YAML `off:` case in [Per-Model Reasoning Declarations](2026-08-08-pi-ai-per-model-reasoning-declarations.md). A dict that offers only Off is refused before apply; that is neither a thinking model nor `reasoningEfforts: false`. Composer picker labels for `xhigh` / `max` are Extra High / Max.

## Alternatives considered

**Keep Off YAML-only because a checkbox is a thinking intensity, not "don't think".** Rejected: Off is a named level users configure (OpenAI `none`, DeepSeek disable), and the form already owned the rest of the ladder.

**Write `off: off` like the identity mapping for other levels.** Rejected: a valued `off` sends that spelling on the wire; the common case is valueless Off. OpenAI's `none` rename stays YAML-only with the other custom spellings.

**Add Gemini `thinkingBudget` or a free-text Ultra chip.** Rejected: those are a token cap and a gateway rename, not another pi-ai thinking level.

**Keep Extreme as the Max label.** Rejected: Max is the API name users look for.

## Consequences

Hand-declared models can offer the same named ladder OpenAI, Anthropic, DeepSeek, GLM, and Grok document. Custom wire renames remain YAML-only. The input-type checkboxes on the same card reuse the chip layout.

## Testing

`provider-form.client.spec.tsx` pins the seven chips, `off: null` plus identity spellings, and apply refused for Off alone. `validateDeepSeekModels` pins `effortOffAlone`. `adapter.spec.ts` and the `declared-reasoning` web snapshot pin Extra High / Max picker names. `styles.client.spec.ts` pins wrapping equal chips. The `models-settings` declared-edit snapshot pins the Chinese chip labels.
