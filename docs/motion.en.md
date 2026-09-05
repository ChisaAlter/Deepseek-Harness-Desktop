# Motion

[中文](motion.md) · English

This reference records the product motion contract and which surfaces use which recipe. Visual rules live in the [design language](design-language.en.md). Authoritative duration, easing, and distance values live in the baseline [`base.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css) and [`motion.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/motion.css). Engineering rules: [`web-styling.md`](../vendor/deepseek-harness/docs/web-styling.md). Rationale: [the motion-system Agent Note](../vendor/deepseek-harness/.agents/notes/implemented/architecture/2026-08-14-web-motion-presence-and-recipes.md).

The inventory is grouped by recipe and product surface. It does not list every Tooltip or button hover. Verify against source: search `data-dsh-motion`, `usePresence`, and `FlipText`.

## Scope

Any change to visible enter/exit, label replacement, or a persistent indicator is in scope, including:

- Official Web UI: `vendor/deepseek-harness/packages/client/**`, `apps/web/**`
- Desktop chrome: `src/renderer/**`, `src/main/closing-overlay.js`
- Desktop-owned sections and the phone client: settings marketplace (`ui-settings-market`), remote settings (`ui-settings-remote`), usage stats (`vendor/dsh-usage-panel`), and mobile Web (`mobile/web`) reuse the same tokens and families (below)

## Rules

1. **Animate only `opacity` and `transform`.** Do not animate `backdrop-filter`, and do not add an animation library. Layout properties (column width, row height, rail `top`/`left`, progress `width`) are only allowed inside the **layout tracks** list (see “Same tokens, not a recipe”) and must pause while dragging and under reduced motion.
2. **New dialogs, menus, and in-place swaps use a recipe.** A surface sets `data-dsh-motion` and `data-state` from `usePresence`. It does not invent another duration or easing.
3. **A trigger label that changes after a pick uses `FlipText`.** Permission, model, and effort chips flip when the chosen value replaces the previous string.
4. **`prefers-reduced-motion: reduce` zeros `--ds-transition-duration*` and `--ds-motion-duration-*`.** New motion must consume those tokens so it collapses with the rest. Literal durations do not zero with the tokens and keep playing under reduced motion — feature CSS must not hard-code milliseconds. This is an accessibility requirement, not just style.
5. **Reuse a primitive first.** `Modal`, `Menu`, `Tooltip`, `HoverCard`, `DisclosureRow`, and `OnboardingSurface` already carry Presence and a recipe.

## Tokens

Current values come from `ui-theme` `base.css`. Change durations in the theme sheet; do not hard-code milliseconds in feature CSS.

