# Decision: Anchor the transparent-window rounded silhouette with an inset hairline ring

Status: implemented

[中文](2026-09-25-window-silhouette-edge-ring.md) | English

## Problem

After the rounded corners and window controls were restored, the user still reported "the corners look very blurry". The main window is a `frame:false + transparent:true` layered window whose rounded silhouette is entirely a page-painted alpha edge (`harness-chrome-inject.js` gives `body` a 20px radius + `overflow:hidden` clip). Pixel measurements showed the straight/arc edge transition is only ~1.5–2 physical pixels (at 150% DPI) — close to normal antialiasing — but a bare alpha-AA edge has no anchoring line and reads as haze against the desktop wallpaper. The sibling launcher card gets a crisp outline from `.shell`'s `inset 0 0 0 1px var(--dsw-alias-border-l1)` hairline ring; the Harness silhouette lacked an equivalent.

## Decision

The inject script gains a dedicated element `#dshd-frame-ring` (`ensureFrameRing`, attached to `document.body` — the `--dsw-alias-*` tokens are declared on body, so an element under documentElement would only ever resolve the fallback) as the silhouette's hairline ring: `position:fixed; inset:0; border-radius:20px; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(128,128,128,.4)); pointer-events:none; z-index:2147483646` (one level below the window-control plate's 2147483647). The color rides `border-l2` (dark 12% white / light 10% black) — `border-l1` (6%/4%) proved too weak to anchor the edge; the literal fallback covers pages where the token is missing. Under `html[data-window-maximized]` the element is `display:none` — a maximized square silhouette keeps no edge line, matching the launcher card.

The ring sets no `corner-shape` — the client's global `* { corner-shape: var(--dsw-corner-shape) }` automatically gives it `superellipse(1.5)`, the same curve as the `body` clip. Live testing confirmed the compositor's overflow clip does honor `corner-shape`: pinning the ring to `round` produces a double contour at the arc's midpoint, so ring and clip must share one shape value.

## Alternatives considered

- **Painting the hairline on `body::after`** — rejected: it claims the `body::after` namespace the client doesn't use today but could tomorrow (a collision fails silently), pseudo-elements are not in the DOM so the self-heal observer cannot watch them by id, and a `position:fixed` pseudo-element's containing block re-binds if the client ever transforms/filters `body`. A real element is observable, self-healing, and namespace-independent — the first version used the pseudo-element; adversarial review switched it to an element.
- **Painting the hairline on `body` itself** — rejected: an `inset` shadow paints above the element's background but below its children, so the viewport-filling `.frame` content layer covers it entirely; it must be an overlay above content.
- **Dropping the injected clip and letting the client's `AppFrame` radius be the silhouette** — rejected: removing the `body` clip in a live test made all four corners square — in that layout `AppFrame`'s radius does not form a window-level silhouette; the injected clip is the sole authoritative edge.
- **Replacing `superellipse` with `corner-shape: round`** — rejected: same-geometry A/B screenshots were nearly identical, so it was not the source of the perceived blur; and `superellipse(1.5)` is the client design language's global token that the desktop shell should not fork.
- **Reverting `transparent:true` to regain native DWM corners** — rejected: the transparent layered window carries page-painted wallpaper/gradient and the silhouette design (feature-card contract); abandoning the whole visual scheme for edge texture does not hold up.

## Consequences

The silhouette edge now has a 1px `border-l2` hairline anchoring it, so the rounded corners read as a defined outline instead of a gradient band over the desktop wallpaper; across maximize/restore the ring correctly disappears and returns via `display:none` under `data-window-maximized`; the ring is the observer's fourth watched id, so a page rebuild regrows it too. Costs: one more persistent DOM node and one more `getElementById` per observer pass (negligible); `dshd-frame-ring` joins the injected surface, and removing it gets healed back. Verified: all 10 `harness-chrome-inject` unit tests pass (ring contract + self-heal id + `getWindowState` seed assertions); live Electron + CDP — the ring element is present computing `superellipse(1.5)`/inset-1px-ring, maximize hides it and restore brings it back, and physical-pixel screenshots confirm anchored arcs on all corners with no dark strip on the right edge.
