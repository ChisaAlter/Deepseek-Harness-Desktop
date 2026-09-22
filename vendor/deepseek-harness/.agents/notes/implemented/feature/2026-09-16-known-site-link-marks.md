# Agent Note: Known-site link marks

Status: implemented

English | [中文](2026-09-16-known-site-link-marks.zh.md)

## Problem

Every transcribed anchor led with the same globe, so a transcript full of GitHub, npm, and documentation links gave no signal about where a link goes until the reader parsed its label. The [clickable-link vocabulary](2026-09-04-web-clickable-link-styles.md) reserved that leading seat for one category glyph and left per-site marks as a possible later extension of the `url` category.

## Decision

`LinkIcon` takes an optional `href`. For the `url` category, a destination whose host is a well-known site draws that site's own mark; every other `url` destination keeps the globe, and the file categories ignore `href` because their destination is a path, not a site.

`SiteGlyph.tsx` in ui-primitives owns the mapping: forty host suffixes resolve to thirty-four marks. The developer sites a transcript usually cites: GitHub (`github.com`, `github.io`, `raw.githubusercontent.com`), GitLab, npm, PyPI, Stack Overflow, MDN, Wikipedia, Hacker News (`news.ycombinator.com`), YouTube (`youtube.com`, `youtu.be`), X (`x.com`, `twitter.com`), Bilibili, Zhihu, Juejin, CSDN. The mainstream sites a general audience links: search (Google, Baidu, DuckDuckGo), video and audio (TikTok, Netflix, Spotify), social and messaging (Facebook, Instagram, Reddit, Telegram with its `t.me` short links, WhatsApp with `wa.me`, WeChat via `weixin.qq.com`, QQ, Weibo), shopping (Taobao, AliExpress, eBay), reference and community (Quora, V2EX), and Apple. A host matches a suffix when it equals it or is a subdomain of it, and the longest matching suffix wins, so `gist.github.com` and `en.wikipedia.org` need no entry while `weixin.qq.com` keeps WeChat rather than the QQ mark its `qq.com` suffix would also select. Only absolute `http:` and `https:` destinations can match; anything else falls back to the globe.

The artwork is the [Simple Icons](https://simpleicons.org) set (CC0-1.0) consumed as a devDependency of ui-primitives, so adding a site is one host-map entry and the artwork version comes from the lockfile rather than a copied path. Each mark renders as that set's single path on its 24-unit viewBox, inset to a 28-unit box so it keeps the ~8% margin the 20-unit `ic_ds_*` glyphs draw inside their own box, and takes the link's `currentColor` rather than the brand fill the set records. Every mark is `aria-hidden`; the anchor's own text remains the accessible name.

Taking `currentColor` is deliberate for a functional link glyph rather than brand presentation: YouTube, X, Instagram, and other brands publish guidelines against recoloring their marks, and the first alternative below weighs the fixed-brand-fill option. CC0-1.0 covers the path data; every mark remains its owner's trademark, and the generated third-party notices cover the package rather than this artwork.

Two consumers pass their destination: the markdown renderer's `renderSafeLink`, which covers authored anchors, reference links, and URL-promoted inline code, and the web card's source and fetch links. Both already hold the sanitized destination.

## Alternatives considered

- **Fetching each site's favicon** from the site itself or a favicon service. This covers arbitrary sites, but rendering a transcript would issue network requests to every linked host, which discloses reading activity and turns a text render into a network operation; it also fails offline and behind a strict `img-src` policy. Rejected: a fixed local vocabulary keeps rendering deterministic and private, and the globe remains the honest fallback.
- **Filling the mark with the site's brand color.** Rejected: the link glyphs are `currentColor`-only so they follow the link alias, dark mode, and hover; a fixed fill would be the first exception and would fight the link's own hover color.
- **Copying the path data into this module.** Rejected: a third-party artwork set that changes upstream is exactly what a pinned dependency tracks; fourteen embedded copies would leave no update path.
- **Adding site values to `LinkIconKind`.** Rejected: the kind is the category the consumer states, while the site is derived from the destination; folding both into one union would make every consumer spell out a site it does not know.
- **A monogram tile for every unmapped host.** Rejected as noise: a generated letter capsule claims a site identity without carrying one, and 14px leaves no room for readable initials.

## Consequences

- Adding a site needs a host-map entry in `SiteGlyph.tsx` and, to be checked, a URL in the `link-icon` spec: that spec lists a representative URL per mapped site, requires thirty-four distinct marks across them, and pins the GitHub, npm, YouTube, Wikipedia, X, Telegram, and WhatsApp aliases. A dropped or duplicated entry fails the count, while a site added to the map alone stays uncovered by the spec.
- The vocabulary stays bounded by category rather than by demand: each site costs one map entry, one upstream mark, and one spec URL, and the thirty-four marks add roughly 23 KB of path data to the source, which the shell build reduces to a few KB in the entry chunk after tree-shaking, minification, and compression.
- `simple-icons` enters the browser build graph as a development dependency of ui-primitives; the shell build tree-shakes the imported marks instead of the complete set.
- Unknown hosts, non-http schemes, unparseable destinations, and file categories keep the existing globe or category glyph; the `mailto` link in a transcript still shows the globe.
- The vocabulary is deliberately finite. Sites such as `example.com` never get a mark from this mechanism; recognizing them would require the network fetching the alternatives reject.
- Coverage: the LinkIcon spec covers the aliases, the fallback branches, and the sizing seat; the markdown spec pins one known and one unknown anchor; the web-card spec pins a source and a fetch link against the same marks.
