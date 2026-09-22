# Agent Note: Appearance pointer effects (pixel trail / fluid splash)

Status: implemented

English | [中文](2026-09-13-cursor-pointer-effects.zh.md)

## Problem

Appearance gains a pointer-driven decoration layer ported from the ayase motion catalog — `pixel-trail` (ReactBits `PixelTrail`) and `splash-cursor` (ReactBits `SplashCursor`) — selectable behind one switch, with preset schemes and custom colors / speed / size like the background and typing effects. The layer must paint above the whole UI without intercepting input, fail closed where Canvas 2D / WebGL is unavailable, and never run under `prefers-reduced-motion`.

## Decision

`packages/client/ui-theme` owns the feature end to end. `cursor-fx.ts` mounts a singleton fullscreen layer `#dsh-cursor-fx` (`position: fixed`, `pointer-events: none`, `z-index 9999`) on every `applyAppearanceDocumentExtras` publish: swapping effect or the enabled flag rebuilds the canvas while colors / speed / size flow through the live `update` channel. `pixel-trail` is a 2D-canvas grid whose cells interpolate-stamp along pointer motion and fade out — the equivalent port of the three.js original without adding that dependency. `cursor-fluid.ts` is the standalone WebGL Navier-Stokes dye sim; its mount returns `null` without a usable GL context so `applyCursorFxLayer` leaves no DOM residue. Both engines idle out 4s after the last input and pause on `document.hidden`. Persistence is six Host `ui-theme` fields (`cursorEffectEnabled`, `cursorEffect`, `cursorEffectColors`, `cursorEffectSpeed`, `cursorEffectSize`, `cursorEffectPreset`) written only through `ThemeRuntime.setCursorFx`; the row Switch flips enabled alone so the chosen scheme survives while off. `CursorEffectRow` is the collapsed Appearance row (title + description + gear + Switch); the gear opens a `Modal` with kind cards, a live canvas preview running the real engines, preset scheme cards that write the whole bundle, always-visible custom controls, and Reset / Cancel / Save. The dialog remounts per open so its draft initializes from the stored values (a theme publish mid-edit can never snap the scheme back), and the preview canvas is keyed by `draft.effect` — a canvas element bound to `2d` can never hand out a WebGL context and vice versa, so switching kinds requires a fresh element. Save writes the whole draft plus `cursorEffectEnabled: true`, so saving applies the previewed scheme to the page.

## Alternatives considered

**Port `PixelTrail` through three.js / react-three-fiber.** Rejected because pulling a 3D stack into ui-theme for a pointer garnish is disproportionate; the 2D-canvas grid reproduces the reference look at a fraction of the weight.

**One effect dropdown instead of kind cards.** Rejected in favor of the same card-grid the scheme presets use — two choices stay visible at once and each swatch hints at its look under the draft palette.

**Throttle or skip the sim while settings dialogs are open.** Deferred: the shared engine already idles out after 4s of no input and the modal preview is itself a mounted instance, so the cost model stays uniform.

## Consequences

Pointer input never reaches the layer (`pointer-events: none`), and window-level `pointermove` / `pointerdown` listeners leave with it on teardown. An empty palette resolves `--dsw-alias-brand-primary` through `var()` hops, so `default` follows light/dark themes; no color literal or theme branch exists outside preset data. `cursor-fluid.ts` carries a coverage-exclusion entry: jsdom exposes no WebGL context, so the jsdom lane proves the fail-closed mount path and the sim's visual behavior is manual acceptance. Reduced-motion users never mount the layer.

## Testing

`cursor-fx.client.spec.ts` (jsdom) covers clamps, palette sanitization, accent `var()` resolution, layer lifecycle, trail interpolation, cell expiry and the cell cap, engine update / dispose idempotence, and no-residue failure paths; `cursor-fx-offdom.client.spec.ts` covers the documentless branches. `appearance-section.client.spec.tsx` covers the row switch, dialog save / reset / cancel, save-enables, custom-marking, preview strokes, draft survival across a mid-edit publish, reopen restoring stored values on a fresh canvas, and the accent-chained color fallback. `theme.client.spec.ts`, `settings-store.client.spec.ts`, `appearance-apply.client.spec.ts`, and `boot-theme.client.spec.ts` cover persistence wiring. Visual acceptance is manual: switch the row on, stroke the pointer across the UI in both effects, presets, and custom values.
