# Agent Note: Composer resting rim light and wallpaper seat solidity

Status: implemented

English | [中文](2026-09-04-composer-resting-rim-light-and-seat-solidity.zh.md)

## Problem

In wallpaper mode the composer capsule read as a half-lit shape. The card paints no self-owned border light: its contour is the 0.5px elevation hairline (`--dsw-elevation-stroke-color` → `--dsw-alias-border-l2`) drawn by `--dsw-elevation-soft` over a translucent glass fill (`--dsw-specific-input-major`). With the wallpaper on, that hairline is only visible where the dimmed wallpaper behind is bright, so the capsule lit up along the wallpaper's bright bands — typically the top edge, where a light-haired illustration ran behind the card — and went dark before the corners. Perceived result: "the glow doesn't cover the four corners", even though nothing owned that glow. In the same mode the composer seat painted a 55%-solid wallpaper-colored band behind the input card and the stats strip, which read as a heavy cast shadow under the box.

## Decision

**The resting capsule carries a rim light of its own, and no outset shadow.** `InputBar`'s `.card` now draws `inset 0 0 12px 1px rgba(255, 255, 255, 0.25), var(--dsw-elevation-stroke)` — the rim plus the 0.5px hairline only; `--dsw-elevation-soft` stays off the input bar entirely. An inset shadow follows `border-radius`, so one declaration wraps all four edges and the four 22px corner arcs uniformly at a strength that reads over any wallpaper, independent of what the glass shows through. White-on-white keeps the light theme unchanged without a theme branch (the design language forbids those in functional CSS). The send/think beam still paints above it inside the card, so the running state keeps its own, much stronger layer.

**The wallpaper seat band is removed.** Both `html[data-dsh-wallpaper]` seat-fill rules and the `--dsh-composer-seat-wallpaper-solidity` dial are deleted; the composer seat paints no fill under any wallpaper mode, so the input card and the stats strip sit directly on the wallpaper. The pinning spec now asserts the absence instead of the old gradient.

The design language (docs/design-language.md / design-language.en.md) pins the new rim value as the resting contour contract, drops the composer from rule 12's shadow tiers, and records the no-seat-band rule.

## Alternatives considered

**Make the running beam's inner mist hug the whole perimeter.** Rejected for this ask: the complaint was about the resting capsule, and the shipped beam stroke already covers the corner arcs as its window passes (verified headless at eight fixed angles — every corner lit with saturated color when traversed). A ring-wash rewrite of `beamInner` would not have changed the idle look at all.

**A gradient ring overlay element.** Rejected: an inset shadow reaches the same result in one declaration with no new element, no mask composite, and native corner tracking.

**Theme-branch the light off in light mode.** Rejected — white-on-white is naturally invisible; a branch would violate the "theme happens only in the theme sheet" rule.

**Lower the elevation-soft alphas.** Superseded by the decision: after the rim reached a clearly visible strength the outset layers were removed from the card outright (they were imperceptible at 0.02 in dark theme anyway); elevation-soft remains for menus, dialogs, and floating cards.

## Consequences

The resting capsule now shows a continuous, clearly visible contour in dark theme over any wallpaper; the perceived glow no longer depends on the wallpaper's bright regions. Headless verification at the user's glass opacity (70%) measured a uniform ≈+28-luminance ring on all four edges and corner arcs at 0.25 (the earlier 0.12 was a faint +14 the user could not see), with the interior untouched and no bloom. Light theme renders unchanged. With the seat band gone, the stats strip sits directly on the wallpaper — caption contrast over busy wallpapers is now the wallpaper's own concern, accepted by product. Future changes to either decision are design-language changes first. Deployment note, recorded because it shaped verification: client bundles are served `Cache-Control: immutable` under URLs that do not change when a rebuilt `lib/client.js` changes, so a rebuild reaches the browser only after the Electron `Cache` / `Code Cache` directories are cleared — a rebuild plus an app restart alone is not enough.

## Testing

The seat pinning spec (`composer-seat-wallpaper.client.spec.ts`) is rewritten to pin the absence — no seat fill under any wallpaper mode and no `--dsh-composer-seat-wallpaper-solidity` dial — and no ui-conversation spec pins the card's box-shadow. The full focused vendor suite passes: `NODE_ENV=test pnpm exec vitest run packages/client/ui-conversation/tests --testTimeout=30000` → 47 files / 479 tests green. The rebuilt served `lib/client.js` carries the new declarations (`box-shadow:inset 0 0 12px 1px #ffffff40, var(--dsw-elevation-stroke)`), and the change was verified end-to-end on the running desktop only after clearing the Electron `Cache` / `Code Cache` directories — per the immutable-cache note above.
