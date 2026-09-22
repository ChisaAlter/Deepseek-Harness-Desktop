# Agent Note: models.dev enrichment on Fetch available models

Status: parked (desktop fork on dsh-v0.1.1-rc.1; landed via the wip park commit, not released yet)

English | [中文](2026-08-21-models-dev-enrichment-on-fetch.zh.md)

## Problem

Endpoint interrogation (`llm.discoverModels`) usually returns model ids and little else. The Models page already edits per-model `contextWindow`, `maxTokens`, and `reasoningEfforts`, but adopting a discovery result left thinking intensities unchecked and capacities blank unless the listing disclosed them. Operators then re-entered the same facts by hand, or left models without declared efforts so the composer offered no useful intensity set.

## Decision

After a successful discover on the Models page (`ModelListEditor`), the browser best-effort loads `https://models.dev/api.json` (force-cached) and enriches each candidate before the adopt picker: missing capacities come from the matched record's `limit`, and `reasoningEfforts` come from `reasoning` / `reasoning_options` using the same key/wire conventions the page already writes. Matching prefers an official-provider id guess, else a unique catalog hit, else the lowest-capacity ambiguous record; fields from different providers are never mixed. Endpoint-disclosed capacities always win. Unmatched ids and catalog/network failures leave the discovered row unchanged. The page does not invent a full effort checklist when metadata is silent.

Enrichment stays in the client package (`models-dev-metadata.ts`). It does not widen Host `discoverModels`, does not add a settings bridge, and does not auto-fill input modalities. Form specs can disable the network path through `setModelsDevEnrichmentDisabledForTests`.

## Alternatives considered

- **Blindly check every thinking intensity on adopt.** Wrong declarations reach the composer and can refuse or mis-route requests; rejected.
- **Enrich inside Host `discoverModels`.** Correct for one RPC, but adds Host network policy, caching, and adapter surface for a Models-page UX gap; deferred.
- **Require the community advanced-config plugin.** Official Models already owns the curated fields; the gap is adoption, not a second settings section.

## Verification

Unit specs cover match, effort mapping, capacity precedence, and best-effort failure. Provider-form specs adopt with stubbed models.dev metadata, preserve discover capacities, and adopt id-only rows when enrichment is disabled or unreachable. A manual live-endpoint probe driver lives at `scripts/live-fetch-enrich-probe.ts` (run by hand; not part of the spec gate).

## Consequences

Fetching available models can land usable context windows and thinking intensities without editing `settings.yaml`, while remaining fail-soft when models.dev is unavailable or the gateway uses private ids.
