# Agent Note: Skills groups are multi-select with an immediate group switch

Status: implemented

English | [中文](2026-08-29-skills-groups-multi-select.zh.md)

## Problem

Skills settings attached one grouping label per skill, edited through a single-select combobox, so a skill could not belong to two groups at once. Three interactions compounded it: the group switch waited for every frontmatter write to settle before flipping, so a click had no visible response; disabling a group auto-collapsed its section, hiding the rows the user just turned off; and the picker input rendered at 163px because the Menu's `inline-flex` root span shrink-wraps inside a block container. Separately, a session whose boot failed (a corrupt session log, for example) made the whole catalog page error out with `session-not-found`.

## Decision

- **Data model.** The wire field `group?: string` becomes `groups?: readonly string[]` on `SkillInventoryEntry`, `SkillInventoryDetail`, and the create/update requests. SKILL.md keeps `metadata.group`: reading accepts a scalar label or a list and normalizes it in `normalizeMetadataGroups` (trimmed, empties dropped, deduped, order preserved); Settings writes a YAML list and an empty list clears; an omitted `groups` in `update` leaves the stored labels untouched. A hand-written scalar reads as a one-element list, so existing files lose nothing.
- **Sections.** A skill renders once per group label it carries (first-appearance order, ungrouped last); the result count stays per skill; search matches any label.
- **Editor.** `GroupTagPicker` replaces the combobox: selected labels render as removable tags, the dropdown lists catalog groups with check marks (`Menu` `selectedIds`) and stays open across toggles, typing a new label plus Enter or comma adds it, and one row clears everything. The field is wrapped in `.groupFieldShell { display: grid }`, which stretches the Menu root span and fixes the 163px → 614px input width measured with Playwright.
- **Group switch.** Clicking flips every writable row immediately (optimistic echo, no waiting for writes); each row's write still goes through `setInvocation`, and a failed write reverts that row to its previous value with the inline row error. The switch stays disabled while the batch is in flight. Disabling no longer collapses the section; expand/collapse belongs to the section header alone.
- **Catalog degradation.** When the session-scoped read fails, the client falls back to the global catalog and shows the `sessionCatalogUnavailable` notice; the error view appears only when the global read fails too. The gateway keeps its typed `session-not-found` contract — it also serves the mobile Remote, and silently degrading there would hide the session layering.

## Alternatives considered

**A new `metadata.groups` key.** Rejected: `metadata.group` is Settings-owned existing data; normalizing the scalar on read migrates every file without a rewrite pass or migration script.

**Keep updating the group switch only after the writes settle.** Rejected: one file write per row makes the click-to-feedback delay visible; optimistic echo with per-row revert keeps the server authoritative on failure.

**Fall back to the global registry inside the gateway when the Agent is missing.** Rejected: the global registry lacks the project-skill layering, so the fallback would quietly show fewer skills with no signal; `session-not-found` is a shared contract.

**Keep collapse-on-disable with the dimmed node.** Rejected: users need to see the rows they just disabled.

## Consequences

- The `ui-settings-skills` inject face and the `dsh-host-skill-inventory` wire types both carry `groups`; the Typert-generated schemas follow after a rebuild.
- Hand-edited scalar `metadata.group` files keep working; the next Settings save writes the list form.
- Client specs cover the picker, multi-section rendering, tag removal, optimistic echo and revert, no-collapse disable, and the scoped-catalog fallback; the width measurement is recorded in the desktop feature card.

Related: [Skills settings grouping and reveal action](2026-08-23-skills-settings-grouping.md) (storage key and section mechanics continue here; label cardinality, picker, and group-switch behavior are superseded by this note), [MCP and skill settings](2026-08-14-mcp-and-skill-settings.md).
