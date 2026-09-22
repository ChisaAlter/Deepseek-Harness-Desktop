# Agent Note: Composer thinking beam must not capture toolbar clicks

Status: implemented

English | [中文](2026-08-28-composer-beam-pointer-events.zh.md)

## Problem

While a turn is sending, thinking, or streaming, InputBar paints a traveling border beam on the composer card (`data-beam`, default `composerBeam` on). The three decorative spans are `position: absolute; inset: 0` with positive `z-index`, so they cover the draft and the bottom chip row. Each span sets `pointer-events: none`, but `.beamBloom` also applies `filter: blur(...)`. Chromium compositor hit-testing does not honor `pointer-events: none` on that filtered element, so clicks on `+`, the access chip, the model seat, and the draft miss the controls until the turn ends.

The machine already leaves those controls unlocked while `running` is true; the failure is hit-testing, not `disabled`.

## Decision

The three beam spans sit inside one unfiltered `.beamLayer` sibling (`data-composer-beam`) that owns `pointer-events: none`, `overflow: hidden`, and `z-index: 0`. The layer expands 4px beyond the card with a 26px radius, still inside the 6px composer-stack gap. Stroke and inner light inset 4px back to the 22px card edge. Following the Libraries.dev Rotate hierarchy, the 2px stroke runs at 0.6 opacity behind a rotating conic intensity window and keeps only `border-radius` plus the ring cutout, without a duplicate `clip-path`; the inner light uses a same-direction dual-conic window. The bloom separates its masked 1.5px source into `::before`; the outer span applies `blur(8px)` at 0.36 opacity. The resting card rim supplies the continuously defined capsule while the colorful beam has a transparent trail and sweeps each corner. Draft, attachments, and the toolbar row sit in `.cardBody` at `z-index: 1`. Overlay menus and resize handles stay outside that body so their existing stacking (`overlayAnchor` z-index 5, handles z-index 4) is unchanged. Reduced motion hides the complete beam layer.

The card and all radius-bearing beam layers explicitly use `corner-shape: round` so the global superellipse cannot diverge from the circular inner clip. The 2px stroke preserves visible corner coverage at 100% display scaling; bloom keeps its 1.5px source. The desktop pixel probe loads the real corner and elevation sheets, samples native pixels using the capture scale, and checks the resting rim as well as both hue extrema of the rotating stroke. Earlier probes omitted the global corner sheet and resolved the elevation token at the wrong scope, so they did not represent the installed surface.

## Alternatives considered

**Keep `pointer-events: none` only on the three spans.** Rejected: that is the arrangement that fails under Chromium when `.beamBloom` is filtered.

**Drop the beam while thinking.** Rejected: the Interface Settings switch already opts the filament out; the default on-state must remain clickable.

**Raise only `.row` above the beam.** Rejected: the draft, attachment rail, and edit banner share the same card and would stay under a compositor-intercepting bloom.

## Consequences

The send/think filament and inner wash travel around the card edge instead of reading as an equally bright neon ring. The resting rim keeps the capsule defined while the 2px colorful peak crosses each corner cleanly. Toolbar chips, the draft, and Stop stay reachable for the whole running turn. The bounded 4px halo cannot reach the dock across the 6px stack gap.

## Testing

`input-bar.client.spec.tsx` mounts a running bar with the beam on and asserts `[data-composer-beam]` does not contain the command or access chips, those chips stay enabled, and the command launcher still fires. `input-bar-beam.client.spec.ts` pins the 4px clip shell, card-edge insets, split `blur(8px)` bloom source, 2px rotating stroke window, dual-conic inner window, pointer ownership, and body stacking. A Chromium pixel probe uses the production 654×193 translucent-card geometry and freezes one rotation in 15-degree steps while preserving the running brightness filter. Every corner must reach at least 90% coverage at a 32-channel pixel delta when the peak crosses it, and every corner must also fall below 25% in a dark frame; the exterior bloom remains separately present.

## Related

[Interface Settings chrome visibility](../feature/2026-08-19-interface-settings-chrome-visibility.md) owns the `composerBeam` preference that turns the filament on. [Stats dock stays while thinking](2026-08-28-stats-line-running-gap.md) owns the row that the clipped bloom must not cover.
