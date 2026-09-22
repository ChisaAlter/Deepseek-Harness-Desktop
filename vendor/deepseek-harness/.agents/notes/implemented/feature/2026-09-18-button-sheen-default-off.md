# Agent Note: Button sheen defaults to off

Status: implemented

English | [中文](2026-09-18-button-sheen-default-off.zh.md)

## Problem

The [hover-sheen note](2026-09-13-button-metallic-paint-hover.md) shipped `metallicPaintEnabled` with schema default `true`, keeping the sheen always-on for every user who never opened Appearance. The user now explicitly asks for the effect to default off — an optional flourish should be opt-in, not imposed.

## Decision

The factory default flips to `false`: `DEFAULT_THEME_SETTINGS.metallicPaintEnabled` and the zod schema `.default()` move together, and `applyAppearanceDocumentExtras`'s absent-flag semantics change from `!== false` (absent means on) to `=== true` (absent means off) so partial-extras call sites agree with the new default. Persisted `true` values keep working — only users who never toggled lose the sheen, which is exactly what a new default means. The switch row, write chain, attribute gate, and sheen visuals are unchanged.

## Alternatives considered

- **Keep `!== false` (absent means on)** — rejected: contradicts schema default `false`; boot-time partial extras would paint the sheen and then get corrected.
- **Default on, rely on the existing switch** — rejected: the user explicitly asked for default-off; the earlier "don't withdraw a shipped visual" concern is moot once the requester wants it withdrawn.

## Consequences

Factory installs and untouched settings show no sheen; the Appearance switch remains the only control. Tests asserting the shipped default or absent-flag semantics flipped with the code. The prior note keeps describing the mechanism; its stale `default true` fact is corrected in place and cross-links here.
