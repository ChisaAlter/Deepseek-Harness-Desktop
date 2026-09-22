# Decision: Button hover sheen defaults to off

Status: implemented

[中文](2026-09-18-metallic-paint-default-off.md) | English

## Problem

[2026-09-17-metallic-paint-toggle](2026-09-17-metallic-paint-toggle.en.md) shipped the "Button sheen" switch with schema default `true` and explicitly rejected default-off (rationale: the sheen was the accepted default visual, so defaulting off would withdraw it from existing users). The user now explicitly asks for the effect to default off — the earlier rejection rationale is overturned by the requester themselves: an optional flourish should not be imposed out of the box; whoever wants it flips one switch.

## Decision

`metallicPaintEnabled` factory default flips to `false`: `theme-settings.ts` `DEFAULT_THEME_SETTINGS` and the zod schema `.default()` move together; `applyAppearanceDocumentExtras`'s absent-flag semantics change from `!== false` (absent means on) to `=== true` (absent means off), matching the new default. Existing users who explicitly enabled the switch keep their persisted `true`; users who never touched it lose the sheen on upgrade — that is exactly what the new default means. Switch placement, persistence chain, the `data-dsh-metallic-paint` gate, and the sheen visuals are unchanged.

## Alternatives considered

- **Keep default on, switch only** — rejected: the user explicitly asked for default-off; the earlier "don't withdraw from existing users" concern no longer applies once the original requester wants it reversed.
- **Keep `!== false` absent semantics (absent means on)** — rejected: self-contradictory with schema default `false` — call sites without the field would render the opposite of the default, and boot-time partial extras would flash the sheen before being corrected.

## Consequences

The two `metallic-paint.css` rules miss when the attribute is absent, so factory installs and users who never toggled see no sheen; switch copy, `MetallicPaintRow`, and the write chain are unchanged. The [metallic-paint](../../../features/metallic-paint.md) feature card's default-`true` invariant becomes `false` and cross-links this record; the previous record ([2026-09-17-metallic-paint-toggle](2026-09-17-metallic-paint-toggle.en.md)) stays as history, its "default off rejected" alternative superseded by this record.
