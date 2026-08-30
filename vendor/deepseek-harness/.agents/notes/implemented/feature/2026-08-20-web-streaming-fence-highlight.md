# Agent Note: Streaming fences highlight incrementally

Status: implemented

English | [中文](2026-08-20-web-streaming-fence-highlight.zh.md)

## Problem

While a reply streamed, `MarkdownText` stripped the fence language before `CodeBlock` saw it, so code rendered as plain monospace with an empty language banner until the finalize swap recolored the whole reply at once ([#1499](https://github.com/deepseek-harness/deepseek-harness/issues/1499)). The plain arm was a deliberate cost guard, recorded in the [assistant-markdown note](2026-07-23-web-assistant-markdown.md): shiki tokenizes a document from the top, so highlighting a growing fence naively re-tokenizes the whole fence on every chunk — quadratic in fence length over the stream, the same cost class the [incremental markdown parser](../architecture/2026-08-06-web-markdown-incremental-ast-renderer.md) removes for block parsing. The fix has to deliver highlighting during streaming without reintroducing that cost, without transiently coloring under a wrong grammar while the info string is still mid-chunk, and without changing the settled render.

## Decision

Streaming fences highlight incrementally through grammar-state resumption; the settled arm is unchanged.

- **`StreamingHighlightSession`** (`packages/client/ui-primitives/src/markdown/highlight.ts`) exploits that TextMate tokenization is line-based and forward-only: a line's tokens depend only on its own text and the grammar state entering it, so appended text never changes a completed line's tokens. The session caches completed lines' spans plus shiki's `GrammarState` after them (`getLastGrammarState`), and each update tokenizes newly completed text via `codeToTokensBase(…, { grammarState })` plus the still-growing last line. Per-chunk cost excludes the completed prefix; the result is token-identical to a from-scratch tokenization. Non-append input and a resolved-grammar change reset the cache and re-tokenize fully. Each run carries the style shiki's HTML arm would assign it — the css-variables color plus the markup font-style bits the theme lets through (bold/italic/underline; markdown fences carry them); whitespace-only runs fold into their following token as shiki's default `mergeWhitespaces` does (its underlined/struck-whitespace exemption cannot occur under this theme, whose only underline rule styles inline-link scopes that tokenize spaced text as one run); and a CRLF cut never leaks its `\r` into the last completed line, matching shiki's own line splitting — so the streaming spans and the settled `codeToHtml` swap render one identical span tree.
- **`CodeBlock`** gains a `streaming` prop: it renders the session's spans as a `pre.shiki.css-variables` React tree with the same attributes shiki's HTML emits, holds the session and per-line elements in refs, and reuses a retained line's element identity so React leaves that line's DOM untouched. Unknown or absent languages keep the identical-geometry plain arm; a lazy grammar renders plain until it registers, then the existing `useSyncExternalStore` load signal re-renders into highlight — one plain→highlighted transition, no flicker back.
- **`render.tsx`** passes `lang` and `context.streaming` to fences. Wrong-grammar transients are structurally impossible: a fence whose info string is still mid-chunk (`` ```py `` completing to `` ```python ``) has no content yet — content only exists after the info line's newline, which finalizes the language — and the empty-value fence keeps the stock `<pre>`. The streaming CodeBlock instance survives every chunk because streaming render keys are source offsets. `` ```math `` fences and TeX stay literal until the settled pass; the language banner shows the fence language during streaming.

The settle swap re-renders through `highlightToHtml`: same tokens, same span tree, so the swap is visually invisible and never touches the code content.

## Testing

Package tests cover incremental/from-scratch equivalence across multiline grammar state, blank lines, CRLF, and markup styles; cache identity and reset/lazy paths; streaming/settled token-tree parity; DOM retention; and plain or math fallbacks. The assembled Web browser snapshot boots the real Web composition, streams a TypeScript fence through the Host and SSE path, pauses the deterministic LLM adapter while the reply is still active, and snapshots Chromium's Shiki token tree before verifying that settlement preserves it. The `tests/fixtures/markdown-dom/*.streaming.txt` fixtures pin the intentional streaming divergence from their react-markdown origin: the Shiki span tree and visible language banner replace the plain arm.

## Alternatives considered

**Pass `lang` through and re-tokenize the whole fence per chunk.** One-line fix, but it reverses the recorded plain-arm rationale without addressing it: a long streaming fence pays quadratic tokenization over the stream, janking exactly on the replies where highlighting matters most.

**Highlight only frozen (closed, settled-position) fences during streaming.** Bounded cost, but an unclosed fence pins the incremental parser's tail, so the actively growing fence — the one on screen — would stay plain until the reply finishes, failing the issue's "识别语言后即可增量高亮".

**Move highlighting to a worker or async pass.** Rejected when shiki was adopted ([synchronous highlighting note](../process/2026-07-26-web-syntax-highlighting-shiki.md)); an async swap also reintroduces the plain→colored→plain flicker class this change must avoid.

**Build the settled HTML string incrementally and keep `dangerouslySetInnerHTML`.** Exact settled parity for free, but React replaces the whole `innerHTML` per chunk, so the browser re-parses and rebuilds every line's DOM each time — O(fence) DOM churn that forfeits the token-level win the session provides.

## Consequences

Streaming code is readable as it arrives: tokens color as soon as the language is known, completed lines never re-tokenize or re-render, and the finalize swap is invisible for fences. The package owns a small mirror of shiki's HTML-arm conventions — the `pre` attributes and the whitespace fold — pinned by the arm-parity test, so a shiki upgrade that changes either fails loud there instead of drifting the two arms apart. The streaming DOM-parity fixtures pin Shiki span trees as an intentional divergence from their react-markdown origin. The still-growing last line re-tokenizes per chunk (bounded by one line), and a pathological single-line fence still degrades to full re-tokenization per chunk — the same degradation class the incremental block parser accepts for a single giant block.
