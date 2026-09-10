# DSHD design language

[中文](design-language.md) · English

DSHD (Deepseek-Harness-Desktop — the desktop application in this repository; distinct from the `dsh` CLI and from the dshd daemon in `src/main`) defines its design language in this document: it is the sole visual authority for every visible surface of DSHD. The language's baseline is pinned to the vendored `vendor/deepseek-harness` Web UI — currently `dsh-v0.1.3-alpha.1` (`d347e703908d0406b7a7ef80e3a0e594d86b2215`), recorded in [`vendor/harness-upstream.json`](../vendor/harness-upstream.json) and updated by `npm run sync:harness`. The desktop chrome, closing overlay, title-bar injection, right-hand surfaces, the Web UI page opened by phone remote, and any new frontend all implement the same language. Do not invent a second skin.

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

## Scope

Any change to a visible surface is in scope, including:

- `vendor/deepseek-harness/packages/client/**`, `apps/web/**`
- `src/renderer/**`, `src/main/closing-overlay.js`, `src/main/harness-chrome-inject.js`

Terminal, diff, and code blocks keep the baseline monospace / no-wrap rules. That is content typography, not a second chrome language.

## Hard rules

The model control automatically loads the current selection when entering or returning to an existing conversation, without requiring the model menu to open. Sending a message or remounting the control must not turn a saved model into "Select model". Initial synchronization reuses the loading label; a missing catalog display name uses the provider/model id. Controls, styling, and draft-page behavior stay unchanged.

Message editing reuses the resident composer, edit banner, and bubble marker. Confirm always regenerates within the current conversation, including its first message; the sidebar neither adds nor switches conversations, and Chat hides the superseded turn. Cancel and failure retain the existing draft restoration and notice styling.

Submitting a draft moves the resident composer continuously into its conversation position without a bottom flash or rebound. Transcript, statistics, and input-size updates must not expose intermediate layouts. Reuse existing motion duration and easing; reduced motion settles immediately. Decoration and final geometry remain unchanged.

The mobile remote connect screen reuses its device status and error lines: pairing and saved-device reconnect show a connecting state; failure shows a failed state and restores connection controls without deleting saved devices. Never leave the waiting-for-pairing label during a connection or disable controls indefinitely. Automatic recovery after an established connection remains unchanged.

Web and Android share recovery states: indicate catalog synchronization after authentication and offer Retry beneath the existing drawer error, never a false empty catalog. A new offer supersedes an older attempt; successful pairing removes the one-time fragment. Foreground recovery retains drafts and checks the connection before resynchronizing the catalog and open conversation. Reuse existing controls and status bars.

Remote connection mode uses the existing segmented control with LAN / Server labels. Server is the default; LAN remains an explicit manual choice. Layout, colors, and the pairing protocol stay unchanged.

The plugin marketplace does not inject a first-party dshbot recommendation card. Registry sources, card primitives, and generic plugin management stay unchanged.

