# Decision: Boot page moves to a sea-horizon canvas — deep space / deep sea divide + bottom ticker + log drawer

Status: implemented

[中文](2026-09-26-boot-sea-horizon-scene.md) | English

> Supersedes [2026-09-25-boot-page-responsive-instrument-canvas](../../archived/product/2026-09-25-boot-page-responsive-instrument-canvas.en.md)

## Problem

The user explicitly asked for a boot-page redesign ("the previous redesign request changed nothing"), so the instrument canvas (scan lines / corner rails / state stamp) had to retire wholesale. After three prototype directions (sonar / deep-minimal / porthole) and log-zoning variants, the locked design is `docs/superpowers/prototypes/boot-redesign-b2-horizon.html`: a clean hairline at 62% height divides the scene — above it deep space on dark theme (three nebulae + milky-way band + two-layer starfield) or high-altitude clouds on light theme; below it deep sea (overall dimming + soft surface-light falloff + suspended particles + abyss vignette), with no beams, ripples, or glow decoration.

## Decision

The boot page becomes a sea-horizon canvas, replacing both the instrument canvas and the two-page details structure:

- Scene: `.scene` carries the `--boot-scene` gradient + `.stars` (nebula/dust/bright-star layers) + a clean 1px `.horizon` + `.underwater` dimming veil (surface-light falloff) + `.abyss` vignette; the whale mark, corner rails, scan lines, and corner meta are all removed.
- Brand: "Whale Isle" switches to a serif display stack (Didot/Bodoni family) with a narrow shine band sweeping every 6s via `background-clip: text`; the CJK subtitle does not shine.
- Status: starting shows only 「启动中」 plus three breathing dots; the dots collapse in ready/error states, while recovery countdown and diagnostic copy are unchanged.
- Logs: a one-line bottom ticker (pulse dot + latest line + `L NN` count + "全部日志" affordance); click/Enter/Space raises a frosted drawer from the bottom edge carrying the full numbered log (capped at 400 lines), closed via ESC / backdrop / ×; important lines tint via `isImportantBootLog`.
- The action surface returns to center: the four transient actions appear directly on the scene during error / recovery-scheduled / restarting, so the drawer never needs to auto-open — it is manual only.
- `prefers-reduced-motion` freezes the sheen, twinkle, particles, dots, and drawer motion; the `data-harness-covered` blanking and maximized-corner contracts are unchanged.

## Alternatives considered

- Reskinning the instrument canvas: fails the explicit "redesign" request, and the two-page details structure already proved heavy in real use.
- The two-page details layout (L1, the previous decision): a full-page overlay is too heavy for a transient boot surface; ticker + drawer is quieter, and with the action surface back in the center there is no auto-flip fallback to preserve.
- Whale half-submerged / ripples / refraction beams: each was rejected during prototype review (the semicircle veil read as bathing, ripples crossed the sight line, beams looked cheap); only the clean waterline and underwater dimming survive.

## Consequences

`boot.html` is restructured (meta/scan/rails/mark/details removed; scene layers + ticker + drawer added), `boot.css` is rewritten, `boot-tokens.css` carries the sea-horizon palette (entire starfield layers included as tokens, keeping boot.css free of color literals and scheme branches), and `boot.js` drops the stamp and details-page logic for a one-line ticker plus drawer toggle. Whale assets retire from the boot page (`whale-spin.svg`/`whale-head.png` remain for other surfaces). Contract tests re-pin the new structure: ticker/drawer/waterline assertions replace the log-dock/rail assertions. This record supersedes [2026-09-25 instrument canvas](../../archived/product/2026-09-25-boot-page-responsive-instrument-canvas.en.md) and [2026-09-26 two-page log zoning](../../archived/product/2026-09-26-boot-log-details-page.en.md); recovery semantics, IPC boundaries, and the `--boot-*` scope rule are unchanged.
