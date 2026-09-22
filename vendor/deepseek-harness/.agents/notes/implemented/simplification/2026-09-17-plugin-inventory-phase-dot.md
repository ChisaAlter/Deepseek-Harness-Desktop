# Agent Note: The plugin inventory reserves its status dot for phases the tag cannot state

Status: implemented

English | [中文](2026-09-17-plugin-inventory-phase-dot.zh.md)

## Problem

The Settings plugin list marks every Loader entry with an enablement tag (`已启用`, `已停用`, `条件启用`, `预设中启用`, `启动失败`). It also drew a colored root-fiber status dot on enabled rows whose fiber was live. For the common `active` phase the dot and the tag stated the same thing twice on one collapsed card, while `pending`, `loading` and `unloading` — the phases the tag has no words for — were where the dot carried its own information.

## Decision

`PluginInventorySettingsTab` renders the status dot only for `pending`, `loading` and `unloading`. `active` and `failed` render no dot: a settled enabled row shows its enablement tag alone, and a failed row has the failure tag and card treatment. `PHASE_DOT_STATES` lists exactly the dotted phases, and `showsPhaseDot` narrows a phase to that union.

Row enablement, tag tones, grouping, search and list behavior are unchanged, as are the Loader lifecycle and persistence. The expanded card still lists the phase under 运行状态 / Status, so the runtime phase stays readable without the collapsed dot.

## Alternatives considered

**Remove the dot for every phase.** Simpler to state, but it drops the only collapsed-state signal that a plugin is still loading or unloading — the one state the tag cannot express.

**Keep the `active` dot on preset rows only.** The preset group is where the duplication was first noticed, but the global group renders the same tag-and-dot pair. A per-group exception would make one rendering rule depend on which group a row sits in, and would leave the duplicate in the global group.

**Fold the phase into the enablement tag.** The tag reports the config fact the Host publishes as `enabled`; adding a runtime phase would make one control carry two lifecycles with different owners.

## Consequences

- A collapsed card no longer shows that an enabled entry's fiber is currently `active`. A reader who needs the phase expands the row, whose Status fact keeps it. That is the information the change deliberately gives up.
- Rows mid-transition keep their dot, its animation and its `role="img"` name, so the accessible name still says `等待依赖`, `加载中` or `卸载中`.
- Known gap, pre-existing and unchanged: the dot is gated on `row.enabled`, so a row a user just disabled while its fiber is still `unloading` shows `已停用` without a dot.

## Testing

The package spec pins the rule in both scopes: `loading` and `pending` (global) and `unloading` (preset) keep a dot, while `active`, `failed` and a row without a live fiber render none. `apps/web/tests/settings-chrome.e2e.ts` asserts the assembled global group contains enabled rows and no `role="img"` element named `运行中`.

The remaining dots' palette, halo and animation, and the tag capsule itself, stay owned by [the shared client control decision](../architecture/2026-09-05-shared-client-control-primitives.md).