1. **Reuse before drawing.** Buttons, fields, menus, dialogs, tooltips, and disclosure rows use `ui-primitives`. Do not restyle their radius, height, or hover.
2. **Colors are `--dsw-alias-*` / `--dsw-specific-*` only.** Feature CSS must not contain `#hex`, `rgb()`, or a private `--bg` / `--accent` sheet. Missing tokens are added to the theme sheets first, then consumed as semantic aliases.
3. **Light/dark lives only in the theme tables.** Feature CSS must not branch on `[data-theme]`, `[data-ds-dark-theme]`, or `prefers-color-scheme`.
4. **The accent is not electric blue.** Default primary buttons are near-black (light) / near-white (dark): `--dsw-alias-button-primary-fill` (`rgb(15, 17, 21)` in light). Brand blue is `--dsw-static-deepseek-500` (`rgb(65, 118, 230)`) and its aliases (`--dsw-alias-button-info-fill`, `--dsw-alias-state-business-primary`) for info emphasis, user bubbles, and selection. Do not introduce `#2b5cff`, `#6ea8ff`, or `#3964fe`.
5. **Borders are alpha, not solid gray.** Light `rgba(0,0,0,.04/.10/.12)`, dark `rgba(255,255,255,.06/.12/.16)` — `--dsw-alias-border-l1`–`l3`. Columns are separated by a 1px hairline, not a wall of shadowed cards.
6. **Hover / active use the interactive tokens.** Light `rgba(38, 49, 72, .06 / .10)`, dark `rgba(255,255,255,.08 / .14)`: `--dsw-alias-interactive-bg-hover` / `active`. Do not mint a new solid gray wash.
7. **Radius by role.** Primary capsule 18 (height 36) / compact 14 (height 28); input 8; menu 12; dialog 24; tooltip 8; icon hit-target 8. No 6px rectangles; no 999px except capsules and switches.
8. **Font size always pairs with line-height.** Title 16/24, body 14/22, compact 12/18, tooltip 13/20. Weights 400 / 500 / 600 / 700; Figma 510 renders as 500. No `font-weight: 650`.
9. **Spacing is a multiple of 4.** Padding, gap, and column gutters use 4 / 8 / 12 / 14 / 16 / 20 / 24.
10. **Icons are 16px `currentColor`.** Use `ui-primitives` `ic_ds_*`. Dense title-bar chrome may use 14px. Do not add another icon pack or filled brand-color glyphs.
11. **Motion animates only opacity and transform.** Durations are `--ds-transition-duration*` (100–200ms, flip 400ms). New dialogs / menus use `usePresence` plus a `motion.css` recipe. Do not animate `backdrop-filter` or large-panel width/height, and do not add an animation library. Inventory and exceptions: [Motion](motion.en.md).
12. **Shadows are lv1 / lv2 / lv3 only.** Menus and dialogs use `lv3`; floating cards use `lv2`; the composer carries no outset shadow (the resting rim light plus the hairline carry the separation). No `0 18px 40px` slabs.
13. **Glass stops at the baseline recipe.** Mask `blur(2px)` (`--dsw-mask-blur`) + `--dsw-alias-bg-mask-*`; raised surfaces `color-mix(..., var(--dsw-alias-glass-opacity), transparent)`. No heavier blur, no shadow on every layer.
14. **Scrollbars are the shared sheet.** No component-local `::-webkit-scrollbar`.
15. **Product copy is Chinese; code comments are English.** Do not import VS Code / Material / iOS density or decoration over the baseline Web UI.
16. **Sidebar brand follows the baseline build.** `setup:harness` runs the vendor tree's own `pnpm run build:official` (`DSH_CLIENT_BUILD_PROFILE=official`). The sidebar shows the baseline whale mark and DeepSeek Harness wordmark, not the local-build fallback “DSH Local Build”. Rebuild client changes with that same command; a lone `build:lib:client` bakes the local-build brand back in.

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
| Sidebar | `--dsw-specific-sidebar-fill` |
| Raised layers | `--dsw-alias-bg-layer-1`–`3` |
| Primary / secondary / caption text | `--dsw-alias-label-primary` / `secondary` / `tertiary` |
| User bubble | `--dsw-specific-bubble` |
| Selected row | `--dsw-specific-sidebar-nav-item-active` (accent variant `*-accent`) |
| Font stack | `--dsw-font-family` (system UI + PingFang / YaHei); code `--ds-font-family-code` |

Layout: `AppFrame` is columns, not a card grid. A closed column is width 0 and paints no divider. The title-bar trailing cluster is 28×28 icon buttons with measured window-control inset — do not draw a second window skin. A surfaces tab keeps its close control **to the right of the title**; do not move it unless the user explicitly asks. The right-column empty-state picker cards (`EmptyState` in `ui-surfaces`) are centered **square tiles**: two columns, inner max-width 320, `aspect-ratio: 1 / 1`, 8px gaps, radius 12, with icon / title / description stacked and centered — not horizontal strips. Primary clicks on workspace files and artifacts stay inside the application work loop: HTML / HTM / XHTML / PDF open in the right-column Browser and other readable files open in Files. The Files toolbar floating preview is an explicit secondary action; the system default application is reserved for context-menu commands or paths outside workspace authority. The Files floating preview is one read-only, always-on-top native child window: keep the system title bar and close hit target, paint the content directly with the official Web UI canvas / `--dsw-alias-*` tokens, and add neither a card wrapper nor a second shell skin. Images and audio/video stay centered with contain sizing; text, HTML, and PDF fill a scrollable content area; opening another file replaces the current occupant in place.