| Token | Current value | Use |
| --- | --- | --- |
| `--ds-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Shared easing |
| `--ds-transition-duration-fast` | 100ms | Fast transition; overlay exit, swap / fade, micro-interaction hover / press |
| `--ds-transition-duration` | 200ms | Default transition; overlay enter, card-level hover, layout tracks |
| `--ds-transition-duration-slow` | 300ms | Column collapse, Hero micro-motion |
| `--ds-motion-duration-overlay` | 200ms | Overlay enter |
| `--ds-motion-duration-overlay-out` | 100ms | Overlay exit |
| `--ds-motion-duration-popover` | 160ms | Menus / floating cards, card hover feedback |
| `--ds-motion-duration-swap` | 100ms | Fade, swap |
| `--ds-motion-duration-flip` | 400ms | `FlipText` |
| `--ds-motion-distance-overlay` | 8px | Overlay panel rise |
| `--ds-motion-distance-popover` | 4px | Popover rise |
| `--ds-motion-scale-overlay` | 0.96 | Overlay panel scale |

There are exactly five tiers: fast 100 / popover 160 / default 200 / slow 300 / flip 400. The historical 80 / 120 / 140 / 180 / 220ms literals have been merged into 100 / 160 / 200; no new tiers — change the theme sheet first.

`usePresence` holds the tree for 200ms on exit (`PRESENCE_EXIT_MS`), matching the overlay enter token. `FlipText` holds for 400ms (`FLIP_TEXT_MS`), independent of Presence.

## Recipes

Shared enter/exit lives in `motion.css`. Callers render while `mounted` and set `aria-hidden` from the logical `open`, not from `data-state`: enter starts as `closed`, and hiding then would hide the surface from assistive technology on the way in.

| Recipe | Motion | When |
| --- | --- | --- |
| `overlay` | Mask fade; panel fades and settles from 8px / 0.96 | Full-surface takeover: dialogs, settings, lightbox, onboarding |
| `popover` | Card fades and rises 4px | Anchored float: menus, slash commands, model panel, HoverCard |
| `fade` | Opacity only | The node already uses `transform` for placement: Tooltip, disclosure body |
| `swap` | Enter-only fade (`animation`, no exit) | In-place page change, e.g. a settings section |
| `flip` | Outgoing `rotateX(-80deg)`, incoming flip-in | Trigger label replacement, only through `FlipText` |

A `data-state="closed"` node is `pointer-events: none` so the 200ms exit hold cannot steal clicks.

## Inventory

### overlay

Mask plus panel. Settings is not a `Modal`, but it uses the same recipe.

| Surface | Implementation |
| --- | --- |
| Settings shell | `SettingsRoot` |
| Shared dialog | `Modal` (every row below uses it) |
| First-run takeover | `OnboardingSurface` |
| Image lightbox | `ImageLightbox` |
| Risk confirmation | `RiskConfirmation` → `Modal` (permission change, slash commands, …) |
| Git: commit message, create branch, error, commit / push confirm | `CommitDialog`, `CreateBranchDialog`, `GitErrorDialog`, `GitActionsControl` |
| Diff: discard changes | `DiffPanel` |
| Workspace: rename, delete session, picker failure | `WorkspaceBrowser`, `WorkspacePicker` |
| Directory browse, new folder | `DirectoryBrowser` |
| Settings: MCP add/edit/delete, Skills add/edit/delete, model delete / fetch candidates, agent-preset copy / view / delete, first-run model guide | `McpSection`, `SkillsSection` / `SkillForm`, `ModelsSection`, `ModelListEditor`, `AgentPresetSection`, `OnboardingModal` |
| Settings: marketplace section | `MarketSection` (desktop-owned `ui-settings-market`) |

### popover

The composer’s four floats share this timing: plus slash `MenuView`, permission `Menu`, model menu, and ContextMeter.

| Surface | Implementation |
| --- | --- |
| Shared menu | `Menu` (every row below uses it) |
| Slash / command menu | `MenuView` |
| `/` and `/model` popup select | `PopupSelectView` |
| Composer model / effort menu | `ModelSelect` |
| Context-usage panel | `ContextMeter` |
| Workspace row preview | `HoverCard` (`Rows`) |
| Title-bar branch, Git overflow | `BranchMenu`, `GitActionsControl` |
| Composer permission | `PermissionSelect` |
| Workspace switcher, session group/sort, workspace / session row actions | `WorkspacePicker`, `WorkspaceBrowser`, `Rows` |
| Right-rail add surface, tab context | `SurfaceTabs` |
| File-tree copy path | `FileTree` |
| Agent preset | `AgentPresetSeat`, `PresetMenu` |
| Settings rows: language, close behavior, Enter-to-send, permission preset, Harness restart attempts / delay, MCP enabled filter, Skills source filter | `LanguageRow`, `CloseBehaviorRow`, `EnterBehaviorRow`, `PermissionRow`, `HarnessRestartRow`, `McpSection`, `SkillsSection` |

### fade

| Surface | Implementation |
| --- | --- |
| Every Tooltip | `Tooltip` (sidebar, title-bar panel toggles, composer, queue, message actions, terminal, Git hints, …) |
| Disclosure body | `DisclosureRow`: reasoning, tool rows, command cards, context injection, Diff files, workflow status |
| Sidebar workspace session run | `GroupSessionRun`: `fade` enter/exit; inner `0fr` / `1fr` collapses on `--ds-transition-duration`; the caret rotates on the same token |

### swap

| Surface | Implementation |
| --- | --- |
| Settings section change | `SettingsRoot` wraps the pane in `data-dsh-motion="swap"` with `key={active}` |

### flip

| Surface | Implementation |
| --- | --- |
| Permission chip label | `PermissionSelect` → `FlipText` |
| Model name, effort | `ModelSelect` → `FlipText` |
| Remote settings chip | `RemoteSection` → `FlipText` (desktop-owned `ui-settings-remote`) |
| Settings selectors (language, Enter behavior, permission preset, close behavior, autostart, restart policy, MCP / Skills filters, vision model, protocol, gateway, wallpaper source, pricing panel) | `SettingsSelect` → `FlipText` |
| Transcript view row, agent preset chip | `TranscriptViewRow`, `AgentPresetSeat` → `FlipText` |

### Same tokens, not a recipe

These transitions consume `--ds-transition-*` / `--ds-ease-in-out` without `data-dsh-motion`. Do not invent a duration for them.

| Surface | Behavior |
| --- | --- |
| Sidebar / column collapse | `AppFrame` transitions `grid-template-columns` / `rows`, handle `left`, and icon offset; pauses while dragging; stops under reduced motion |
| Switch | `Switch` thumb `transform` over `--ds-transition-duration-fast` |
| Button, field, and row hover | Interactive color tokens, not an enter/exit recipe |
| Micro-interactions | Icon-button press, card press offset, and other `transform` feedback over `--ds-transition-duration-fast`; card-level hover (border / fill) uses `--ds-motion-duration-popover` |
| Layout tracks | `TurnNavigator` turn rail (`height` / `top` / mark width, own swift curve), `WorkspaceBrowser` row collapse (`max-width` / `margin` / `padding` / `width` + `visibility` delay), `UpdateAction` progress width: layout-property animation over `--ds-transition-duration`, stopped under reduced motion |
| Sidebar rail choreography | `SidebarRoot`: 150ms collapse phase + 200ms `wide-in`, riding AppFrame’s 300ms track; stopped under reduced motion |
| Empty-session Hero fish | On hover when motion is not reduced, a 1.6s gentle sway loop |

### Indicator families

Infinite busy / loading indicators are product language, not recipes; their loop periods are design values that stay **out of the token table**. Rules: every usage ships its own `prefers-reduced-motion` stop; a new busy indicator joins an existing family instead of inventing another kind of spin.

| Family | Instances (period) |
| --- | --- |
| Skeleton sweep | ReasoningRow / ToolRow / SkillRow / GenericCommandCard / bash-sample row sweeps 2.6s; `MenuView` menu skeleton 2s |
| Composer beam | `InputBar`: `beam-spin` 1.96s, `beam-hue` 12s, `beam-hue-bloom` 12s, beam layer fade-in 420ms; following Libraries.dev Rotate, the 2px / 0.6 stroke and dual-conic inner layer form a moving peak and transparent trail without a duplicate `clip-path`; bloom uses `blur(8px)` / 0.36 inside the 4px rounded clip shell; `mobile/web` mirrors the timing values |
| Spinner | `TodoPanel` 1s, `GitProgressToast` 0.7s, `AppearanceSection` gallery 0.7s, `TrajectoryTable` history loading 700ms, `TurnNavigator` busy 1s, `ChatView` turn status 1.8s, `MessageItem` retry 1.6s, `InputBar` pending 1s |
| Status dots | `StateDot` chase 1s (inline `-125ms` stagger), `ConnectionIndicator` dot matrix 1.5s step-end |
| Phone flow | `mobile/web`: `flow-dot-spin` 0.9s, `flow-sweep` 2.6s, `flow-caret` 1s steps(2) |

### Exceptions

These do not use a `motion.css` recipe. Do not spread them onto new Web UI overlays.

| Surface | Behavior | Source |
| --- | --- | --- |
| Toast | 160ms slide-in, 3s hold, 1s fade; the component times its own unmount | `Toast.tsx` / `Toast.module.css`. Composer attachment cap, model-select failure, … |
| Desktop boot page | Mark / copy `rise` (8px + fade, staggered 0 / 80 / 120 / 160ms); stamp `pulse` 1.2s; reticle `spin` 1.05s; log lines `fade`. Durations use baseline tokens; reduced motion stops all of them | [`boot.css`](../src/renderer/boot.css). The instrument look must not spread; see [Desktop boot page](design-language.en.md#desktop-boot-page) |
| Closing overlay | Local 0.85s infinite spin; does not read `--ds-motion-*` and has no reduced-motion branch | [`closing-overlay.js`](../src/main/closing-overlay.js) |
| dshbot robot avatar | Thinking morphs the same-command-count path as slime (squash, bulge, stretch, lean); sclera blink and pupil use `transform` only; uploaded images pulse with `scale`. Easing is `--ds-ease-in-out`; reduced motion freezes all of it | [`vendor/dshbot/client/client.js`](../vendor/dshbot/client/client.js). Do not spread onto official Web UI overlays |
| Agent preset seat entrance | Icon 150ms / label 400ms, one-shot `cubic-bezier(0.16, 1, 0.3, 1)`; stopped under reduced motion | `AgentPresetSeat.module.css` |
| Usage-stats chart entrance | Heat cells 0.45s, bars / donut 0.9s, same curve, one-shot grow; stopped under reduced motion | `dsh-usage-panel` `styles.ts` |

## Adding motion

| Need | Use |
| --- | --- |
| Full-surface dialog or masked panel | `Modal`, or `usePresence` + `data-dsh-motion="overlay"` (`mask` / `panel`) |
| Anchored menu or card | `Menu` / `HoverCard`, or `usePresence` + `popover` |
| Hint already placed with transform | `Tooltip`, or `fade` |
| Replace one in-place block | `swap` on the keyed node |
| Trigger label changes from A to B | `FlipText` |
| Short success / failure banner | Existing `Toast`; do not invent another hold-and-fade |
| Persistent busy indicator | Join an indicator family (above) and ship the `prefers-reduced-motion` stop; do not invent a new infinite loop for one-shot feedback |
| Layout-property animation | Join the layout-tracks list first (adjudicated in this document); durations consume tokens; drag and reduced motion must stop it |

The tree stays mounted for 200ms after logical close. Tests treat `aria-hidden` / `queryByRole` as closed; they do not assert immediate unmount. A store that clears on close keeps a last-open snapshot for the exit frame.

## Source

- Recipes: [`motion.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/motion.css)
- Tokens: [`base.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css)
- Presence: [`usePresence.ts`](../vendor/deepseek-harness/packages/client/ui-primitives/src/usePresence.ts)
- Flip labels: [`FlipText.tsx`](../vendor/deepseek-harness/packages/client/ui-primitives/src/FlipText.tsx)
- Desktop boot tokens: [`boot-tokens.css`](../src/renderer/boot-tokens.css), [`dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css)
