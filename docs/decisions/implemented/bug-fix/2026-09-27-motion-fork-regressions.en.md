# Decision: Restore desktop motion effects lost in an upstream merge

Status: implemented

[中文](2026-09-27-motion-fork-regressions.md) | English

## Problem

Two upstream merges (`dsh-v0.1.7-alpha.2` and `dsh-v0.1.7-rc.2`) resolved desktop-fork motion call sites to the upstream version, and no gate caught it:

- The model and reasoning-effort trigger fell back from `FlipText` to plain `<span>` elements, so the label switched instantly after a pick.
- `Menu`, `MenuView`, `Tooltip`, `HoverCard`, and `DisclosureRow` lost their `data-dsh-motion` / `usePresence` recipe markers; overlays no longer faded in or out and disclosure bodies snapped open.
- The transcript-presentation settings row (`PreferenceRow`) also lost `FlipText`.
- `Tooltip.module.css` kept its `tooltip-in` keyframes while `.bubble` never referenced them, leaving dead code.

The cause is that these call sites live in upstream-owned files. The fork markers in `src/shared/harness-desktop-forks.js` covered desktop-owned packages and some whole-package rows, but not the motion call sites, so "take upstream" resolved silently. The rendered result contradicted the `flip` / `popover` / `fade` rows of `docs/motion.md`.

## Decision

Restore the lost recipes as documented in `docs/motion.md`, and register every call site as a fork assertion so the next sync fails loudly instead of regressing silently:

- The model name and reasoning effort in `ModelSelect`, and the option label in `PreferenceRow`, use `FlipText` again (400ms `flip`).
- `Menu`, `MenuView`, and the compact `HoverCard` variant use `usePresence` with `data-dsh-motion="popover"` again; `MenuView` keeps its last open group snapshot through the exit so the 200ms transition never paints an empty card.
- `DisclosureRow` uses `usePresence` with `data-dsh-motion="fade"` again.
- `Tooltip.module.css` applies its existing `tooltip-in` animation to `.bubble`, timed by `--ds-motion-duration-swap`.

`HoverCard`'s `preview` variant keeps its own upstream 100ms fade — `close()` only enters that closing phase for `variant === "preview"`; the `inline` and compact variants use the shared recipe and do not stack a second fade. `Menu` anchor tracking still follows the logical `open` flag; the exit frame only freezes placement instead of measuring a closed list.

## Alternatives considered

- **Fix only the reported model trigger** — rejected: the same merge swallowed the menu, disclosure, and tooltip recipes; fixing one leaves the rest to reappear after the next sync.
- **Add animations for upstream selectors in `motion.css`** — rejected: upstream no longer emits `data-dsh-motion`, so the stylesheet has nothing to match; the component markers must come back, which is exactly what `motion.md` states.
- **Keep the `MenuView` exit snapshot in the store** — rejected: clearing groups on close is intentional state semantics; the snapshot belongs to the render layer and a `useRef` is enough.

## Consequences

Cost: `Menu` and `HoverCard` carry one more presence state, `MenuView` retains one last-open snapshot, and the fork assertions gain seven rows, so a future upstream refactor must update `docs/motion.md` before removing these call sites. Benefit: model and reasoning picks flip again, menus/overlays/disclosures regain their 100–200ms recipes, the tooltip keyframes stop being dead code, and the next `sync:harness` fails on the assertion rather than degrading silently.