Composer: the `InputBar` capsule (radius 22) carries a resting rim light of its own — `inset 0 0 12px 1px rgba(255, 255, 255, 0.25)`, wrapping all four edges and corners evenly (an inset light follows `border-radius` natively; on the light theme white-on-white simply disappears, so no theme branch is written). The card carries no outset shadow — elevation-soft stays off the input bar, and the rim plus the hairline carry the separation; bright wallpaper areas showing through the glass are ambient additions only. The running composer beam follows the Libraries.dev Border Beam Rotate / Large / Colorful hierarchy on top of this rim: its unfiltered hit-test shell expands 4px beyond the card and keeps `overflow: hidden`; the 22px stroke and inner layer inset back to the card edge, the stroke runs at 0.6 opacity while the inner layer shares the rotating window, and an outer container applies `blur(8px)` to the masked bloom source at 0.36 opacity. Four pixels stays inside the composer stack's 6px gap, so the effect does not paint over the dock. The blank-session Hero workspace / agent-preset row shares the input card's effective width axis: it reads `--dsh-composer-resized-width` when a saved width exists, falls back to `--dsh-composer-card-max-width`, and stays centered inside the composer stack instead of remaining on the full-width wrapper's left edge. The resting/running hierarchy comes from the traveling filament, not a new palette. Wallpaper mode paints no seat band behind the composer: the input card and stats strip sit directly on the wallpaper — any banded fill reads as a cast shadow cast by the box.

The composer beam is not a permanently colored perimeter: its 2px stroke uses the reference rotating conic intensity window, the inner layer uses a same-direction dual-conic window, and both may be transparent outside the trail. The moving filament / bloom is the only high-intensity peak, while the resting rim keeps the four edges and corners continuously defined. Corner acceptance is measured **over a full rotation**: across 24 frozen angles, the peak must traverse each 22px corner arc without a flat cut or gap and remain continuous with the adjacent edges; the cycle must also contain dark frames so the effect cannot regress into an equally bright neon ring. The stroke keeps `border-radius + the two-layer ring mask` and must not add a second antialiased `clip-path`.

The composer card and its beam clip shell, stroke, inner light, and bloom source explicitly use `corner-shape: round`, opting out of the global superellipse. Shared circular geometry preserves the inset resting rim and matches the inner light's circular clip. The stroke increases to 2px to cover antialiased corner pixels at 100% display scaling; the bloom source stays 1.5px. Pixel acceptance must load the production corner stylesheet, normalize display scaling, and check resting corner coverage as well as the moving peak.

The Interface setting "Thinking glow when sending" keeps its immediate Switch and adds a 28px settings-icon button immediately before it to open the official `Modal`; the Switch right edge must share the same alignment line as the other settings rows and must not move left when the gear is present. The first batch exposes clockwise/counterclockwise/ping-pong direction, a 0.8–60s rotation period, overall intensity, bloom intensity, global hue offset, breathing, and hue cycling. The second batch adds lounge / aurora / reactive / custom modes, eight built-in palettes or 2–6 custom colors, a 0.5–4px stroke track width, 0–12px bloom blur, a night window and dim amount, easing, up to five user presets, and v1 JSON clipboard import/export. The dialog previews the same beam layers live; Save persists the active style and preset library through one `ui-conversation` namespace mutation, Cancel leaves the current value untouched, and Reset restores the historical 1.96s / direction / intensity / hue legacy baseline. Modes are visual / motion profiles only: they do not read focus, typing, send, completion, error, or other business states and do not grow into a second state-light system.

Track width and bloom blur are configurable, but the 1.5px bloom light source, 4px clip shell, 22px corners, two-layer ring mask, pointer-events contract, and intensity windows remain fixed; the legacy defaults must remain equivalent to the previous rendering. Reduced motion hides both preview and live beam while retaining the saved values; mobile continues to use the default timing values and does not inherit desktop customization.

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

## Desktop boot page

