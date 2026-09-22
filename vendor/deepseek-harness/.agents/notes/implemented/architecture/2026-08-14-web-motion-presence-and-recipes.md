# Agent Note: Web motion — theme recipes and Presence

Status: implemented

English | [中文](2026-08-14-web-motion-presence-and-recipes.zh.md)

## Problem

Dialogs, menus, settings, and in-place swaps mounted and unmounted on `open` with no shared enter or exit motion. Each surface that later needed a transition invented its own duration, easing, and unmount timing, so overlays snapped and new features could not inherit one behavior. An animation library would add a per-frame runtime on top of wallpaper frost. The styling system already owns motion tokens; it did not own overlay recipes or an exit-hold.

## Decision

**Theme recipes plus `usePresence` are the motion system.** [`motion.css`](../../../../packages/client/ui-theme/src/styles/motion.css) declares five attribute recipes — `overlay` (mask fade and panel translate/scale), `popover` (card fade and 4px rise), `fade` (opacity only, for nodes that already use `transform` for placement), `swap` (enter-only remount fade), and `flip` (stacked `rotateX` on a label change). Recipes move only `opacity` and `transform`. Duration, easing, distance, and scale live on `--ds-motion-*` / `--ds-transition-*` tokens in [`base.css`](../../../../packages/client/ui-theme/src/styles/base.css). `prefers-reduced-motion: reduce` zeros those durations.

**`usePresence(open)` is the only exit hold.** It mounts in a layout effect so focus and measure see the tree before paint, writes `data-state="closed"` then `"open"` after two animation frames so the CSS transition can play, and on close writes `"closed"` and unmounts after 200ms (or immediately under reduced motion). Callers render while `mounted` and set `aria-hidden` from the logical `open`, not from `data-state`, because enter starts as `closed` and hiding then would hide the surface from assistive technology on the way in.

**Primitives absorb the recipes; feature overlays reuse them.** `Modal`, `Menu`, `HoverCard`, `Tooltip`, `DisclosureRow`, and `OnboardingSurface` take the hook. Settings, `PopupSelect`, the slash `MenuView`, `ImageLightbox`, the composer `ModelSelect` menu, the `ContextMeter` panel, and the sidebar workspace session run (`GroupSessionRun`) do the same. The composer toolbar's four popovers — plus `MenuView`, permission `Menu`, `ModelSelect`, and `ContextMeter` — all use the `popover` recipe so they enter and leave on one timing. `FlipText` plays the `flip` recipe for 400ms (`--ds-motion-duration-flip` / `FLIP_TEXT_MS`) on the permission, model, and effort trigger labels — and on the settings selector pill (`SettingsSelect`, covering language, Enter behavior, permission preset, close behavior, autostart, restart policy, the MCP / Skills filters, vision model, protocol, gateway, wallpaper source, and pricing rows), the transcript view row, the agent preset seat, and the remote settings chip — when the chosen value replaces the previous string; that hold is independent of the 200ms Presence exit. A store that clears on close keeps a last-open snapshot for the exit frame. Toast keeps its own hold-and-fade. New dialogs, menus, and swaps use a primitive or the same hook and recipe; they do not add a motion library or animate `backdrop-filter` or large-panel size.

The [web styling system](../process/2026-07-19-web-styling-system.md) still owns the token-and-CSS-Modules framework. This note owns the overlay recipes, Presence, and the no-library rule.

## Alternatives considered

**Framer Motion / GSAP / Spring.** Highest effect ceiling (shared layout, gesture follow-through), and `AnimatePresence` already solves the exit hold. Rejected: a second animation runtime beside CSS Modules, extra bundle and per-frame work on frosted chrome, and durations that would drift off the theme tokens unless wrapped again.

**View Transitions API as the base.** Native and light for same-surface content swaps. Rejected as the foundation: snapshotting an 800×800 frosted settings panel is expensive, and portal enter/exit is awkward. A later settings-tab morph can still call `document.startViewTransition` without replacing Presence.

**Per-component keyframes only.** Tooltip and the sidebar already did this. Rejected as the system: exit still requires a shared hold, and every new overlay would copy timings.

## Consequences

Overlays enter and leave on one token set. A new surface pays a `usePresence` call and two attributes, not a new duration table. Reduced motion collapses existing token-backed transitions at the same time as the new recipes. The cost is a 200ms DOM hold after logical close, last-open snapshots on store-driven menus, and tests that treat `aria-hidden` as closed.

## Testing

`usePresence` pins enter-on-second-frame, the 200ms exit hold, and the reduced-motion skip. `FlipText` pins the 400ms outgoing hold, the timeout drop, and the reduced-motion skip. `motion.css` pins the five recipes, opacity/transform-only transitions, and zeroed duration tokens including `--ds-motion-duration-flip: 0s`. Shell `base.css` pins `motion.css` after `base.css`. Overlay consumers assert logical close through roles / `aria-hidden`, not immediate unmount. These suites live under `test:gui` and the per-file 100% coverage gate; they are not browser-golden pixels.
