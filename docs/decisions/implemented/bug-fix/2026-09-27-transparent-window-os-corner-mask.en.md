# Decision: Transparent self-drawn silhouette windows disable the OS corner mask

Status: implemented

[中文](2026-09-27-transparent-window-os-corner-mask.md) | English

> Windows main/launcher transparency and outer-silhouette requirements are superseded by [native window motion](2026-09-29-native-window-motion.en.md); non-Windows, inner content corners and unrelated decisions remain valid.

## Problem

After the silhouette radius returned to 20px, the window corners showed visible stair-stepping. The page clip is not the root cause: `windowChrome` had always defaulted `roundedCorners: true`, so Windows 11's DWM still applies its ~8px corner mask to transparent windows — the page paints transparency outside a larger arc and DWM hard-clips again at its own radius, and the meeting of the two curves reads as jagged steps (the mask is not alpha-blended on transparent windows). At 10px the two curves nearly coincided and hid the defect; 20px exposed it. In fact the mask had been biting into the silhouette all along — the 10px contract only ever showed ~8px, which contributed to the "corners too small" feedback.

## Decision

Every transparent window that draws its own silhouette or must reach the window edge sets `roundedCorners: false`: `windowChrome` disables it automatically for `transparent` overrides (covering both main and launcher shell windows — the slim launcher reuses the same `window.js` path) while opaque chrome windows keep the OS rounding default; the update-overlay dialog and the live2d fullscreen pet layer opt out explicitly. The welcome window fills itself with opaque content and draws no silhouette — its corners come from the OS, so it stays unchanged. `shell-silhouette-radius.test.js` gains a pin over the three opt-out sites (chrome / update-overlay / live2d).

## Alternatives considered

- **Shrink the silhouette back to ~8px to match the OS mask** — rejected: it hands the silhouette contract to an OS default, and the mask's own stepped edge exists at 8px too, just hidden where it coincides with the page arc.
- **Push harder on the page side with squircle / clip-path** — rejected: the aliasing happens in the OS compositor; no in-page curve can fix it.
- **Disable OS rounding on every window** — rejected: silhouette-less transparent windows like welcome would regress to square corners, and native-framed or opaque windows don't need it.

## Consequences

Both shell windows, the dialog, and the pet layer now show the page's alpha-blended edge with no second OS clip — the 20px silhouette displays in full. Opaque windows keep `roundedCorners: true`; any future transparent window that paints its own silhouette must use the same switch, pinned by the test. The clause pushed design-language.md past its word ceiling, so `doc-budgets.manifest.json` is raised to 14400 (a contract fact, not prose bloat).
