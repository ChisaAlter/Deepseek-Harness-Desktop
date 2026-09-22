# Agent Note: Button metallic-paint hover sheen

Status: implemented

English | [中文](2026-09-13-button-metallic-paint-hover.zh.md)

## Problem

The product adds a metallic-paint gloss to every button on hover, ported from the ayase motion catalog's `metallic-paint` entry (React Bits `MetallicPaint`, whose site demo is a CSS gradient sweep rather than the upstream WebGL shader). The sheen must layer on top of each variant's existing hover fill without replacing it, and must reach every button without touching per-component styles.

## Decision

A new global sheet `packages/client/ui-theme/src/styles/metallic-paint.css`, mounted by `installThemeStyles`, paints a translucent `linear-gradient` (115deg, `background-size: 320%`) as the hovered button's own `background-image` and sweeps `background-position` on a 4.5s ease-in-out loop. Bands come only from `color-mix` on label aliases — bright bands take `--dsw-alias-label-primary-foreground` (the on-primary text color, so it contrasts every fill and keeps glyphs like the composer send arrow readable), shades take `--dsw-alias-label-primary`, and the mid tone takes `--dsw-alias-label-secondary` — so the sheet carries no color literals and no theme branch while the sheen inverts with the theme's light/dark half and tints with custom themes. `prefers-reduced-motion` stops the animation and keeps the static sheen.

Painting the image on the button itself clips it to the control's `border-radius` (including the global corner-shape) and keeps each variant's hover `background-color` visible underneath, because the cascade resolves `background-image` and `background-color` as separate longhands and `html[data-dsh-metallic-paint] button:not(:disabled):not([aria-disabled='true']):hover` out-specifies single-class module hover rules. Scope stays native `<button>` in the main Web UI document: `role='button'` rows, `<select>`/`<input>`, the boot page, launcher, wallpaper gallery window, and mobile/web are excluded.

The Appearance "Button sheen" switch persists `metallicPaintEnabled` in the `ui-theme` settings namespace (default `false` since [2026-09-18-button-sheen-default-off](2026-09-18-button-sheen-default-off.md) — the sheen is opt-in); `applyAppearanceDocumentExtras` mirrors the flag into the `data-dsh-metallic-paint` attribute on the document root that both rules key on, so disabling makes the rules stop matching and leaves only each variant's own hover fill. The sheet stays mounted either way — the switch flips the attribute, not the stylesheet.

## Alternatives considered

**A `::after` overlay animating `transform`.** Rejected because covering the control needs `position: relative` and corner clipping (`overflow` or `border-radius: inherit`) on every button; re-anchoring absolutely positioned descendants and colliding with existing `::after` styles were unbounded risks for a garnish.

**Port the WebGL shader.** Rejected because a per-button canvas/shader is disproportionate for a hover garnish, and the reference site's own demo of this component is the CSS gradient version.

**Extend `role='button'` and form controls.** Deferred: disclosure/tool rows are full-width surfaces with their own running-state sweeps, and widening the selector is a product decision the feature card reserves.

## Consequences

Every native button gains the sheen with no component edits. Residual edges accepted: a button whose own `background-image` or `animation` is essential would lose it while hovered — the current stylesheets carry neither on button elements. `background-position` is a paint property rather than transform; the cost is a small repaint during hover only, registered in motion.md's indicator family. Reduced-motion users keep the static gloss.

## Testing

`client-styles.client.spec.ts` asserts the sheet mounts in dependency order through `installThemeStyles`; the appearance-apply, runtime, settings-store, and Appearance-section specs pin the attribute toggle and the persisted flag. Visual acceptance is manual: hover primary/ghost/outline/icon buttons in light and dark themes.
