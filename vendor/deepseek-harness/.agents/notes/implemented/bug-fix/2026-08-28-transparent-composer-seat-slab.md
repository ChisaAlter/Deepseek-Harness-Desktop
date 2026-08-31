# Agent Note: Transparent theme keeps the composer seat clear

Status: implemented

English | [中文](2026-08-28-transparent-composer-seat-slab.zh.md)

## Problem

With wallpaper on, the sticky composer seat paints a 36px fade into a solid canvas color (`--dsw-static-neutral-bluish-00` light, `-950` dark) so transcript lines do not show through the input card. That rule keyed only on `html[data-dsh-wallpaper]`. Transparent theme also sets that attribute, so the dark half laid a black rectangle over the lower conversation — the seat, stats dock, and the wallpaper behind them — while the rest of the chrome correctly went to 0% fill.

## Decision

Gate the opaque fade with `:not([data-dsh-transparent])`. Glass wallpaper still gets the solid seat. Transparent theme falls through to the mixed `--dsw-alias-bg-base` gradient, which is already 0% solidity.

## Alternatives considered

**Override from `wallpaper.css` with a later `html[data-dsh-transparent] [data-composer-seat]` rule.** Rejected: the opaque colors live on the seat, and winning specificity against the CSS-module classes is brittle; the exception belongs next to the rule it carves.

**Always use mixed `bg-base` for the seat, even under glass wallpaper.** Rejected: that was the original bug the static-color override exists to fix — mixed `bg-base` is itself translucent under glass, so the fade vanishes and the transcript collides with the card.

## Consequences

Transparent theme no longer paints a black slab under the composer. Ordinary wallpaper glass is unchanged. The input card still uses its own surface token.

## Testing

`composer-seat-wallpaper.client.spec.ts` asserts the unguarded wallpaper selectors are gone and the `:not([data-dsh-transparent])` pair still names the static canvas colors.

## Related

[Transparent theme](../feature/2026-08-14-theme-family-appearance-system.md) owns wallpaper glass mixing. Desktop card: `docs/features/transparent-theme.md`.
