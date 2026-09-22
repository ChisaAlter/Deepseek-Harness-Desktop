# Agent Note: Motion tier conformance — Modal presence and tokenized transitions

Status: implemented

English | [中文](2026-09-03-motion-tier-conformance-modal-presence.zh.md)

## Problem

The [motion-system note](../architecture/2026-08-14-web-motion-presence-and-recipes.md) shipped the five recipes and `usePresence`, but the shipped Web UI had drifted from it in three ways. First, `Modal` unmounted on `!open` and set no `data-dsh-motion`, so every dialog built on it — `RiskConfirmation`, the Git dialogs, workspace rename/delete, directory browse, and the MCP, Skills, Models, and agent-preset settings dialogs — appeared and vanished with no enter or exit motion despite being listed as overlay consumers, and close was an immediate unmount with no 200ms hold. Second, roughly 120 functional-CSS transition declarations carried literal durations (a recurring off-table 120ms tier, plus 80 / 140 / 180 / 220 / 420ms and `.12s` / `.16s` variants) and literal `ease` / `ease-out` curves; literal durations do not zero with the reduced-motion token collapse, so reduced motion left them playing. Five shipped infinite indicators (`TodoPanel`, `StateDot`, the slash-menu `MenuView` skeleton, the update progress bar, and the framework-free boot page spinner) had no reduced-motion stop at all, and several surfaces animated layout properties (`height`, `width`, `top`, `left`, `max-width`, `padding`, `margin`, `box-shadow`) with no recorded contract. Third, an entire layer of shipped product motion — skeleton sweeps, the composer beam, busy spinners, the status-dot chase — and deliberate choreographies (sidebar rail collapse phases, Hero fish) existed outside any recorded contract, while the standing "do not add another infinite spin inside the Web UI" wording contradicted what had shipped.

## Decision

**`Modal` joins the recipe system.** `Modal` calls `usePresence`, carries `data-dsh-motion="overlay"` and `data-state` on the root, `data-dsh-motion-part="mask"` / `"panel"` on the mask and dialog, and binds `aria-hidden` to the logical `open`. Close holds the tree for the 200ms exit; every dialog listed on the overlay inventory inherits the enter/exit recipe from the primitive instead of re-wrapping it per caller.

**Transition durations and easings consume the five tiers.** Functional CSS may only write `--ds-transition-duration-fast` (100ms), `--ds-motion-duration-popover` (160ms), `--ds-transition-duration` (200ms), `--ds-transition-duration-slow` (300ms), or `--ds-motion-duration-flip` (400ms), with `--ds-ease-in-out` as the shared curve. The accreted 80 / 120 / 140 / 180 / 220ms literals and `ease` / `ease-out` curves were merged onto the nearest tier; a card-level hover uses the popover tier, micro hover/press feedback uses fast, and layout tracks use the default tier.

**Layout-property animation is admitted as recorded layout tracks.** `TurnNavigator` (rail `height` / `top` / mark width on its own swift curve), `WorkspaceBrowser` (row collapse over `max-width` / `margin` / `padding` / `width` with the `visibility` transition-delay), `UpdateAction` (progress `width`), and the trajectory timeline playhead (`left`) keep animating layout properties on `--ds-transition-duration`, following the `AppFrame` grid-track precedent; drag and reduced-motion must stop them.

**Infinite busy indicators are recorded as families, not banned.** The skeleton sweeps, composer beam (including the 420ms beam-layer fade), busy spinners, and status-dot chase are product language with design-value loop periods that stay out of the token table. Every usage ships its own `prefers-reduced-motion` stop — the five uncovered ones now do, and the mobile Web flow family plus its beam-layer transition are covered the same way. New busy indicators join a family instead of inventing a new spin. The sidebar rail choreography (150ms collapse phases plus the 200ms `wide-in`), the Agent preset seat one-shot entrance, the Hero fish 1.6s hover loop, and the usage-stats panel chart entrances are recorded as documented values in the same contract; the desktop product spec (`docs/motion.md` in the desktop repository) records the family inventory, the tier rule, and the corrected Hero fish value.

## Alternatives considered

**Add 120ms as a sixth tier in the theme sheet.** Rejected: 120ms was never a design decision, it accreted; six near-identical tiers invite a seventh, and the whole point of the tier list is that a new surface picks one of five values instead of minting another.

**Rewrite the layout tracks to transform-only motion.** Rejected for the turn rail and workspace row collapse: they track scroll- and content-driven sizes, so a transform rewrite would restructure measurement and hit testing for no user-visible gain. Recording them as layout tracks with token durations and mandatory stops follows the `AppFrame` precedent instead of pretending the motion does not exist.

**Purge the infinite indicators to honor the old "no more infinite spins" wording.** Rejected: the sweeps, beam, and spinners are shipped product language that users see on every loading row; deleting them would remove resting-state affordances the UI relies on. The contract now admits them as families with mandatory reduced-motion stops.

**Leave `Modal` unstyled and require callers to wrap `usePresence`.** Rejected: every overlay inventory row would re-wrap the same hook and attributes; the primitives are the recipe boundary everywhere else (`Menu`, `HoverCard`, `Tooltip`), so the shared dialog is where the recipe belongs.

## Consequences

Dialogs enter and leave on the shared overlay timing, and their close holds 200ms, so a store that clears on close must keep the last-open snapshot through the exit frame — the rule the motion-system note already states for menu stores. Reduced motion now actually stops the previously literal transitions and the previously uncovered indicators, because token-backed durations zero with the media query. Durations collapsed from a continuum to five tiers, with felt deltas of at most 40ms on micro-interactions. The cost is one more mounted frame of dialog DOM during exit and a discipline requirement: any future duration that does not fit a tier is a theme-sheet change first, per the design language.

## Testing

Overlay consumers assert logical close through roles / `aria-hidden`, which stays true of the exiting root, so the existing dialog specs run unchanged through the 200ms hold; the ui-primitives suite (including the `Modal` coverage in `atoms.client.spec.tsx`) passes in full. The tier merge is CSS-only and covered by the per-file 100% client coverage gate; reduced-motion stops are CSS media rules with no behavioral test surface beyond the existing `motion-styles` pinning of the token collapse.
