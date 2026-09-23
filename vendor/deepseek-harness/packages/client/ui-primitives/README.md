---
description: "Shared React UI atoms for the dsh web client: controls, icons, markdown and math rendering, and the terminal/read/diff/search/web output cards (zero Cordis)."
kind: "package-library"
---

# @deepseek-ai/dsh-client-ui-primitives

English | [中文](README.zh.md)

## Summary

Use `dsh-client-ui-primitives` to build web-client controls and render agent output with shared React UI. It includes standard controls, icons, anchored overlays, and renderers for Markdown with TeX, terminal output, file reads, diffs, search, web retrieval, and JSON. The renderers handle untrusted model output by dropping raw HTML, restricting links, and parsing ANSI escape sequences. The components import no Cordis runtime; callers supply localized labels, and theme-facing colors use `--dsw-*` design tokens.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

This package is a Web-shell build input. Its static ESM retains third-party imports and styles for Vite; independent consumers supply its development dependencies ([dependency rules](../AGENTS.md#dependency-declaration)).

Compose feature UI from these atoms whenever the web client needs a standard control or an agent-output renderer. They render through React only and take `--dsw-*` design tokens from the theme, so they fit any plugin without importing the theme or the slot system.

<a id="component-catalog"></a>
### Component catalog

Check this table before writing a control in a feature package. A plugin cannot import another plugin's component, so this package is the only place a control can be shared: reuse what fits, and lift a deliberate visual difference into a prop rather than starting a second copy.

| Export | What it is |
|---|---|
| `Button` | Clickable action; `variant` selects `primary`, `ghost`, `outline`, or `toolbar`. |
| `Switch` | Two-state toggle, 36×20. `label` is required, so the control cannot ship unnamed. |
| `SegmentedControl` | Tablist of two or more equal-width segments with one sliding indicator, for switching a card or panel between a few modes; the owner holds the selection and `label` names the list. `id` seeds each tab's id (`<id>-<value>`) and the panel it controls (`<id>-<value>-panel`), which the owner renders and points back at the tab with `aria-labelledby`; a segment may be `disabled` with a `title`, and `disabled` on the control locks every segment while the shown panel has work in flight. |
| `Checkbox` | Labeled native checkbox with controlled state, keyboard interaction, and disabled styling; the caller supplies localized `label` text. |
| `Input` | Single-line text entry for search boxes and inline forms. |
| `Menu`, `MenuItemButton` | Dropdown of `items` data rows, separators, and group labels, with nested submenus; `children` adds component rows, each a `MenuItemButton` (`separatorBefore` starts a new group), in the same list. Every row shares the styling, the keyboard walk, and the focus return; closing stays the owner's state change for both kinds. While open, ↑/↓ (with Home and End) walk the list, Tab settles the focused row, and Escape or Shift+Tab close back to the anchor; selecting a row also returns the keyboard to the anchor unless the owner moved it itself. Only a keyboard on the anchor or inside the list is intercepted, and `autoFocus` decides solely whether opening focuses the first row. |
| `Pill` | Selectable capsule button for view switchers and filters; takes `active` and `onClick`. |
| `SegmentedTabs` | Controlled equal-width tabs with a sliding indicator and Left/Right, Home, and End navigation. The caller supplies labels, tab/panel ids, and panel content. |
| `Tag` | Read-only capsule badge; `tone` selects one of eight palettes. |
| `PathLabel` | Single-line file path with subdued directories, a primary filename, and the full path on hover. Fitting paths align left; clipped paths preserve their suffix with a left-edge fade that updates on path and size changes. |
| `StateDot` | Solid green `done`, amber `warning`, red `error`, and neutral-grey `idle` marks in a 10px slot, plus a tertiary-grey 14px rotating `ongoing` loader whose animations pin to document time zero so every visible loader rotates in phase. `aria-hidden`, so the render site owns the name. `appearance="step"` shows a filled check for completion and a hollow pending circle. |
| `ConnectionIndicator` | Inline connection-recovery control across outage, retry, and recovered states. |
| `DisclosureRow` | 24px compact disclosure that lays title and content side by side. Memoized with shallow prop comparison; keep callbacks and React-node props stable when their content is unchanged. |
| `Modal` | Centered dialog over a page mask. |
| `RiskConfirmation` | Sensitive action gated behind an explicit checkbox. |
| `OnboardingSurface` | First-run stage that holds the application root inert. |
| `Tooltip` | Hover text anchored to a cloned child; optional `portal` rendering escapes clipping containers. |
| `HoverCard` | Hover preview the pointer can rest on and select from; optional copy button. |
| `Toast` | Transient top-center banner held for the owner's `holdMs`. |
| `SettingsForm`, `SettingsValueField`, `SettingsSecretField` | The frame and the controls of a plugin's settings page: the frame takes its copy as `labels`, saves only on its button, and discards on unmount; a value field shows staged text with the overridden badge and reset; a secret field starts blank and reports only whether a value is configured. |
| `SettingsFormModel`, `settingsNumberField`, `settingsTextField` | The staged-edit model behind such a page over a settings scope: drafts are staged and written on save, a field is overridden by its presence in the user layer, and a save that did not land keeps its drafts. |
| `JsonTree`, `JsonBlock` | Read-only JSON inspection. |
| `MarkdownText`, `MarkdownDelegateProvider`, `CodeBlock` | Untrusted GFM with TeX math, owner-delegated HTTP(S) navigation, and highlighted code. `CodeBlock` accepts opt-in `lineNumbers`; copied source excludes the gutter, and `contentRef` exposes its stable source wrapper to an owner that uses it as a scrollport. Set `showHeader={false}` when the owner supplies its own language and copy toolbar. |
| `TerminalBlock`, `ReadBlock`, `DiffBlock`, `SearchBlock`, `WebBlock` | The agent-output card matching each tool-result intent. |
| `icons/*`, `FishLogo`, `BrandWordmark`, `ReferenceIconRegular`/`ReferenceIconMedium`, `LinkIconRegular`/`LinkIconMedium` | Glyphs and brand marks. Use `LinkIconMedium` for 14px clickable-link categories and known-site marks. |
| `PermissionIconReadOnlyRegular`/`Medium`, `PermissionIconWorkspaceWriteRegular`/`Medium`, `PermissionIconFullAccessRegular`/`Medium` | Permission-mode glyphs for read-only, workspace-write, and full-access choices. |
| `PluginArtworkTerminal`/`Loop`/`Subagent`/`Search`/`Default` | Fixed-palette 36×36 plugin artwork for the plugin-management surfaces; `Default` marks plugins without artwork of their own. Def ids are per-instance, so the same artwork repeats safely on one page. |
| `FileTypeIcon`, `classifyFileType`, `fileExtension` | A category-colored 28px file or folder glyph and the shared case-insensitive filename mapping behind it. Code and configuration files use detailed full-color technology glyphs; use `LinkIconMedium` for link-leading glyphs and image previews for image content. |
| `languageForPath`, `CODE_HIGHLIGHT_EXTENSIONS`, `useCodeHighlighter` | The filename grammar selection and lazy line-token highlighter shared by code preview and diff review. |

Four pairs are easy to confuse:

- **`Tag` against `Pill`.** Reach for `Tag` for a read-only badge at the 11px capsule size, and for `Pill` when the capsule is selectable (`active` and `onClick`, as view switchers and filters use) or when it must sit on a 24px text line — `TerminalBlock` renders its exit status as a static `Pill` for exactly that reason. Size decides as much as interactivity here; the two are not interchangeable.
- **`Pill` against `SegmentedControl`.** A row of `Pill`s is a set of independent chips — each one toggles on its own, and several may be active. `SegmentedControl` is one choice among a few mutually exclusive modes, drawn as a tablist with one indicator, and it comes with the tab keyboard pattern (arrow keys walk the segments, only the selected one is in the tab sequence); the Models settings add card switches its two forms with it.
- **`DisclosureRow` against a card.** The row lays its title and content side by side at a fixed 24px. A card that stacks a name over a description is a different layout, and belongs in the feature package — `ui-settings-plugins`' `PluginCard` is the precedent and records why.
- **`FoldToggle` against the exported surface.** It is package-internal and not exported; the output cards use it for their head-tail fold.

Writing your own component in your own package is fine when the need is genuinely specific. What is not fine is copying a control that already exists here — and once a second package needs the same control, it belongs in this package ([decision](../../../.agents/notes/implemented/architecture/2026-09-05-shared-client-control-primitives.md)).

### Controls and icons

The catalog above lists what each export is for; this section covers the behavior that props alone do not show. Product icon names omit artboard sizes and end in `Regular` for the supplied one-pixel artwork or `Medium` for the same geometry at a 1.3px stroke; the `size` prop controls rendered dimensions ([decision](../../../.agents/notes/implemented/architecture/2026-09-16-size-neutral-product-icon-weights.md)). Each product, reference, link, and permission glyph intentionally keeps both weight exports even when the current product uses only one, so callers can choose emphasis without adding another API later; fill-only pairs render identically. `IconWarningOutlineRegular`/`Medium` use a circle; `IconWarningTriangleOutlineRegular`/`Medium` use a rounded triangle. `FishLogo` and `BrandWordmark` fill brand slots. `FileTypeIcon` renders the traditional 28px spreadsheet, folder, HTML, image, Markdown, generic, PDF, PPT, video, and Word glyphs, and uses the imported square technology artwork for the established 48 code and configuration categories. The import replaces artwork only: archive-only categories do not extend `CodeFileType`. `classifyFileType` applies exact filename, prefix, suffix, optional project-context, and extension rules in that order; React names win over TypeScript/JavaScript, Angular suffixes win over their base extension, and a Dart file becomes Flutter only when the supplied project files contain a `pubspec.yaml` with `flutter:`. Markdown and SVG remain traditional Markdown and image files. Spreadsheet mappings include CSV, TSV, Excel workbooks and templates, OpenDocument spreadsheets, and Numbers; KEY maps to slides, while RTF/ODT/Pages map to documents. `fileExtension` exposes the same basename and final-dot parsing for adjacent metadata labels. Traditional glyphs use a solid category-colored sheet with a white mark and translucent white corner; the generic file uses a grey sheet and darker grey corner. Callers may override the sheet color through `--dsh-file-type-icon-color`. The full-color technology artwork is the deliberate exception and retains its embedded palette. All glyphs are decorative and carry no label. `LinkIconMedium` is the leading glyph for clickable artifact links — globe, folder, code, image, document, or plain paper, and for a `url` link the mark of a well-known site named by its `href` — the developer sites a transcript usually cites (GitHub, GitLab, npm, PyPI, Stack Overflow, MDN, Wikipedia, Hacker News, YouTube, X, Bilibili, Zhihu, Juejin, CSDN) and mainstream search, video, social, shopping, and reference sites (Google, Baidu, DuckDuckGo, TikTok, Netflix, Spotify, Facebook, Instagram, Reddit, Telegram, WhatsApp, WeChat, QQ, Weibo, Taobao, AliExpress, eBay, Quora, V2EX, Apple) — while `classifyLinkPath` folds the shared file types into that existing six-category vocabulary. `ConnectionIndicator` renders a warning-colored disconnected action whose permanent retry glyph marks the retry action beside the owner-supplied outage label, the shared ongoing loader beside a label whose one-to-three dots advance every 500ms independently of retry timing, or a success-colored recovered status. Clicking either warning state requests an immediate reconnect; no hover interaction changes the copy. The pill fades in on appearance, fades out for 150ms before unmounting, and sizes to its current label. Its owner supplies visibility, the recovery hold, localized labels, and the immediate-reconnect callback; the primitive uses no native title tooltip. `useAnchoredPosition` and `useAnchoredMaxHeight` keep floating panels and bottom-anchored overlays clamped to the viewport and following their anchor; `useAnchoredMaxHeight` and portalled `Menu` widen their 12px top viewport margin to the frame's published `--dsh-frame-top-clearance`. `HoverCard` keeps its portaled preview reachable across the anchor gap and can expose a copy button through the `copyText` prop. Its `preview` variant uses the anchor or `widthAnchorRef` element’s width minus 48px, centers the panel with 24px side insets, and places it above or below the row within the viewport. The panel keeps the frame’s top clearance, caps its height at 420px, and follows content and anchor resizing; Escape or pointer and keyboard activation of the anchor dismisses it. The whole preview fades in and out over 100ms; a closing preview stops receiving pointer input and unmounts after the fade. Re-entering the anchor during the fade restores it. Reduced-motion preferences suppress the transition. Copy labels are required only when copying is enabled. `Toast` uses the owner's `holdMs` for both the fade delay and its hold-and-fade lifetime. Rerenders with unchanged `holdMs` do not restart that lifetime; completion uses the latest callback, and fully faded actions cannot receive input. A new component key restarts the banner. `rankByName` is the `/` menu's shared candidate ranker for the command and skill sources: the query must be a case-insensitive ordered subsequence of the name; prefix hits rank first, then alignment score, then source order. Portalled `Menu` lists follow their anchor during dragging and CSS transforms, and stop tracking when closed. `Menu.autoFocus` focuses its first enabled item, supports Arrow Up/Down and Home/End navigation, and focuses the first button in the anchor on Escape; it is opt-in for action menus.

`Tooltip` reads the anchor on hover or keyboard focus and fits its bubble from `ResizeObserver` border-box sizes. The bubble stays hidden until its first fit, slides inside the horizontal viewport margin, and flips above or below only when the opposite side fits. Label-size and viewport changes reuse the anchor coordinates; fitting does not synchronously measure the bubble or trigger a React render.

### Rendering agent output

The nearest `MarkdownDelegateProvider` supplies optional `openExternalLink`, `openFile`, and `openImage` navigation callbacks. Nested providers replace the enclosing capabilities, and callback changes reach already-rendered links without rebuilding Markdown. Its `openFile` makes local Markdown links clickable after settlement. Absolute and workspace-relative paths support percent escapes and `#L24` / `#L24-L30` fragments; ranges open at their first line. Literal `?` and `#` in filenames must be percent-encoded. The tooltip uses the decoded path and supplies the accessible name when the label is empty. The callback receives the decoded path and optional line, while the renderer preserves the label and displays a file icon. Without a callback, local links remain text. URL schemes, queries, unsupported fragments, and malformed destinations never reach the file opener.

`MarkdownText` renders untrusted GFM and TeX math, blocks unsafe links and images, and can turn resolved file mentions into explicit controls. A surrounding `MarkdownDelegateProvider` receives sanitized HTTP(S) URLs from ordinary clicks; modified clicks and links outside a provider retain native external-anchor behavior. When the owner passes a `pathImages` vocabulary, image destinations that are local media paths rewrite to displayable URLs on settled renders only (the same streaming gate as file mentions); without a vocabulary, local destinations remain inert alt text. A load or decode failure replaces the image with its authored alt text, or the original destination when alt is empty. Changing the image source permits a fresh load. While a reply streams, it freezes completed blocks, advances a top-level open fence by completed lines, and highlights that fence from saved Shiki grammar state. Completed token lines enter fixed-size React groups, so later chunks reconcile only the growing group; an unchanged fence retains that DOM when the final full parse resolves cross-document syntax. `TerminalBlock`, `ReadBlock`, `DiffBlock`, `SearchBlock`, and `WebBlock` render the matching tool-result intent with copy controls, overflow handling, and ANSI processing where applicable. `JsonTree` and `JsonBlock` inspect JSON values read-only, while `projectUserText` projects sent user text into inline plain runs and reference chips for the message bubble and queue rows. Reference labels inherit the consumer’s wrapping policy: long names wrap within a bubble, while queue previews retain their single-line layout. When supplied with `UserTextReferences`, file and skill references become keyboard-accessible preview buttons using the same hover and focus styling as prose file links; the first pointer click can open a preview, while subsequent clicks and existing text selections retain native selection handling. Keyboard activation opens previews even when text is selected.

`MarkdownText` defaults to `variant="body"`. Use `variant="compact"` for secondary content: its 13px text and 20px line height follow the content-size setting, all heading levels use the same size with weight 600, and paragraphs and lists use tighter spacing. Text, links, and code keep the tertiary color; dotted underlines distinguish links. Code headers scroll with their blocks. Tables and math stay enabled at the surrounding text size and scroll horizontally within the available width. Both variants share the parser and streaming cache.

`CodeBlock.toolbarLabels` enables the shared code-card header and spacing. `ReadBlock` and `DiffBlock` use the same header: tertiary-colored language and filename text, secondary-colored copy and wrap icons, and hover or keyboard-focus tooltips. Missing or unsupported languages use the owner’s localized code-block title; mixed-language diffs use that title too. Code cards share typography and content insets; their headers and bodies use the same background in both themes. Read gutters fit the largest returned line number, and diff fills cover the full scrollable row. The wrap toggle keeps a fixed accessible name and exposes its state through `aria-pressed`; its tooltip describes the next action. Wrapping is local to each mounted card and never changes copied text; code fences start wrapped, while reads and diffs preserve source columns until wrapping is enabled. Compact Markdown shares this toolbar, spacing, and code typography while retaining monochrome text. With `toolbarLabels`, source previews can pass `wrap` to follow their owner’s preference and show only the language and copy icon; owner CSS retains the source layout.

`DiffBlock` compares the old and new content by line. It shows actual additions and deletions with up to three neutral context lines on each side, separates distant changes with `⋯`, and excludes shared context from tool-summary totals. The card ends after the diff body. Search stops beyond 256 line additions/deletions per fragment; those fragments display and count the complete old and new contents as a coarse replacement, including shared lines. Copy includes the full displayed diff with its prefixes. A final newline is treated as a terminator; differences only in the presence of a final newline are not displayed.

`JsonTree` clamps collapsed strings to `collapsedStringLines` (three by default). Expanded strings show raw text, retain sibling commas, and fit within the window and outer scrolling containers. Resize and ancestor-scroll events update that limit. Row copy feedback updates independently of JSON value rendering; pending clipboard writes cannot update a different row or an unmounted tree.

### Localizing copy

The atoms cannot read the application locale, so every piece of user-facing copy arrives through required label props. `HoverCard`, `TerminalBlock`, `JsonTree`, `CodeBlock`, `MarkdownText`, `JsonBlock`, `ConnectionIndicator`, `Modal`, `DiffBlock`, `ReadBlock`, `SearchBlock`, and `WebBlock` accept complete localized labels. The package owns no language fallback; omission fails typechecking, and each feature maps its typed `t` seat into the primitive's label interface.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Menu.listClassName styles the menu card independently of the anchor wrapper, including in portal mode.

<details>
<summary>Implementation internals — click to expand</summary>

The package enforces one separation: presentational React atoms with zero Cordis and zero slot knowledge, styled only through `--dsw-*` tokens, while every feature-specific concern (locale, session data, composition) stays in the composing plugin.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Public atom exports |
| [`src/markdown/`](src/markdown/) | Markdown and math pipeline: micromark parsing, KaTeX typesetting, incremental streaming renderer, `CodeBlock`/`JsonBlock` |
| [`src/TerminalBlock.tsx`](src/TerminalBlock.tsx) | ANSI escape parsing (`anser`) and terminal card rendering |
| [`src/ReadBlock.tsx`](src/ReadBlock.tsx) / [`src/DiffBlock.tsx`](src/DiffBlock.tsx) | Read and diff cards |
| [`src/SearchBlock.tsx`](src/SearchBlock.tsx) / [`src/WebBlock.tsx`](src/WebBlock.tsx) | Search and web-retrieval cards |
| [`src/icons/`](src/icons/) | Size-neutral `Regular` and `Medium` product glyph components |
| [`src/code-highlighting.ts`](src/code-highlighting.ts) | Shared filename grammar selection and lazy line highlighting |
| [`src/plugin-artwork.tsx`](src/plugin-artwork.tsx) | Fixed-palette plugin artwork with per-instance SVG def ids |
| [`src/useAnchoredPosition.ts`](src/useAnchoredPosition.ts) / [`src/useAnchoredMaxHeight.ts`](src/useAnchoredMaxHeight.ts) | Floating-panel and overlay geometry hooks |
| [`src/settings-form/`](src/settings-form/) | The settings page kit: the staged form model over a settings scope, the value and secret fields, and the form frame |

### Streaming markdown

While a reply streams, `MarkdownText` parses incrementally: all but the trailing two blocks freeze as cached React elements and only the source tail re-parses per chunk, so per-chunk work tracks the tail instead of the whole reply. A final unclosed top-level fence keeps its parsed code node and sends only the last completed line plus the current partial line through the same GFM grammar; a closing fence or ambiguous parse returns to the ordinary tail path. Highlighting likewise resumes from saved Shiki grammar state and publishes only newly completed lines plus the mutable tail. `CodeBlock` seals completed lines into fixed-size React groups, reuses earlier groups, and retains the whole highlighted tree across settlement when code and language are unchanged. The settled full parse still resolves references that crossed the freeze boundary.

### Syntax highlighting

The shared Shiki highlighter is built on demand and never at module load: a document that renders no code surface constructs it zero times. `useViewportHighlighting` requests initialization when the first highlightable `CodeBlock` or `ReadBlock` mounts, and the work is split across background tasks that each stay under the 50 ms long-task budget. The Oniguruma-to-JavaScript pattern translation for the three boot grammars ships precomputed in `src/markdown/highlight-pattern-table.generated.ts` (`node scripts/generate-highlight-pattern-table.mjs`; `tests/highlight-pattern-table.client.spec.ts` fails if a dependency upgrade makes the table incomplete), and each pattern's V8 compile is paid during warm-up rather than inside the first fence. A grammar the table does not cover — every lazily loaded read-card grammar — still resolves through the runtime translator, and a surface that renders before warm-up finishes simply takes the synchronous path. Until highlighting is ready the complete monospace source stays visible and copyable; a failure never shows highlighted output for stale input. See [the design language](../../../docs/design-language.md) rule 17 and the [syntax-highlight scheduling decision](../../../docs/decisions/proposed/architecture/2026-09-21-syntax-highlight-scheduling.md).

### Geometry and overflow

The output cards share one geometry model: `white-space: pre` with horizontal scrolling so column-aligned content keeps its alignment, and a head-plus-tail slice behind an expand button past `maxLines` (default 16) so a long body never stretches the card. `TerminalBlock` parses ANSI into React spans with a per-line column buffer for cursor movement, honoring erase-in-line, tab stops, and character width. Hosts opt out of the shared geometry per surface: rebinding `--dsl-terminal-command-whitespace` / `--dsl-terminal-line-whitespace` to `pre-wrap` wraps commands and output in full with no sideways scroll, `maxLines: Infinity` disables the fold for hosts capping height through `--dsl-terminal-output-max-height` instead, `copyText` overrides the copy payload (and keeps the control rendered before any output), and `runStateDot: false` omits the run-state dot when the surrounding row already carries the state, reclaiming its gutter via `--dsl-terminal-gutter`. The banner divider follows the rendered body, so a running card that streams live output separates its command from the text like a settled card.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages place the atoms in the client stack and the design system.

- [ui-renderer](../ui-renderer/README.md) — the React renderer that mounts the assembled application and binds slot data.
- [ui-tool](../ui-tool/README.md) — the tool-call presentation layer that composes these output cards.
- [ui-conversation](../ui-conversation/README.md) — the chat surface that renders markdown replies and tool cards.
- [ui-theme](../ui-theme/README.md) — the `--dsw-*` token system these atoms style through.
- [Web styling](../../../docs/web-styling.md) — the authoritative styling rules for web client components.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how the atoms behave at the edges; they are current package constraints, not a component roadmap.

- **Diff search is bounded, input processing is linear** — the edit-distance limit trades precise alignment for a coarse replacement on heavily changed fragments. Normalization, fallback rows, and copied output still scale with input size; the height cap limits visible rows, not those allocations.
- **Known-site marks are a fixed list** — only the named hosts resolve to their own mark, and every other external host keeps the globe; recognizing an arbitrary site would require fetching its icon over the network.
- **Streaming defers cross-boundary reference resolution** — a reference-style link or footnote whose definition sits on the other side of the incremental freeze boundary renders as literal text while the reply streams; the settled full parse at finalize resolves it.
- **A long highlighted fence retains its complete token DOM** — streaming avoids re-parsing, re-tokenizing, and reconciling the completed prefix, but it does not discard old colors or virtualize token spans. Final DOM cardinality therefore still follows the fence's token count; nested/container fences and a pathological single long line remain on the general tail path.
- **The fish logo is a redrawn approximation** — its font glyph has no exportable vector geometry in the local design data, so a hand-authored recreation stands in until an exact export path exists.
- **`Pill` and `Input` have no design source** — both atoms are self-defined; the sidebar search field and view-tab strip that resemble them are consumer-owned compositions, not these atoms.
- **No `Active` `StateDot` variant** — the supported states are done, warning, ongoing, error, and idle.
- **User-facing copy is required at the render site** — the atoms are zero-Cordis and cannot reach `ctx.locale`; each feature must supply complete localized labels through the primitive's typed props ([decision](../../../.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
- **`TerminalBlock` is not a terminal emulator** — it renders settled or still-running command output, not an interactive session: SGR colors, carriage return, backspace, erase-in-line, tab stops, and character width are honored; absolute cursor positioning, screen clearing, and alternate-screen sequences are stripped.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Pure props-in React atoms with no Cordis API — no events, no services, no mutable cross-plugin state; rendering contracts are asserted directly by this package's component specs.
