# Agent Note: Custom-provider DeepSeek models are listable and priceable

Status: implemented

English | [中文](2026-08-29-custom-provider-deepseek-model-price.zh.md)

## Problem

The price settings panel (设置模型价格 / 价格设置) could not show a custom provider's DeepSeek model when its id coincided with an official DeepSeek column. Two independent collapses produced the symptom.

In `PriceSettingsPanel`, the dropdown deduplicated entries case-insensitively by model id and classified every id in the official price table as read-only. A directory model served by a custom gateway (e.g. `my-gateway` relaying `deepseek-v4-flash`) was therefore swallowed by the officially pushed `deepseek-v4-flash` column, left no user-selectable entry of its own, and — even when selected — rendered disabled because the panel ran `officialPriceFor` purely on the model id. The user could not price their own endpoint at all.

Independently, `ModelDirectoryResolver` keyed its fiber-level catalog union by model id only. When the official route's group advertised the same id before the custom provider's group, the custom provider's entry was dropped from `catalogModelIds()`, so the settings-row aggregate never handed the panel the non-official provider at all.

## Decision

Both layers now recognize that a model id is not the same thing as the route serving it.

The panel keeps the official columns listed read-only and adds every directory (provider, model) pair as its own editable entry keyed `provider/model` — two providers may serve the same model id with different real-world prices, so each is listed and priced separately instead of collapsing into whichever provider advertised first. A legacy bare-model price migrates on open to every editable directory entry serving that model, and `resolveModelPrice(provider, model, prices)` reads the composite key first, then the bare legacy key, then the official column; the dock passes the session's provider from the last-used message provenance. `isDeepSeekProvider` moved from `chat/peak-valley.ts` to the shared `price-calculator.ts` so the panel and the peak/valley row read one fact source; `chat/peak-valley.ts` re-exports it for the row's existing import.

The resolver keys `catalogUnion` and de-duplicates `catalogModelIds()` per `(provider, id)` instead of per id, so the root-scope settings row carries a custom provider's same-id model alongside the official route's instead of collapsing into whichever advertised first. The union is also seeded from the host-scoped `llm.models` catalog on boot and on every topology/settings invalidation, so a provider the user just added in Settings → Models is listable in the price panel even before any session directory publishes its models. `catalogOf` (the composer/dock catalog) now keys its current-selection fallback by `(provider, id)` as well, so a custom provider's current model whose id another provider advertises is still appended.

## Alternatives considered

- **Pricing keys per `provider/model`.** Adopted: a provider route id never contains a `/`, so the first `/` splits the key unambiguously even when a model id contains one, and the persisted record keeps one slot per (provider, model) so two providers serving the same id price separately.
- **Showing both the official column and the prefixed directory entry.** The custom entry carries a distinct option value (the `provider/model` key) while the draft and persisted record use that same key, so the official column stays selectable and each provider's edit lands in its own slot.
- **Deduplicating by id in the resolver but letting the panel show the current selection.** Rejected: the current selection fallback covers only the model in use, not every advertised model of the custom provider, and the settings row has no session scope to read a current selection from.

## Consequences

A model id is no longer one price slot across routes: the record keys per `provider/model`, so a custom-provider entry for an official-column id or a same-id model on two providers prices each route independently, and the legacy bare key still bills any provider until re-saved. Official columns stay listed read-only next to the custom entries. A custom relay whose own route id contains "deepseek" is still treated as a DeepSeek route by the shared predicate, the same convention the peak/valley row already used.

## Testing

`session-cost-settings.client.spec.tsx` gains cases: the official column stays listed and a directory model sharing its id appears as its own editable, provider-prefixed entry; the same model id under two providers lists each under its own provider and saves per-provider keys; a legacy bare-model price migrates to every serving provider. `session-cost-row.client.spec.tsx` gains a case: a session model served by the custom route opens on the editable entry. `browser-plugin.client.spec.ts` gains cases: `catalogModelIds()` keeps both the official-route and the custom-provider entries for one id, and the union is seeded from `llm.models` so a newly added provider is listable without any session directory. Full suites pass: ui-conversation 621 tests, ui-model-selection 22 tests (both package typechecks clean).