The boot page is one instrument canvas for the whole window. It is not a centered card, and the log is not locked in a bordered box. Sources: [`boot.html`](../src/renderer/boot.html), [`boot.css`](../src/renderer/boot.css), [`boot-tokens.css`](../src/renderer/boot-tokens.css), [`boot.js`](../src/renderer/boot.js).

Layout: L-shaped targeting rails sit on the viewport corners. The center stack is the DeepSeek mark, the brand `Deepseek-Harness-Desktop`, status and hint, and square retry and download-log buttons on failure. The top bar shows `DSH-DESKTOP` on the left and a stamp on the right that follows `body[data-state]`: 启动中 / 就绪 / 停止中 / 异常, coded BOOT / READY / HALT / ERROR. The bottom-left monospace log sits on the canvas with no border or fill; long lines wrap. Type is 14/22. Lines stack upward from the bottom; `--boot-log-inset` clears the corner rails on the bottom and left. Overflow clips older lines at the top so the newest line stays fully visible. After the runtime is ready, baseline client-plugin loading stays on this canvas (the status line reads `正在加载插件 n/m`). A background BrowserView finishes loading, then the Web UI is revealed; the baseline's “正在加载插件” page is not shown.

Color and theme: [`boot-tokens.css`](../src/renderer/boot-tokens.css) is the only color table. Light is paper near-black; dark is CRT near-white. `--boot-accent` matches body ink; failure uses `--boot-alert`. `html[data-boot-theme]` makes [`theme.js`](../src/renderer/theme.js) apply only the light/dark half of `theme.scheme` and skip the user's `bg` / `accent`. [`boot.css`](../src/renderer/boot.css) consumes `--boot-*` plus baseline font and motion tokens; it does not branch on `[data-ds-dark-theme]` and does not contain color literals.

Window controls stay on [`window-controls.css`](../src/renderer/window-controls.css). Do not use NERV / MAGI / SEELE / EVA marks or official logos. Do not use `--boot-*` on settings, the closing overlay, the title bar, or the Web UI.

## Desktop launcher

The Recovery Board distinguishes session projection-cache schema failures from user-plugin failures in its existing verdict text. Cache diagnostics take precedence over skip-mode status, add no panel or controls, and never recommend clearing original sessions.

The launcher is the cold-start gate window, not the instrument canvas. Sources: [`launcher.html`](../src/renderer/launcher.html), [`launcher.css`](../src/renderer/launcher.css), [`launcher.js`](../src/renderer/launcher.js). Color comes from the baseline light `:root` and dark `html[data-ds-dark-theme]` tables in [`dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css). `html[data-shell-theme=official]` makes [`theme.js`](../src/renderer/theme.js) apply only the light/dark half of `theme.scheme` and skip Appearance wallpaper seeds on `--dsw-alias-*`. Do not use `--boot-*` or `data-boot-theme`, and do not add a second `[data-theme]` / `prefers-color-scheme` palette in `launcher.css`.

## Known drift (do not spread)

Product pages use this language's tokens and `ui-primitives`. Mobile remote Web (`mobile/web`) is a documented exception: it copies `--dsw-alias-*`, does not embed the baseline plugin tree, and does not use the boot instrument canvas. The Settings marketplace is the desktop-owned `ui-settings-market` package's `settings.section` (id `market`) and must use the same tokens / primitives as the baseline settings pages. The usage-stats panel is the preinstalled reworked `dsh-usage-panel` (id `usage-stats`) and must use the same tokens / primitives as the baseline settings pages, not the upstream plugin palette. Do not open a `--bg` / `--accent` palette. The desktop boot page is the documented instrument-canvas exception; see [Desktop boot page](#desktop-boot-page). Do not spread that sheet. The cold-start launcher uses baseline tokens; see [Desktop launcher](#desktop-launcher). It is not a second exception.

## Self-check

Before shipping a UI change:

- [ ] Hand-rolled a button / menu / dialog that a primitive already covers?
- [ ] Color literals or a second CSS-variable sheet in feature CSS?
- [ ] Radius, height, or type pair off the table above?
- [ ] Dark-mode branch inside the component?
- [ ] New overlay without `usePresence` / a baseline recipe?
- [ ] Reads as another IDE or phone skin instead of the pinned baseline (the Web UI rendered by `vendor/deepseek-harness`)?
