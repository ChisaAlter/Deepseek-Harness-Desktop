# Decision: Align boot window controls with the main window

Status: implemented

[中文](2026-09-29-boot-window-controls.md) | English

## Problem

Boot inherits shared 30px controls with a 999px radius, while the main window and launcher use 32px squares with an 8px radius. Shape and position change when entering the workspace. A real Electron probe reproduces this in light and dark modes.

## Decision

Scope boot overrides to `data-boot-theme`, matching main-window size, radius, zero gap and 12px 8px 4px padding while outranking the shared stylesheet loaded afterward. Preserve shared icons, interaction colors, no-drag and action bindings. The [sea-horizon scene](../product/2026-09-26-boot-sea-horizon-scene.en.md) remains unchanged; its canvas exception does not extend to control geometry.

## Alternatives considered

Changing shared defaults and removing launcher overrides would reduce duplication but affect pages outside this request. This local repair restores existing main-window styling without changing other entry points.

## Consequences

Boot gains a small geometry override. Static regression checks selector specificity and dimensions; an Electron light/dark probe checks computed styles and all three hit targets. Installer builds remain paused at the user's request.
