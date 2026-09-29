# Decision: Hidden presets stay unselectable under explicit registration

Status: implemented

[中文](2026-09-29-hidden-agent-preset-regression.md) | English

## Problem

The Whale Assistant preset is meant to be an internal preset used by the plugin and IM by id, but it reappeared in the mode picker. The earlier fix wrote `hidden: true` into `.agent-presets/whale-girl/preset.yml`; the Harness at that time scanned preset directories and filtered the flag before emitting the roster. In 0.1.7 the preset moved to explicit `agentPresets.register()`, and the migration carried only `id/name/description/order/plugins`. `hidden` was absent from the `PresetDefinition` type and never passed through `list()`/`remoteExportList()`, so the file kept the marker while the picker admitted the preset unconditionally. Existing tests only covered registration and session creation; none asserted that an internal preset must never enter the roster, so the regression passed silently.

## Decision

- Restore `hidden?: boolean` in the vendored `agent-preset-registry` public preset contract: `PresetDefinition`, `AgentPreset`, `list()`, and `resolve()` all retain the fact.
- `remoteExportList()` filters healthy hidden presets; a broken hidden preset stays in the roster so its diagnostic and deletion path remain visible. `resolve()` by id, `mount()`, session creation, and IM binding are unchanged.
- `whalePresetDefinition` declares `hidden: true` explicitly, while `presets/whale-girl/preset.yml` keeps the marker as a compatibility and readability fact.
- Regression is three-layered: registry tests assert that a healthy hidden preset is absent from the roster while still resolvable/mountable by id, and that a broken hidden preset remains visible; the desktop whale test asserts both the definition and source file declare hidden; `harness-desktop-forks` keeps the registry field, filter, and test alive so the next `sync:harness` cannot merge the capability away.

## Alternatives considered

- **Filter `whale-girl` by id in the `ui-agent-preset` client** — rejected: that is a product-layer patch that recurs when upstream rewrites the picker or adds another client; hidden is a generic registry semantic for internal presets and belongs at the host roster boundary only.
- **Keep `hidden` only in `preset.yml` and read/filter it in the plugin** — rejected: explicit registration no longer scans that file, and reimplementing metadata reads in the plugin splits one fact across two places while other roster consumers can still miss the filter.
- **Delete `preset.yml` or remove the preset from the registry** — rejected: mounting by id, IM default binding, and recorded sessions still depend on the registration; hiding, not removal, is the right boundary.
- **Add only a desktop string assertion without a registry behavior test** — rejected: a string assertion cannot prove the roster actually filters, nor cover the boundary where a broken hidden preset must remain visible.

## Consequences

- Mode pickers and settings rosters no longer show a healthy `whale-girl`, while her resident session, pet entry, IM binding, and `agentPreset:'whale-girl'` creation keep working.
- A hidden preset that cannot load still appears with a `broken` diagnostic, so users can locate the bad directory from the UI.
- The vendored registry maintains one public field and two filtering tests; the cost buys a shared hidden semantic for every plugin-owned preset.
- `harness-desktop-forks` fails directly if an upstream merge removes the `hidden` field, filter, or regression test, so recurrence no longer depends on a user report.
