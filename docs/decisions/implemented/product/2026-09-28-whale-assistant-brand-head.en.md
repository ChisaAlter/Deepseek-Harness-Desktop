# Decision: Whale assistant identity uses the project head

Status: implemented

[中文](2026-09-28-whale-assistant-brand-head.md) | English

## Problem

The whale assistant's identity marks were scattered: the persistent session title prefixed the configured name with `🐳`, the sidebar panel used `IconSparkle16`, and the assistant empty state plus the desktop pet quick-chat card used emoji of their own. None matched the project head used by the application sidebar (`assets/whale-head.png`), so the user saw a family of generic whales instead of the Whale Isle brand.

The host renders `presentation.title` as plain text and cannot accept an image directly. Keeping an emoji in the title could only substitute another non-logo character; moving to Markdown or HTML would pollute the session name's semantics, copied text, and search.

## Decision

- The persistent session's `presentation.title` stores only the configured name (falling back to “鲸鱼娘” when empty); it carries no emoji prefix.
- The client registers a 16px project head in `conversation.session.header.leading`, rendering it only when the current session's `presentation.owner === 'dsh-whale:assistant'`. The title remains the host's standard breadcrumb output, and ordinary sessions are untouched.
- The sidebar `sidebar.panellist`, the footer fallback entry, and the assistant empty state all use that same project head; the desktop pet quick-chat card uses an image head in place of `🐳`.
- The Web shell and desktop pet use the same source asset through their own safe routes: Web reads `/whale-isle-head.png` (byte-identical to `assets/whale-head.png`), while the pet reads `assets/whale-head.png` through the existing fixed `pet://pet/pet-head.png` alias.
- Heads render with `object-fit: contain`, without stretching or a square plate. The `pet://` alias is a fixed filename; it does not widen arbitrary file access, and traversal rejection is unchanged.

## Alternatives considered

- Putting `![Whale](...)` or an embedded image URL into `presentation.title`: the session name becomes Markdown, contaminating copy, search, and notifications with non-name text.
- Replacing `🐳` with `🐋`/`🐬`: the smallest change, but still not the project logo and still a second identity symbol.
- Registering an extra image action beside the header: workable, but it would claim action semantics; this is part of the title's identity, so `header.leading` fits better.
- Letting the pet protocol read arbitrary `assets/**`: widens the protocol's authority for no benefit. The fixed `pet-head.png` alias satisfies the need while preserving the allowlist boundary.

## Consequences

The whale assistant now shares one Whale Isle head across the sidebar, session title bar, assistant empty state, and desktop pet quick-chat card, while title text stays a plain name. `header.leading` is a single slot; this plugin claims it behind session-identity gating. Ordinary sessions render `null` and keep their title structure. New `dsh-whale-client` contract tests cover the head source, size, and owner gate; `desktop-live2d` protocol tests cover the fixed brand alias and traversal rejection. Targeted tests: 57/57.
