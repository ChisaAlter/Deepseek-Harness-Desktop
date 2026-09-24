# Decision: Share canvas rules with the background effect preview

Status: implemented

[中文](2026-09-23-background-effect-preview.md) | English

## Problem

The Background Effect dialog preview was once a fixed composition of three circular gradients that read colors but ignored speed, bloom count, and shape. After the real blooms were added, the dialog still included a newly allocated parent `values` object in its draft reset dependencies. Unrelated theme publishes could overwrite freshly edited speed, count, and shape with stored values. Users could still see Orbs and could not reliably save their draft.

## Decision

The dialog draws five `[data-blob]` elements under distinct preview IDs and shares the fixed canvas geometry, shape, and animation selectors in `wallpaper.css`. The draft writes colors, speed, count, and shape directly to the preview DOM. Editing speed, count, or shape marks the scheme as Custom. The dialog initializes its draft from the latest stored values only when it reopens; parent rerenders during an open dialog preserve edits. The small preview uses a smaller blur radius while retaining the same keyframes. Save writes to Host once; Cancel discards the draft.

## Alternatives considered

- **Keep a static color only preview** — Simple, but the promised live preview would still conceal shape and count changes.
- **Duplicate shape CSS for the dialog** — It would allow independent tuning, but two copies of the four shapes and animations could drift again.
- **Sync stored values into the draft on every parent update** — It would reflect external writes but erase unsaved edits during unrelated theme updates. Save and Cancel provide explicit synchronization boundaries.

## Consequences

The preview adds five DOM elements and the same CSS selectors cover two distinct IDs. Shape rules now have one maintenance point. Focused UI tests pin draft propagation and preservation across unrelated theme publishes, and computed styles in Electron 43 confirm distinct backgrounds and animation durations for Orbs, Aurora Ribbons, Chaos, and Rays. External writes to effect fields while the dialog is open do not replace its draft until it reopens. Canvas persistence, wallpaper priority, and reduced motion retain their existing contracts.
