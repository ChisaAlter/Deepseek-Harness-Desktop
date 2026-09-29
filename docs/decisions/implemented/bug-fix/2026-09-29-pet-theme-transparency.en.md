# Decision: Preserve the pet's transparent backing through theme changes

Status: implemented

[中文](2026-09-29-pet-theme-transparency.md) | English

## Problem

Selecting dark mode covers the whale pet's entire display with an opaque dark fill. Although creation specifies `transparent:true` and `backgroundColor:'#00000000'`, the pet is absent from chrome's transparent-window registry. `applyAppTheme()` traverses all windows and changes its backing to `#151517`. Page CSS remains transparent; no GPU crash is required to reproduce this.

Existing-decision audit: [window Chrome self-healing](2026-09-25-window-chrome-self-heal.en.md) addresses missing injection and maximize semantics. It partially shares the transparent-window context but does not own pet registration; its decisions remain intact. This fix preserves recreation on crashes, display changes, and resume.

## Decision

Every pet BrowserWindow is registered with the existing `markWindowTransparent` immediately after creation, including recovery recreation. Global themes continue repainting ordinary windows while the pet's native backing remains transparent. Theme dispatch, CSS, inference, and user configuration are unchanged.

## Alternatives considered

- Recreate the pet after theme changes: this restores its initial transparency but reloads the model on every switch and leaves the incorrect paint operation in place.
- Force transparent CSS: this prevents page fill contamination, but cannot repair the native backing overwritten in this reproduction.

## Consequences

The fix reuses transparency protection already used by the main window and launcher, without new configuration or listeners. Pet creation depends on chrome registration. The regression creates windows through the real manager and calls the actual `applyAppTheme()`, covering light/dark changes and recreation; before the fix it produces opaque `#151517`.
