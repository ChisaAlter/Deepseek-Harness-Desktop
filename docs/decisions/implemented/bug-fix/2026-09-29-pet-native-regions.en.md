# Decision: Bound the pet native region to painted surfaces

Status: implemented

[中文](2026-09-29-pet-native-regions.md) | English

## Problem

The pet uses a transparent, topmost window covering one display. Making it interactive enables input over the entire window; clicks intended for underlying apps can be swallowed before a busy renderer processes the exit. The hit test also encloses the character, chat card and menus in one bounding rectangle, making transparent gaps interactive. A regression test reproduced the latter.

Existing decision audit: [Painted geometry](2026-09-24-whale-hover-bubble-geometry.en.md) partially overlaps; its body transforms, bubble anchors and drag guards remain. This change adds a native region boundary and disjoint hit testing. [Theme backing transparency](2026-09-29-pet-theme-transparency.en.md) addresses opaque fills, a separate failure path, and remains. No equivalent native-region decision exists in proposed/rejected.

## Decision

On Windows/Linux, report separate painted rectangles through the existing sender-authorized interaction IPC. The main process validates finite numbers, caps their count, rounds and clips to window bounds, then applies `setShape`. Drawing coordinates still cover one display to avoid reintroducing flicker from moving a transparent window every frame. Regions include the character, feeding, particles, bubbles, status card, chat card and menu shadow; unchanged geometry is neither resent nor reapplied. An initially empty region uses one zero-area rectangle, never `setShape([])`, which restores the entire window. macOS does not call this API.

Hit testing and exit hysteresis use the minimum distance to each interactive surface instead of filling transparent gaps. Showing and restoring use `showInactive`; only explicitly opening chat requests keyboard focus. Existing pet floating behavior, transparent theme protection and display coordinates remain.

## Alternatives considered

- Shorten cursor polling only: simple, but the full display still receives input until a busy renderer exits, and the oversized hit union remains.
- Move a small window every frame: naturally bounds the native frame, but reintroduces this project's documented Windows layered-window movement flicker and requires rewriting drag and cross-display coordinates.
- Disable background throttling globally: might help some paused pages, but leaves the transparent input shield intact and increases continuous rendering costs throughout the app.

## Consequences

Transparent gaps no longer belong to the pet's native window, allowing clicks into underlying apps even when interaction exit lags. Changed frames transmit a few rectangles and update the native region; future painting sources must register their ink bounds to avoid clipping. macOS still relies on the click-through switch and is not certified for native-region isolation. This work also does not establish that every main-page loading problem has this cause.

Focused regressions cover disjoint surfaces, region validation/deduplication, card closure and inactive presentation. The Windows script and evidence are in [Window region QA](../../../qa/results/2026-09-29-pet-window-regions/verify.cjs), using the actual manager, THA4 renderer and Win32 region queries.
