# Agent Note: Vision catalog modalities and Volcengine ARK developer role

Status: implemented

English | [中文](2026-08-18-vision-catalog-modalities-and-ark-developer-role.zh.md)

## Problem

A hand-declared `openai-completions` route against a Volcengine ARK coding endpoint failed two independent ways that often appeared in one configuration.

**A.** `llm.models` / `session.models` listed models without `inputModalities`. The vision-fallback picker flattened every row, so a catalog-missing vision id (or any text-only model) could be stored as the designated route. Chat paste then admitted the image because a fallback route was configured, and `llm-pi-ai` refused locally with `pi-ai model "…" does not support image input` before any network call. The Models form already lets an entry declare `input`; the listing and the picker did not consume that fact.

**B.** pi-ai's completions adapter sends a reasoning model's system prompt as `role: "developer"` when `compat.supportsDeveloperRole` is true, and its URL detection treats unrecognized hosts as standard OpenAI. `ark.*.volces.com` is not in that whitelist, so ARK returned 400: it accepts only `system`, `assistant`, `user`, and `tool`. `PiAiCompatProfile` offered `thinkingFormat` and `supportsReasoningEffort` only, so the YAML workaround `compat.supportsDeveloperRole: false` could not survive the schema.

## Decision

**A.** `buildModelCatalog` copies each listed model's `inputModalities` onto `ModelCatalogModel`. `VisionModelPicker` offers only rows whose list includes `'image'`. A stored route that is missing from that filtered list stays selected as a stale option (ids, not display names) so a previously saved text-only designation does not snap to Off.

**B.** `PiAiCompatProfile` includes `supportsDeveloperRole`, at the same two altitudes and with the same openai-completions-only rule as the other dispatch switches ([[2026-08-08-pi-ai-per-model-reasoning-declarations]]). Resolution is model → route → installed catalog entry → `false` on a `volces.com` / `*.volces.com` host → pi-ai's URL guess. An explicit `true` or `false` still wins on an ARK host. pi-ai's `getCompat` already honours `model.compat.supportsDeveloperRole`, so the materialized field is what the wire reads.

The Models editor has no compat control for this switch: the ARK default covers the common case, and `settings.yaml` remains the override.

## Alternatives considered

- **Defaulting every hand-declared completions route to `supportsDeveloperRole: false`.** Safer for third-party gateways, but a hand-declared route that really is `api.openai.com` would stop sending `developer` until the profile opted back in. Host detection on `*.volces.com` fixes the reported endpoint without changing other gateways.
- **Patching pi-ai's `isNonStandard` whitelist.** The detection lives in `@earendil-works/pi-ai`; this repository pins that package and does not vendor its sources. A harness-side default plus an explicit profile field is the layer this adapter already owns for the other dispatch switches.
- **Inferring image capability from the model id (date-suffix stripping, catalog fuzzy match).** A wrong yes admits an image the provider then rejects mid-turn, after the message is durable. Declared `input` plus a filtered picker is the same claim the rest of the modality chain already uses ([[2026-08-12-pi-ai-route-default-input-modalities]]).
- **Making `VisionFallback.configured()` false unless the designated model advertises image.** That would push the YAML-only misconfiguration back to the main-model admission error (`Model "…" does not support image input`), which names the wrong model. The picker filter and the existing pi-ai local refusal remain; a friendlier fallback-route diagnostic is not part of this change.

## Consequences

A vision-fallback designation made from the Models page can only name a model the catalog listed as image-capable, unless the operator keeps a stale stored route or writes `settings.yaml` by hand. An ARK reasoning route sends `system` without extra YAML. Other unknown OpenAI-compatible hosts keep pi-ai's developer-role default.

## Testing

`packages/host/apiproxy/tests/api-proxy-models.spec.ts` pins listed `inputModalities` on `llm.models`. `packages/client/ui-settings-models/tests/vision-model-picker.client.spec.tsx` pins the image-only options, the stale text-only selection, save/off, and load/save failures. `packages/llm/llm-pi-ai/tests/catalog.spec.ts` pins the ARK host default, explicit override, unparseable URL, and the openai-completions-only refusal; `adapter.spec.ts` pins the wire `messages[0].role === "system"` when the route declines the developer role; `config.spec.ts` pins the schema field.
