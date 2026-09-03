# DSHD design language

[中文](design-language.md) · English

DSHD (Deepseek-Harness-Desktop — the desktop application in this repository; distinct from the `dsh` CLI and from the dshd daemon in `src/main`) defines its design language in this document: it is the sole visual authority for every visible surface of DSHD. The language's baseline is pinned to the vendored `vendor/deepseek-harness` Web UI — currently `dsh-v0.1.2-alpha.4` (`4e84901e6471b79ec0338099867ebb4606d12bb5`), recorded in [`vendor/harness-upstream.json`](../vendor/harness-upstream.json) and updated by `npm run sync:harness`. The desktop chrome, closing overlay, title-bar injection, right-hand surfaces, the Web UI page opened by phone remote, and any new frontend all implement the same language. Do not invent a second skin.

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
12. **Shadows are lv1 / lv2 / lv3 only.** Menus and dialogs use `lv3`; composer and floating cards use `lv2`. No `0 18px 40px` slabs.
13. **Glass stops at the baseline recipe.** Mask `blur(2px)` (`--dsw-mask-blur`) + `--dsw-alias-bg-mask-*`; raised surfaces `color-mix(..., var(--dsw-alias-glass-opacity), transparent)`. No heavier blur, no shadow on every layer.
14. **Scrollbars are the shared sheet.** No component-local `::-webkit-scrollbar`.
15. **Product copy is Chinese; code comments are English.** Do not import VS Code / Material / iOS density or decoration over the baseline Web UI.
16. **Sidebar brand follows the baseline build.** `setup:harness` runs the vendor tree's own `pnpm run build:official` (`DSH_CLIENT_BUILD_PROFILE=official`). The sidebar shows the baseline whale mark and DeepSeek Harness wordmark, not the local-build fallback “DSH Local Build”. Rebuild client changes with that same command; a lone `build:lib:client` bakes the local-build brand back in.

## Visual anchors

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

Layout: `AppFrame` is columns, not a card grid. A closed column is width 0 and paints no divider. The title-bar trailing cluster is 28×28 icon buttons with measured window-control inset — do not draw a second window skin. A surfaces tab keeps its close control **to the right of the title**; do not move it unless the user explicitly asks.

## Allowed exceptions

- **xterm / diff / code**: monospace, ANSI, character grid — not capsules.
- **Native window controls**: min / max / close keep system hit targets; paint still follows theme tokens.
- **Shells that cannot import the theme package** (remote login page, mobile Web SPA, Android Compose): reuse the same semantic colors and geometry. The mobile SPA copies `--dsw-alias-*` into `mobile/web/tokens.css`; Android copies it into the Compose `DshTokens` / `Color` tables under `mobile/android`. None of them mount official CSS Modules or carry the boot `--boot-*` canvas. Do not open a parallel `--bg` / `--accent` palette, and do not let Material default purple or dynamic color override the semantic tables. Action labels on the Git capsule (Commit / Push / Pull …) stay in English.
- **Desktop boot page**: a full-window instrument canvas and a dedicated `--boot-*` table; see [Desktop boot page](#desktop-boot-page).

## Desktop boot page

The boot page is one instrument canvas for the whole window. It is not a centered card, and the log is not locked in a bordered box. Sources: [`boot.html`](../src/renderer/boot.html), [`boot.css`](../src/renderer/boot.css), [`boot-tokens.css`](../src/renderer/boot-tokens.css), [`boot.js`](../src/renderer/boot.js).

Layout: L-shaped targeting rails sit on the viewport corners. The center stack is the DeepSeek mark, the brand `Deepseek-Harness-Desktop`, status and hint, and square retry and download-log buttons on failure. The top bar shows `DSH-DESKTOP` on the left and a stamp on the right that follows `body[data-state]`: 启动中 / 就绪 / 停止中 / 异常, coded BOOT / READY / HALT / ERROR. The bottom-left monospace log sits on the canvas with no border or fill; long lines wrap. Type is 14/22. Lines stack upward from the bottom; `--boot-log-inset` clears the corner rails on the bottom and left. Overflow clips older lines at the top so the newest line stays fully visible. After the runtime is ready, baseline client-plugin loading stays on this canvas (the status line reads `正在加载插件 n/m`). A background BrowserView finishes loading, then the Web UI is revealed; the baseline's “正在加载插件” page is not shown.

Color and theme: [`boot-tokens.css`](../src/renderer/boot-tokens.css) is the only color table. Light is paper near-black; dark is CRT near-white. `--boot-accent` matches body ink; failure uses `--boot-alert`. `html[data-boot-theme]` makes [`theme.js`](../src/renderer/theme.js) apply only the light/dark half of `theme.scheme` and skip the user's `bg` / `accent`. [`boot.css`](../src/renderer/boot.css) consumes `--boot-*` plus baseline font and motion tokens; it does not branch on `[data-ds-dark-theme]` and does not contain color literals.

Window controls stay on [`window-controls.css`](../src/renderer/window-controls.css). Do not use NERV / MAGI / SEELE / EVA marks or official logos. Do not use `--boot-*` on settings, the closing overlay, the title bar, or the Web UI.

## Desktop launcher

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
