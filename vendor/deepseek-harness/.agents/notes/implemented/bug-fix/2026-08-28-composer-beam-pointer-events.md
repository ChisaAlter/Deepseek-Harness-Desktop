# Agent Note: Composer thinking beam must not capture toolbar clicks

Status: implemented

English | [中文](2026-08-28-composer-beam-pointer-events.zh.md)

## Problem

While a turn is sending, thinking, or streaming, InputBar paints a traveling border beam on the composer card (`data-beam`, default `composerBeam` on). The three decorative spans are `position: absolute; inset: 0` with positive `z-index`, so they cover the draft and the bottom chip row. Each span sets `pointer-events: none`, but `.beamBloom` also applies `filter: blur(...)`. Chromium compositor hit-testing does not honor `pointer-events: none` on that filtered element, so clicks on `+`, the access chip, the model seat, and the draft miss the controls until the turn ends.

The machine already leaves those controls unlocked while `running` is true; the failure is hit-testing, not `disabled`.

## Decision

The three beam spans sit inside one unfiltered `.beamLayer` sibling (`data-composer-beam`) that owns `pointer-events: none`, `overflow: hidden`, and `z-index: 0`. Draft, attachments, and the toolbar row sit in `.cardBody` at `z-index: 1`. Overlay menus and resize handles stay outside that body so their existing stacking (`overlayAnchor` z-index 5, handles z-index 4) is unchanged. Reduced-motion still hides the beam layer. Clipping the bloom's `filter: blur(...)` overflow keeps the stats dock under the card from being painted over while the filament is live.

## Alternatives considered

**Keep `pointer-events: none` only on the three spans.** Rejected: that is the arrangement that fails under Chromium when `.beamBloom` is filtered.

**Drop the beam while thinking.** Rejected: the Interface Settings switch already opts the filament out; the default on-state must remain clickable.

**Raise only `.row` above the beam.** Rejected: the draft, attachment rail, and edit banner share the same card and would stay under a compositor-intercepting bloom.

## Consequences

The send/think filament still paints on the card edge. Inner glow that overlapped the opaque draft is now behind `.cardBody`; the 1.5px border stroke remains visible around the capsule. Toolbar chips, the draft, and Stop stay reachable for the whole running turn. The stats dock keeps its own layout box instead of disappearing under bloom overflow.

## Testing

`input-bar.client.spec.tsx` mounts a running bar with the beam on and asserts `[data-composer-beam]` does not contain the command or access chips, those chips stay enabled, and the command launcher still fires. `input-bar-beam.client.spec.ts` pins `.beamLayer` `pointer-events: none` / `overflow: hidden` / `z-index: 0` and `.cardBody` `z-index: 1` in the stylesheet.

## Related

[Interface Settings chrome visibility](../feature/2026-08-19-interface-settings-chrome-visibility.md) owns the `composerBeam` preference that turns the filament on. [Stats dock stays while thinking](2026-08-28-stats-line-running-gap.md) owns the row that the clipped bloom must not cover.
