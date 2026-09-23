# DSHD design language

[中文](design-language.md) | English

DSHD (Deepseek-Harness-Desktop — the desktop application in this repository; distinct from the `dsh` CLI and from the dshd daemon in `src/main`) defines its design language in this document: it is the sole visual authority for every visible surface of DSHD. The language's baseline is pinned to the vendored `vendor/deepseek-harness` Web UI — currently `dsh-v0.1.7-alpha.2` (`00102833dfaee1da9f48a3a8eae9d34005a75218`), recorded in [`vendor/harness-upstream.json`](../vendor/harness-upstream.json) and updated by `npm run sync:harness`. The desktop chrome, closing overlay, title-bar injection, right-hand surfaces, the Web UI page opened by phone remote, and any new frontend all implement the same language. Do not invent a second skin.

"Matching the baseline" is not a judgement call. It is three hard criteria, all anchored in real artifacts:

1. **One token table.** Colors come only from vendor `ui-theme`'s [`design-platform.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css) / [`base.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css). Surfaces that cannot import the theme package use same-value mirrors: the shell's [`src/shared/dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css) (its file header declares it matches design-platform.css), the mobile SPA's `mobile/web/tokens.css`, and Android Compose's `DshTokens`.
2. **One primitive set.** Controls reuse [`ui-primitives`](../vendor/deepseek-harness/packages/client/ui-primitives/): `Button` / `Input` / `Menu` / `Modal` / `Tooltip` / `Switch` / `HoverCard` / `DisclosureRow` / `FlipText` / `usePresence` / `Toast` / `ic_ds_*` icons (`icons/`).
3. **One set of numbers.** Border and hover alphas, radii, type-size/line-height pairs, spacing, and shadow levels use the fixed values in this document (see [Hard rules](#hard-rules) and [Visual anchors](#visual-anchors)); those numbers are the contract distilled from the pinned baseline.

Responsibility runs one way: **edit this document first, then the code.** `sync:harness` re-pins the code baseline but does not change the design language; visual drift arriving with a new baseline must be adjudicated into this document before it lands in implementation. The boot page's instrument look lives only in [`src/renderer/boot.html`](../src/renderer/boot.html); see [Desktop boot page](#desktop-boot-page). Do not spread it.

Read this before changing UI, layout, or frontend. Engineering mechanics (CSS Modules, token layers, motion recipes) live in the docs inside the pinned vendor tree — this file does not duplicate them:

- Token source: [design-platform.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css), [base.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css), [gradient-shadow-text.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/gradient-shadow-text.css), [motion.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/motion.css)
- Control primitives: `vendor/deepseek-harness/packages/client/ui-primitives/` (`Button` / `Input` / `Menu` / `Modal` / `Tooltip` / icons)
- Engineering rules: [web-styling.md](../vendor/deepseek-harness/docs/web-styling.md)
- Motion contract and inventory: [motion.en.md](motion.en.md)

Desktop application branding uses the supplied transparent head [`assets/whale-head.png`](../assets/whale-head.png), preserving its full proportions without a separate tray crop. Application icons use a white rounded-square background (radius 22% of the side), with the head centered and inset 4% on each edge; the installer reads the same generated `assets/icon.png`. Windows, taskbar, tray, and installer share this source; `assets/icon.svg` wraps it, and `npm run icon` generates `assets/icon.png` and multi-size `assets/icon.ico`. The pet-art generator no longer owns application icons.

## Scope

Any change to a visible surface is in scope, including:

- `vendor/deepseek-harness/packages/client/**`, `apps/web/**`
- `src/renderer/**`, `src/main/closing-overlay.js`, `src/main/harness-chrome-inject.js`

Terminal, diff, and code blocks keep the baseline monospace / no-wrap rules. That is content typography, not a second chrome language.

## Hard rules

New Session keeps the existing entry points, draft canvas, and composer, and reuses only ordinary blank drafts without a prior identity. Titled sessions, sessions previously managed by a plugin, and forks retain their identity and are not opened as new drafts. No controls or visual styling are added.

The Harness 0.1.7-alpha.2 integration retains this document's visual contract. New upstream components reuse the same tokens and primitives; migrations of layout services, slots, or props must preserve the desktop title bar, work surfaces, transparent wallpaper, linked composer width, and typing effects. Surface tab close controls remain to the right of the title; the boot-page exception keeps its existing scope.

Window controls (`window-controls.css`) carry one deliberate system-color exception: minimize/maximize hover uses the `--dsw-alias-interactive-bg-hover` token, but the close button hover uses the Windows system semantic color `#e81123` (red) with a `#fff` foreground — a platform-level "danger/close" convention, not a theme color. This is intentional; do not convert it to a token.

The model control automatically loads the current selection when entering or returning to an existing conversation, without requiring the model menu to open. Sending a message or remounting the control must not turn a saved model into "Select model". Initial synchronization reuses the loading label; a missing catalog display name uses the provider/model id. Controls, styling, and draft-page behavior stay unchanged.

Message editing reuses the resident composer, edit banner, and bubble marker. Confirm always regenerates within the current conversation, including its first message; the sidebar neither adds nor switches conversations, and Chat hides the superseded turn. Cancel and failure retain the existing draft restoration and notice styling.

Submitting a draft moves the resident composer continuously into its conversation position without a bottom flash or rebound. Transcript, statistics, and input-size updates must not expose intermediate layouts. Reuse existing motion duration and easing; reduced motion settles immediately. Decoration and final geometry remain unchanged.

The mobile remote connect screen reuses its device status and error lines: pairing and saved-device reconnect show a connecting state; failure shows a failed state and restores connection controls without deleting saved devices. Never leave the waiting-for-pairing label during a connection or disable controls indefinitely. Automatic recovery after an established connection remains unchanged.

Web and Android share recovery states: indicate catalog synchronization after authentication and offer Retry beneath the existing drawer error, never a false empty catalog. A new offer supersedes an older attempt; successful pairing removes the one-time fragment. Foreground recovery retains drafts and checks the connection before resynchronizing the catalog and open conversation. Reuse existing controls and status bars.

Remote connection mode uses the existing segmented control with LAN / Server labels. Server is the default; LAN remains an explicit manual choice. Layout, colors, and the pairing protocol stay unchanged.

The plugin marketplace does not inject a first-party dshbot recommendation card. Registry sources, card primitives, and generic plugin management stay unchanged.

1. **Reuse before drawing.** Buttons, fields, menus, dialogs, tooltips, and disclosure rows use `ui-primitives`. Do not restyle their radius, height, or hover. A disabled menu item may explain its reason with a left-side Tooltip using the primitive's existing style.
2. **Colors are `--dsw-alias-*` / `--dsw-specific-*` only.** Feature CSS must not contain `#hex`, `rgb()`, or a private `--bg` / `--accent` sheet. Missing tokens are added to the theme sheets first, then consumed as semantic aliases.
3. **Light/dark lives only in the theme tables.** Feature CSS must not branch on `[data-theme]`, `[data-ds-dark-theme]`, or `prefers-color-scheme`.
4. **The accent is not electric blue.** Default primary buttons are near-black (light) / near-white (dark): `--dsw-alias-button-primary-fill` (`rgb(15, 17, 21)` in light). Brand blue is `--dsw-static-deepseek-500` (`rgb(65, 118, 230)`) and its aliases (`--dsw-alias-button-info-fill`, `--dsw-alias-state-business-primary`) for info emphasis, user bubbles, and selection. Do not introduce `#2b5cff`, `#6ea8ff`, or `#3964fe`.
5. **Borders are alpha, not solid gray.** Light `rgba(0,0,0,.04/.10/.12)`, dark `rgba(255,255,255,.06/.12/.16)` — `--dsw-alias-border-l1`–`l3`. Columns are separated by a 1px hairline, not a wall of shadowed cards.
6. **Hover / active use the interactive tokens.** Light `rgba(38, 49, 72, .06 / .10)`, dark `rgba(255,255,255,.08 / .14)`: `--dsw-alias-interactive-bg-hover` / `active`. Do not mint a new solid gray wash.
7. **Radius by role.** Primary capsule 18 (height 36) / compact 14 (height 28); input 8; menu 12; dialog 24; tooltip 8; icon hit-target 8. No 6px rectangles; no 999px except capsules and switches. Desktop shell outer frame (`.frame` edge and the Windows titlebar content corner `--dsh-windows-content-radius`) 20; launcher window frame 20. Both windows are `transparent`: the launcher's silhouette is drawn by its `.shell` card, and the desktop's by the page itself — the boot `.stage` rounded card, and in harness an injected `body` (`position:relative`) radius clip backed by the `#dshd-frame-canvas` base layer (zeroed while maximized) — absolute/fixed full-viewport layers escape body's rounded clip, so `#dsh-wallpaper` and `#dshd-frame-canvas` carry the same radius themselves; inner controls keep their role values.
8. **Font size always pairs with line-height.** Title 16/24, body 14/22, compact 12/18, tooltip 13/20. Weights 400 / 500 / 600 / 700; Figma 510 renders as 500. No `font-weight: 650`.
9. **Spacing is a multiple of 4.** Padding, gap, and column gutters use 4 / 8 / 12 / 14 / 16 / 20 / 24.
10. **Icons are 16px `currentColor`.** Use `ui-primitives` `ic_ds_*`. Dense title-bar chrome may use 14px. Do not add another icon pack or filled brand-color glyphs.
11. **Motion animates only opacity and transform.** Durations are `--ds-transition-duration*` (100–200ms, flip 400ms). New dialogs / menus use `usePresence` plus a `motion.css` recipe. Do not animate `backdrop-filter` or large-panel width/height, and do not add an animation library. Inventory and exceptions: [Motion](motion.en.md).
12. **Shadows are lv1 / lv2 / lv3 only.** Menus and dialogs use `lv3`; floating cards use `lv2`; the composer carries no outset shadow (the resting rim light plus the hairline carry the separation). No `0 18px 40px` slabs.
13. **Glass stops at the baseline recipe.** Mask `blur(2px)` (`--dsw-mask-blur`) + `--dsw-alias-bg-mask-*`; raised surfaces `color-mix(..., var(--dsw-alias-glass-opacity), transparent)`. No heavier blur, no shadow on every layer.
14. **Scrollbars are the shared sheet.** No component-local `::-webkit-scrollbar`.
15. **Product copy is Chinese; code comments are English.** Do not import VS Code / Material / iOS density or decoration over the baseline Web UI.
16. **Sidebar brand follows the baseline build.** `setup:harness` runs the vendor tree's own `pnpm run build:official` (`DSH_CLIENT_BUILD_PROFILE=official`). The sidebar shows the baseline whale mark and DeepSeek Harness wordmark, not the local-build fallback “DSH Local Build”. Rebuild client changes with that same command; a lone `build:lib:client` bakes the local-build brand back in.
17. **Code highlighting is on demand and sliced — it does not just relocate a long task.** A session with no code block constructs the syntax highlighter zero times. When code content exists, the plain source is visible, selectable, and copyable first, and the highlighted result replaces it in place; never show a placeholder. Initialization and each grammar's first tokenize are scheduled as separate background tasks: a single highlight-related main-thread task must stay under 50 ms, and moving the same long task wholesale via `requestIdleCallback` / `setTimeout` does not satisfy this. If highlighting fails or is not ready, fall back to the complete monospace source and never show highlighted output for stale input. The completed incremental Markdown caches, the streaming→settled DOM semantics, and copy text that excludes line numbers stay exactly as the baseline defines them.
18. **High-throughput terminal output is bounded, and backpressure must actually constrain the producer.** PTY output is coalesced per burst before it crosses IPC, and every frame carries a per-session monotonic sequence number. The renderer acknowledges only **after writing that frame into its own terminal session state**; acknowledging on IPC receipt does not count as consumption. The main process sets high/low watermarks on unacknowledged bytes: it pauses backend PTY reads above the ceiling and resumes once the backlog falls back to the low mark. Input writes and resize are unaffected while paused, and resuming must lose nothing and reorder nothing; the tail before exit is still flushed first. Dropping data, using an unbounded queue, or discarding only inside the renderer does not count as backpressure — if the backend cannot really be stopped, label backpressure as unfinished instead of claiming the target.

## Standalone dshbot workflows

Plugin-owned persistent sessions do not use the generic New Session brand hero.
Managed Bot and room sessions keep the real Bot/room title, composer and message
canvas. Their top chrome retains only that title plus desktop window and
sidebar/workbench panel controls; it omits the generic preset label, trajectory
switch, Session-log download, Git branch and Commit actions. Plugin bodies may
provide their own member, settings and disband controls as Hermes Bots rooms do,
without mixing development-session tools into the Bot workflow. Ordinary
session lists, search and blank-session reuse exclude plugin-owned sessions;
the plugin entry can still open every bound session.

Bot and room conversations reuse the editor, attachment, send/stop and theme
primitives. An explicit generic managed-composer presentation flag removes the
independent model picker, workspace permission shortcut, plan controls, developer
statistics and preset label. A plugin control shows the Bot profile model and
opens its editor; rooms open room settings without a fictitious shared model.
The Bot profile owns model selection, with an unset value following the current
application default. Opening a contact never changes that default. Presentation
does not bypass capability restrictions or tool approvals. Hermes provides the
shared-editor and profile-following precedent; the single profile entry point
is this product's adaptation, not a claim that Hermes removed its model picker.

When a managed composer hides the developer statistics row, it still reserves
the same footer height as an ordinary conversation so the input card keeps the
same breathing room from the viewport edge in chats, Bot conversations, and
rooms. The expanded sidebar's primary region switch fills the available width
and divides it equally between options. The Bot page's Contacts / Tasks /
Routines switch uses that same 32px-high, 8px-radius region-tab contract with a
transparent resting surface and the shared hover/selected tokens; it also fills
the available width with equal items instead of using content-width Pills. The
collapsed sidebar keeps its existing vertical circular navigation.

Room content follows the Hermes Bots thread structure instead of the ordinary
DSH transcript. Sending from the resident bottom composer creates a new thread.
The Reply action inside an expanded thread reuses that composer, attachment
upload, and submission state while continuing the target thread; cancelling
restores the prior draft and attachments. Every user/member message durably
belongs to one stable thread. Legacy unmarked records are assigned
deterministically at read time without rewriting their log. The newest thread
opens by default and does not show a redundant collapse command. Older threads
collapse to a first-message summary, reply count, and latest time; only after
opening one does its Collapse this conversation action appear. Users can expand
or collapse those historical threads independently, and every open thread shows
full member identity, attachments, failures, stopped
state, and pending interaction state. Responder selection, rounds, delivery
caps, watermarks, mention handoffs, and late-result admission are isolated to
the target thread; room-level holds persist across threads. A new thread cannot
hide a completed result from an older thread, and a thread reply cannot import
another thread or private DM history. Host/client restart resumes the original
thread, member call, and approval/question without duplicating user messages,
member messages, or tool calls. The room body integrates through a generic
Session-selectable Conversation body extension; ordinary Sessions keep the
original Chat View and the Host contains no dshbot-specific branch.

Room information hierarchy follows OpenBot's multi-Bot conversation without
copying its skin. The Host conversation header is the room's only title; the
body must not repeat the room name and member count. A compact, unframed
participant strip uses avatars for members and exposes identity and live state
through tooltips and accessible names, with settings and disband remaining as
trailing icon actions. The newest thread reads as one continuous multi-Bot
transcript without a left thread rail; only an explicitly opened historical
thread uses an indented rail to mark its boundary. Do not render an idle-status
row when every member is idle, or an Activity / No activity placeholder when
there is no runtime activity. Show the compact status/activity entry only for
running, waiting, passed, failed, stopped, or runtime-load failure states, while
keeping stop and error actions visible. Member execution outcomes without body
text, including passed, failed, timed out, held, stopped, and capped, belong in
the current thread's activity disclosure and must not masquerade as avatar-led
chat messages. Only actual user and member speech enters the transcript. OpenBot AgentGroup broadcast creates separate
background work per member and must not be presented as, or replace, this
Hermes-style shared room contract.

The room body opts into Conversation's existing composer-overlay presentation
marker. Its height is constrained between the title bar and composer, its own
scrollport owns scrolling, and the final message, thread actions, and activity
region cannot sit underneath the composer or grow the extension view beyond the
viewport. Once a plugin body owns a blank Session, the Host's ordinary blank
canvas placeholder must stop participating in flex layout and cannot take half
of the body height. A room with members but no messages uses the Hermes Bots
empty-state copy, "Say something - every bot in this group hears the room,"
rather than contact-creation or member-count guidance. The sidebar does not keep a duplicate group-runtime panel open for
normal, loading, or empty runtime data; those states remain on the group contact
row and in the room status strip. A sidebar action region appears only for a
pending approval/question, member error, or missing member Session that requires
attention.

Complete workflows add a Routines Pill with scrollable rows and the existing
Modal. Fields are name, bot, prompt, interval minutes and enabled; actions run,
enable/pause, edit and delete. Queue acceptance is not execution success.
Profile capability groups (tools, Skills, MCP tools) use SettingsSelect inherited/
selected modes and checkboxes over discovered capabilities, with unavailable and
stale selections explicit. Management links open the real Harness Skills install/
invocation, tool credential, and MCP add/enable/test/login surfaces. Skill install
shows the public repository and exact path, distinguishes user/current-project
scope, confirms before execution, never silently overwrites, and keeps missing or
outdated GitHub CLI and conflict errors in context. Search results distinguish available,
installed from the same GitHub source, and conflicting local-name states. Installed state
survives restart through durable source metadata inside the skill directory; an existing
skill with unknown provenance is never overwritten. When the Host has no Bot-scoped
resource isolation, label the scope as application-wide and confirm it instead of
drawing controls that cannot take effect. Group limits use bounded numeric inputs. Task actions
follow actual states: queued pause, paused resume, nonterminal cancellation and
new-attempt retry after failure/cancellation. Confirm cancellation/retry and whole
Bot conversation stop; stopping does not undo external side effects. All form
groups and lists fit and scroll at 320px without horizontal overflow.

Member approvals and clarification requests appear on that member's row in the Bot page group runtime instead of forcing the user to find a hidden member Session. Approval offers reject and allow once. Questions retain the complete batch, single and multi-select choices, custom answers, skip and cancel, and settle the original Harness pending interaction through its own `answer()` / `cancel()`. The stable request id in the Session log owns pending state. After a Host or desktop restart, the same request is rehydrated and an idempotent response continues the original turn, step, and tool call without resending the user message or duplicating tool execution. External tool execution that may already have started but has no durable result fails closed instead of repeating a side effect. The UI never duplicates a request, preselects an answer the user did not choose, or marks an interaction complete while it is still waiting. Only when the real pending carrier is unavailable may the UI offer an explicit fallback that opens the exact member Session and states the error.

An independently installed dshbot follows this language without changing desktop defaults or marketplace recommendations. Its page switches Contacts / Tasks / Routines with the same primary region-tab contract. Tasks use compact scrollable rows, Input search and SettingsSelect status filtering, not metric cards. A centered Modal shows status, participants, task, constraints, success criteria, result/error, timestamps and event history. Explicit buttons open participant conversations; the right-side surfaces remain unchanged. Long names, IDs and content wrap on narrow screens. Status maps exactly to queued / delivered / completed / failed / expired; delivered never means running. Do not show cancellation, retry or pause without an executor operation.

The bot editor uses SettingsSelect for message/task sources: Default rules or Selected bots, with checkboxes for existing contacts. Default rules allow messages and restrict delegation to shared-room peers. A nonempty selected list restricts both messages and delegation, including shared-room peers. An empty list cannot mean deny-all. Loading, unavailable, read-only, save errors and revision conflicts use ordinary status/error rows, never false emptiness or success. Reuse existing avatars, semantic tokens, primitives and motion; no new palette or sidebar skin.

Deterministic Bot shape avatars follow Hermes Bots' stateful live-face behavior: idle uses only low-amplitude breathing, sway, and natural blinking; a running bound Session or room member switches to a stronger pose, gaze, and three-dot work rhythm. The currently selected contact adds a two-layer ring using existing border and business-color tokens. All shape avatars share one visibility-aware clock capped at 15fps and stop updating while the window is hidden, offscreen, or no faces are mounted; `prefers-reduced-motion` keeps them static. User-uploaded image avatars must not stretch or deform and retain only the selection ring and existing status dot. This does not restore avatar generation.

Tool, Skill, and MCP capability groups stay compact in the bot profile: the main form shows only the mode, authorization scope, selection summary, and a Select command; individual checkboxes are edited in the shared `Modal` surface. The picker must scroll without horizontal overflow at 320px. Cancel discards picker changes, Done writes only to the profile draft, and the profile Save action remains the persistence boundary.

## Visual anchors

Plugin-owned persistent conversations keep the existing session header, transcript
canvas and docked composer even before the first message. Show the actual owner
title, never the generic New Session brand hero or a workspace-selection gate.
Ordinary lists/search and blank-session reuse exclude plugin-owned conversations;
their plugin entry still opens the same Session. No second chat engine or cards.

Check against the baseline — the baseline is the pinned Web UI served by a local `npm start`, not some version from memory or screenshots: bluish-neutral sidebar, clean conversation canvas, pale-blue user bubble, hairline dividers, capsule primary, 16px outline icons, menu radius 12 with a light shadow. A new block dropped onto any DSHD surface must not read as a different product.

| Role | Token / geometry |
| --- | --- |
| Canvas | `--dsw-alias-bg-base` |
| Sidebar | `--dsw-specific-sidebar-fill`; the rail chrome resolves it through the `--dsh-sidebar-rail-fill` indirection, which Appearance「Hide sidebar mask」rebinds to `transparent`: the frame canvas shows through for an exact workspace match, only the right-edge divider stays |
| Raised layers | `--dsw-alias-bg-layer-1`–`3` |
| Terminal well | `--dsw-alias-terminal-pane`; under a live backdrop it mixes by its own「Terminal opacity」slider (40–100, default 75) instead of following the glass slider — below 75 the settings page only hints about TUI selection readability, no clamp |
| Primary / secondary / caption text | `--dsw-alias-label-primary` / `secondary` / `tertiary` |
| User bubble | `--dsw-specific-bubble` |
| Selected row | `--dsw-specific-sidebar-nav-item-active` (accent variant `*-accent`) |
| Font stack | `--dsw-font-family` (system UI + PingFang / YaHei); code `--ds-font-family-code` |

Layout: `AppFrame` is columns, not a card grid. A closed column is width 0 and paints no divider. The title-bar trailing cluster is 28×28 icon buttons with measured window-control inset — do not draw a second window skin. Non-conversation `main` slot panels (the plugin manager and peers) mount only in the content row below the title-bar row, inside `AppFrame`'s `mainPanel` container; `conversation` is the sole panel spanning both rows with its own subgrid, and no other panel may reach into the title-bar row. Desktop has exactly **one visible right panel**: `ui-sidebar-right` is its sole presentation owner, and `Ctrl+\` plus the titlebar right-panel button toggle that same panel; upstream's `surfaces` track survives only as a zero-width dormant compatibility seam, and no Desktop package may register an occupant in it or reopen it. The native Sidebar guide, not the retired `ui-surfaces/EmptyState` card wall, is the right-panel start page; the old empty-state geometry contract is void from this version on. A surfaces tab keeps its close control **to the right of the title**; do not move it unless the user explicitly asks. Primary clicks on workspace files and artifacts stay inside the application work loop: HTML / HTM / XHTML / PDF open in the right-column Browser and other readable files open in the right-column Document Preview. The floating preview in the unified Sidebar document header is an explicit secondary action; the system default application is reserved for context-menu commands or paths outside workspace authority. The floating preview is one read-only, always-on-top native child window: keep the system title bar and close hit target, paint the content directly with the official Web UI canvas / `--dsw-alias-*` tokens, and add neither a card wrapper nor a second shell skin. Images and audio/video stay centered with contain sizing; text, HTML, and PDF fill a scrollable content area; opening another file replaces the current occupant in place. It is a different layer from DockKit's in-page float, which never creates a native window.

Composer: the `InputBar` capsule (radius 22) carries a resting rim light of its own — `inset 0 0 12px 1px rgba(255, 255, 255, 0.25)`, wrapping all four edges and corners evenly (an inset light follows `border-radius` natively; on the light theme white-on-white simply disappears, so no theme branch is written). The card carries no outset shadow — elevation-soft stays off the input bar, and the rim plus the hairline carry the separation; bright wallpaper areas showing through the glass are ambient additions only. The running composer beam follows the Libraries.dev Border Beam Rotate / Large / Colorful hierarchy on top of this rim: its unfiltered hit-test shell expands 4px beyond the card and keeps `overflow: hidden`; the 22px stroke and inner layer inset back to the card edge, the stroke runs at 0.6 opacity while the inner layer shares the rotating window, and an outer container applies `blur(8px)` to the masked bloom source at 0.36 opacity. Four pixels stays inside the composer stack's 6px gap, so the effect does not paint over the dock. The blank-session Hero workspace / agent-preset row shares the input card's effective width axis: it reads `--dsh-composer-resized-width` when a saved width exists, falls back to `--dsh-composer-card-max-width`, and stays centered inside the composer stack instead of remaining on the full-width wrapper's left edge. The resting/running hierarchy comes from the traveling filament, not a new palette. Wallpaper mode paints no seat band behind the composer: the input card and stats strip sit directly on the wallpaper — any banded fill reads as a cast shadow cast by the box.

The composer beam is not a permanently colored perimeter: its 2px stroke uses the reference rotating conic intensity window, the inner layer uses a same-direction dual-conic window, and both may be transparent outside the trail. The moving filament / bloom is the only high-intensity peak, while the resting rim keeps the four edges and corners continuously defined. Corner acceptance is measured **over a full rotation**: across 24 frozen angles, the peak must traverse each 22px corner arc without a flat cut or gap and remain continuous with the adjacent edges; the cycle must also contain dark frames so the effect cannot regress into an equally bright neon ring. The stroke keeps `border-radius + the two-layer ring mask` and must not add a second antialiased `clip-path`.

The composer card and its beam clip shell, stroke, inner light, and bloom source explicitly use `corner-shape: round`, opting out of the global superellipse. Shared circular geometry preserves the inset resting rim and matches the inner light's circular clip. The stroke increases to 2px to cover antialiased corner pixels at 100% display scaling; the bloom source stays 1.5px. Pixel acceptance must load the production corner stylesheet, normalize display scaling, and check resting corner coverage as well as the moving peak.

The Interface setting "Thinking glow when sending" keeps its immediate Switch and adds a 28px settings-icon button immediately before it to open the official `Modal`; the Switch right edge must share the same alignment line as the other settings rows and must not move left when the gear is present. The first batch exposes clockwise/counterclockwise/ping-pong direction, a 0.8–60s rotation period, overall intensity, bloom intensity, global hue offset, breathing, and hue cycling. The second batch adds lounge / aurora / reactive / custom modes, eight built-in palettes or 2–6 custom colors, a 0.5–4px stroke track width, 0–12px bloom blur, a night window and dim amount, easing, up to five user presets, and v1 JSON clipboard import/export. The dialog previews the same beam layers live; Save persists the active style and preset library through one `ui-conversation` namespace mutation, Cancel leaves the current value untouched, and Reset restores the historical 1.96s / direction / intensity / hue legacy baseline. Modes are visual / motion profiles only: they do not read focus, typing, send, completion, error, or other business states and do not grow into a second state-light system.

Track width and bloom blur are configurable, but the 1.5px bloom light source, 4px clip shell, 22px corners, two-layer ring mask, pointer-events contract, and intensity windows remain fixed; the legacy defaults must remain equivalent to the previous rendering. Reduced motion hides both preview and live beam while retaining the saved values; mobile continues to use the default timing values and does not inherit desktop customization.

The background effect "flowing gradient" is the ambient backdrop when no wallpaper image is set: it reuses the wallpaper fixed layer with a linear-gradient wash and one to five looping displacement blooms, with `mix-blend-mode: hard-light` collected inside one blurred container. Default colors come only from the new `--dsw-specific-gradient-*` tokens in the theme table (`design-platform.css`, one set per light/dark half). On the settings side it is a collapsed Appearance row (title + description + gear + Switch, the same footprint as the input-effect row); the gear opens a `Modal` with a live preview, preset scheme cards (Follow theme / Aurora / Sunset / Ocean / Sakura — presets write colors only), always-visible custom controls (seven color slots falling back to tokens, 20–300% speed applied as a keyframe-duration divisor, 1–5 blooms, and a bloom shape — orbs / aurora ribbons / chaos / rays — switched via `#dsh-gradient[data-variant]`, still transform-only), and Reset / Cancel / Save. Bloom animation moves transform only (20–40s baselines, see the indicator families in [motion rules](motion.en.md)) and stops entirely under `prefers-reduced-motion`. With a wallpaper set the effect is paused and not painted; the effect is not a wallpaper, and the transparent theme still requires an image. The effect shares the wallpaper's `--dsw-alias-bg-mask-1` dim mask and glass-opacity surface mixing — no second mask system; the composer seat band opens up for it the same way, and the chat scrollbar thumb stays hidden until hovered. Its controls stay out of the wallpaper row and out of the page body.

Cursor effects are the pointer-driven decoration layer: a fixed fullscreen overlay (`#dsh-cursor-fx`, `pointer-events` fully pass-through, painted above the whole UI) hosts one of two engines — "pixel trail" stamps grid cells along the pointer path that fade out (2D canvas, the ReactBits `PixelTrail` equivalent port), and "fluid splash" injects pointer motion into a WebGL Navier-Stokes dye simulation (ported from ReactBits `SplashCursor`). On the settings side it is the same collapsed row (title + description + gear + Switch); the gear opens a `Modal` with effect-kind cards, a live canvas preview, preset scheme cards (Follow theme / Rainbow / Aurora / Sunset / Ocean / Sakura — presets write the whole colors + speed + size bundle), always-visible custom controls (six color slots falling back to the theme accent, 20–300% speed, 25–300% size), and Reset / Cancel / Save. The Switch only writes the enabled flag; the chosen effect and slider values survive while off. The layer never mounts under `prefers-reduced-motion`, and without Canvas 2D / WebGL the engines fail closed with no DOM residue. The rAF loop idles out 4s after the last input and pauses while the document is hidden; an empty palette resolves `--dsw-alias-brand-primary`, and controls and cards only consume `--dsw-alias-*` tokens — no color literals, no light/dark branches, no animation library.

Button-hover metallic paint (`metallic-paint.css`, a CSS port of the ayase motion MetallicPaint recipe) is the single global additive hover layer: hovering a non-disabled native `button` inside the main Web UI overlays a translucent `linear-gradient` band (115deg, 320% size, a 4.5s ease-in-out back-and-forth sweep) on top of the original hover fill — "original effect + paint" stacking, never a replacement. The sweep paints on the button's own `background-image`: it clips naturally to the control's `border-radius` (including the global corner-shape), does not touch `position` / `overflow`, and occupies neither `::before` nor `::after`. The band takes its colors only through `color-mix` over label alias token alpha: bright band `--dsw-alias-label-primary-foreground` (primary-button text color, naturally contrasting the fill, protecting icon legibility), dark band `--dsw-alias-label-primary`, transition band `--dsw-alias-label-secondary` — no color literals, no light/dark branches, automatically inverting with the theme and tinting with custom themes. Coverage stops at native `button`: `role='button'` rows (DisclosureRow / ToolRow / command cards), `<select>` / `<input>`, the boot page, the launcher, the wallpaper gallery window, and mobile/web are not swept. `prefers-reduced-motion` stops the sweep but keeps the static sheen. The Appearance "Button sheen" switch (`metallicPaintEnabled`, default on) toggles the `data-dsh-metallic-paint` attribute on the document root — off makes the sheen rules not match at all, leaving only the plain hover fill.

## Allowed exceptions

- **xterm / diff / code**: monospace, ANSI, character grid — not capsules.
- **Native window controls**: min / max / close keep system hit targets; paint still follows theme tokens.
- **Shells that cannot import the theme package** (remote login page, mobile Web SPA, Android Compose): reuse the same semantic colors and geometry. The mobile SPA copies `--dsw-alias-*` into `mobile/web/tokens.css`; Android copies it into the Compose `DshTokens` / `Color` tables under `mobile/android`. None of them mount official CSS Modules or carry the boot `--boot-*` canvas. Do not open a parallel `--bg` / `--accent` palette, and do not let Material default purple or dynamic color override the semantic tables. Action labels on the Git capsule (Commit / Push / Pull …) stay in English.
- **Desktop boot page**: a full-window instrument canvas and a dedicated `--boot-*` table; see [Desktop boot page](#desktop-boot-page).

## Mobile remote interaction

Remote Web and the Android bundled SPA are a narrow-screen reflow of desktop
Harness, not a second mobile design system. The conversation canvas, sidebar
hierarchy, user bubble, InputBar, permission/model triggers, Menu rows, Modal
heading/actions and Git split control inherit the desktop roles, tokens,
typography, radius and selection treatment. Width may change direction,
visible labels and scroll containers only. Do not apply Material, iOS or generic
mobile-app chrome such as oversized app bars, large attached sheets, equal-width
action pairs or pill tab bars.

Permissions, models, attachment sources, Git actions and row actions must still
read as desktop popovers/Menus on a phone: use `--dsw-specific-menu`, 20px radius,
4px inset padding, 40px rows and trailing checks, anchored near the trigger when
possible. When space is constrained, fit against the viewport and scroll inside;
do not turn them into native bottom sheets with a separate 52px title bar.
Settings, directory browsing and Git forms are full-screen tasks, while their
titles, 28px icon buttons, fields, segments and 36px capsule actions remain the
desktop primitives. Destructive confirmation retains the desktop Modal's 24px
radius, title/body spacing and right-aligned actions; narrow screens only reduce
the outer margin.

The mobile conversation header compresses the desktop conversation header: title
and metadata own the main axis, Git retains its 32px split-control/pill semantics,
and only the menu icon receives a transparent larger hit area. The resident
composer retains desktop InputBar's 22px radius, inset rim, 28px attachment circle,
28px permission/model triggers and circular send control. Narrow layouts first
hide secondary copy and may use the desktop tool groups' existing wrap behavior;
do not fill triggers into large grey pills or introduce a separate mobile toolbar.

Independent touch targets are at least 44 CSS px on Web and 48dp on Android,
while icons retain the baseline 16px geometry. Mobile editing controls use
16px/24px typography. Long model labels may ellipsize but must not become only
an arrow; the picker exposes the full current choice and reasoning effort.
Preserve user zoom, text selection and horizontal code/table scrolling.

Screen, browser and Android Back share one navigation hierarchy. System Back
first dismisses an open keyboard. Restore focus without reopening the editor
keyboard, and make covered content inert. History contains no credentials or
draft text and never replays writes. Keep success and retryable errors in their
task; dismissing approval details is not a rejection. Reading may collapse a
long draft without losing its contents or selection. Use baseline transform and
opacity motion tokens, with no animation under reduced motion.

Android keeps the stable asset origin and shared Web sources. Native code owns
only navigation hosting, scanning/media capture, keyboard and lifecycle duties.
Web and Android have separate acceptance evidence; historical exclusions are not
passing results for the new delivery.

## SSH remote workspace

Remote Workspace adds flows within desktop settings and the directory picker. It uses the Harness Web UI settings rows, segmented controls, inputs, menus, modals, and sidebar file primitives. The picker's Local / Remote tabs share the existing local browser hierarchy; when the remote feature is off or the plugin is absent, only the existing local flow appears. Machine forms, path completion, file conflicts, and connection errors use `ui-primitives` and ordinary `--dsw-alias-*` state feedback. They do not introduce separate desktop chrome, a card grid, or another palette.

The remote file page uses the existing sidebar tabs and file editor layout. The close control stays to the right of the title. Connection state, host-key rejection, and write conflicts must explain the issue in place and offer the corresponding action; failures must not appear as empty lists. This SSH mirror feature does not reuse the mobile pairing Remote settings section or its visual layer.

## Desktop boot page

The boot page is one instrument canvas for the whole window. It is not a centered card, and the log is not locked in a bordered box. Sources: [`boot.html`](../src/renderer/boot.html), [`boot.css`](../src/renderer/boot.css), [`boot-tokens.css`](../src/renderer/boot-tokens.css), [`boot.js`](../src/renderer/boot.js).

Layout: L-shaped targeting rails sit on the viewport corners. The center stack is the whale spinning loader ([`assets/whale-spin.svg`](../assets/whale-spin.svg), a 2-second loop at 112px with `.mark` lifted above the scanline overlay; `prefers-reduced-motion` swaps in the static [`assets/whale-head.png`](../assets/whale-head.png) head), the brand `Deepseek-Harness-Desktop`, status and hint, and square retry and download-log buttons on failure. The top bar shows `DSH-DESKTOP` on the left and a stamp on the right that follows `body[data-state]`: 启动中 / 就绪 / 停止中 / 异常, coded BOOT / READY / HALT / ERROR. The bottom-left monospace log sits on the canvas with no border or fill; long lines wrap. Type is 14/22. Lines stack upward from the bottom; `--boot-log-inset` clears the corner rails on the bottom and left. Overflow clips older lines at the top so the newest line stays fully visible. After the runtime is ready, baseline client-plugin loading stays on this canvas (the status line reads `正在加载插件 n/m`). A background BrowserView finishes loading, then the Web UI is revealed; the baseline's “正在加载插件” page is not shown.

Color and theme: [`boot-tokens.css`](../src/renderer/boot-tokens.css) is the only color table. Light is paper near-black; dark is CRT near-white. `--boot-accent` matches body ink; failure uses `--boot-alert`. `html[data-boot-theme]` makes [`theme.js`](../src/renderer/theme.js) apply only the light/dark half of `theme.scheme` and skip the user's `bg` / `accent`. [`boot.css`](../src/renderer/boot.css) consumes `--boot-*` plus baseline font and motion tokens; it does not branch on `[data-ds-dark-theme]` and does not contain color literals.

Window controls stay on [`window-controls.css`](../src/renderer/window-controls.css). Do not use NERV / MAGI / SEELE / EVA marks or official logos. Do not use `--boot-*` on settings, the closing overlay, the title bar, or the Web UI.

## Desktop pet

The desktop pet is a constrained overlay owned by the Desktop shell — not a boot-page decoration, and not a Harness Web UI plugin or DOM injection. It appears only after Harness is ready/revealed; during boot, the launcher, the closing overlay, restarts, and Harness teardown it must hide and destroy its own BrowserView.

- The pet BrowserView covers only a small ~80–96px rectangle, avoids the top titlebar, and re-clamps after window resize, maximize, and restore; a full-window transparent BrowserView is forbidden, and transparent regions must not swallow Harness clicks.
- Visual assets may reuse the repo's existing brand vector assets; the container is transparent, and colors, font, radius, and feedback only reference `src/shared/dsh-webui-tokens.css` and existing motion tokens — no `--boot-*`, no separate palette.
- The interaction surface stays click feedback (wave), drag positioning (walk), and a right-click menu (choose a discovered Codex pet or hide the pet). The tray offers a「桌面宠物」checkbox; state persists only `{ enabled, xRatio, yRatio, petId }` with normalized coordinates, abnormal values fall back to safe defaults, and transient expressions are never persisted. A missing or invalid `petId` automatically falls back to an available Codex pet or the built-in placeholder asset.
- The pet accepts `pet.json` plus its adjacent atlas under `${CODEX_HOME:-$HOME/.codex}/pets/<pet-id>/`, reading both Codex v1 `1536x1872 / 8x9` and Desktop v2 `1536x2288 / 8x11`; v2 is confirmed by `spriteVersionNumber: 2` or dimensions. Absolute paths and `..` traversal are forbidden.
- The pet preload exposes only initial-state read, state subscription, normalized-position commit, the right-click menu, and theme subscription; the main process validates IPC by the exact pet BrowserView sender and the `pet.html` main frame. It must not reuse Harness workspace, Git, file, remote, or plugin permissions.
- Under `prefers-reduced-motion` feedback snaps into place; Codex atlas row animations (idle loop, one-shot state rows, v2 hover gaze) are the only persistent animations — the placeholder asset still uses only short opacity/transform feedback, and no second desktop skin is added.

### Live2D whale-girl dialogue bubble

The Live2D desktop pet (`desktop-live2d-pet`) is a standalone transparent `BrowserWindow` overlay — a different form from the retired Codex-pet `BrowserView` (`desktop-pet`): the former is a fully transparent window painting its own Canvas, the latter a small rectangle view hosted inside the main window.

The whale-girl dialogue bubble anchors to the character's head and shares her Canvas; the rounded body and the small tail pointing at the character must be one continuous closed outline — a single fill and a single stroke, never a second strokeless triangle covering the box outline. When headroom is insufficient the bubble flips below the character; the whole bubble (tail and stroke included) stays clamped to the current display. It uses the shared theme tokens layer-1 / border-l2 / label-primary and `--dsw-font-family`: 9px radius, 12px font / 16px line-height, 9px horizontal padding, about 6px top and bottom (`bh = lines × 16 + 12`), text vertically centered via `textBaseline: middle`; it does not enlarge the pet's interaction hit area.

## Desktop launcher

The Recovery Board distinguishes session projection-cache schema failures from user-plugin failures in its existing verdict text. Cache diagnostics take precedence over skip-mode status, add no panel or controls, and never recommend clearing original sessions.

The launcher is the cold-start gate window, not the instrument canvas. Sources: [`launcher.html`](../src/renderer/launcher.html), [`launcher.css`](../src/renderer/launcher.css), [`launcher.js`](../src/renderer/launcher.js). Color comes from the baseline light `:root` and dark `html[data-ds-dark-theme]` tables in [`dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css). `html[data-shell-theme=official]` makes [`theme.js`](../src/renderer/theme.js) apply only the light/dark half of `theme.scheme` and skip Appearance wallpaper seeds on `--dsw-alias-*`. Do not use `--boot-*` or `data-boot-theme`, and do not add a second `[data-theme]` / `prefers-color-scheme` palette in `launcher.css`.

## Known drift (do not spread)

Product pages use this language's tokens and `ui-primitives`. Mobile remote Web (`mobile/web`) is a documented exception: it copies `--dsw-alias-*`, does not embed the baseline plugin tree, and does not use the boot instrument canvas. The Settings marketplace is the desktop-owned `ui-settings-market` package's `settings.section` (id `market`) and must use the same tokens / primitives as the baseline settings pages. The usage-stats panel is the preinstalled reworked `dsh-usage-panel` (id `usage-stats`) and must use the same tokens / primitives as the baseline settings pages, not the upstream plugin palette. Do not open a `--bg` / `--accent` palette. The desktop boot page is the documented instrument-canvas exception; see [Desktop boot page](#desktop-boot-page). Do not spread that sheet. The cold-start launcher uses baseline tokens; see [Desktop launcher](#desktop-launcher). It is not a second exception.

### Marketplace feature migration

The marketplace extension uses the "Discover / Favorites / Installed / Activity" tabs. Sorting and time-range controls reuse Menu, and favorites use icon buttons with Tooltip;
details and install / uninstall / batch-update confirmations use the ui-primitives Modal. Details show catalog screenshots (fixed ratio, contain), source, and homepage,
without upstream styles or untrusted HTML; README renders through the existing MarkdownText primitive. Activity uses a compact list with expandable plain-text logs, and batch updates run serially with a single restart at the end.

## Self-check

Before shipping a UI change:

- [ ] Hand-rolled a button / menu / dialog that a primitive already covers?
- [ ] Color literals or a second CSS-variable sheet in feature CSS?
- [ ] Radius, height, or type pair off the table above?
- [ ] Dark-mode branch inside the component?
- [ ] New overlay without `usePresence` / a baseline recipe?
- [ ] Reads as another IDE or phone skin instead of the pinned baseline (the Web UI rendered by `vendor/deepseek-harness`)?
