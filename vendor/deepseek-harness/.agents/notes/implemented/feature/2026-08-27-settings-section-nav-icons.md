# Agent Note: Distinct settings section navigation icons

Status: implemented

English | [中文](2026-08-27-settings-section-nav-icons.zh.md)

## Problem

The Settings sidebar identified only Models, Agent presets, and Plugins with dedicated glyphs. Every other section rendered the settings gear, so unrelated pages were visually indistinguishable and new desktop-owned sections inherited the duplicate.

## Decision

`SettingsRoot` selects one 16px `currentColor` outline component for every desktop-visible `settings.section` id:

| Section id | Icon component |
| --- | --- |
| `general` | `IconSettingsOutline16` |
| `interface` | `IconPanelLeftOutline16` |
| `appearance` | `IconLightOutline16` |
| `models` | `IconDataOutline16` |
| `agent-presets` | `IconAgentPresetOutline16` |
| `plugins` | `IconPersonalizationOutline16` |
| `skills` | `IconSkillOutline16` |
| `mcp` | `IconServerOutline16` |
| `market` | `IconBrowseOutline16` |
| `remote` | `IconDeviceOutline16` |
| `about` | `IconInfoOutline16` |
| `usage-stats` | `IconChartOutline16` |

The icon table stays in the Settings shell because section registrations carry identity, order, and copy but no presentation metadata. Unknown section ids retain the settings gear fallback. `ui-primitives` supplies the server, device, information, and chart glyphs that had no suitable 16px sibling. Those four use stroke-expanded `currentColor` paths with rounded, official-family optical weight rather than CSS-like thin rectangles, drawn as native 16×16 positive-coordinate path data with no `transform` attributes.

## Alternatives considered

**Keep the shared gear for sections without a dedicated primitive.** Rejected because the repeated glyph removes the sidebar's visual section cues.

**Scale 14px API or plugin glyphs to 16px.** Rejected because the navigation uses the native 16px outline family and scaling changes its optical weight.

**Add icon metadata to `settings.section` registrations.** Rejected because section identity already gives the shell a stable mapping, while presentation metadata would widen every registration and the slot API.

## Consequences

Known Settings rows have distinct monochrome glyphs in both themes, and future unknown rows remain renderable through the gear fallback. The Settings component test pins the complete known-id set and compares rendered SVG geometry; the primitives test pins the expanded public icon set, its `currentColor` rule, and the transform-free native geometry of the four navigation glyphs.
