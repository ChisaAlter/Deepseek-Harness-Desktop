# Decision: Whale assistant stickers (whale_sticker tool + bundled sticker pack)

Status: implemented

[中文](2026-09-21-whale-sticker-replies.md) | English

## Problem

The whale assistant can only reply with text in her session, which makes emotional expression flat. A community archive of whale-girl reaction stickers already exists (蓝色大肥鱼.com, EDMOK/blue-fish-archive, 205 images with per-image reviewed names/tags), and the user wants her to drop an occasional sticker into chat.

## Decision

Stickers are a capability she picks and posts herself, not a host-injected image message:

- `vendor/dsh-whale/stickers/` ships the bundled pack: the `previews/` webp thumbnails (201 images, ~7.6MB) from the fork `ChisaAlter/blue-fish-archive`, plus `index.json` (`{file,name,tags}`; names and tags come from the archive site's per-image manual review). A README records provenance and copyright attribution.
- New preset-scoped tool `whale_sticker` (`lib/sticker-tools.js`, registered via `dsh-whale/tools`, visible only to whale-girl sessions): an optional `query` substring-matches names/tags, falling back to a random pool pick on no match; a 12-entry in-process recency ring prevents back-to-back repeats; image files she or the user drops into `data/whale/stickers/` join the same pool (filename doubles as the sticker name).
- The tool returns a paste-ready markdown image snippet `![name](/root-anchored/path)`; she places the string verbatim in her reply text. The client's existing `localPathMediaUrl` rule in `AssistantMarkdown` rewrites `/`-prefixed destinations to the same-origin `/api/file?path=`, and the host's `isAbsolute` check then lets the fs provider read the file. On win32, drive-letter paths are spelled root-anchored (`C:\x\y` → `/x/y`) and resolve against the process cwd's drive.
- The model only sees the text `output.render` produces: `detail` must embed the markdown verbatim (in the first live run it rendered only the name — the model had no path to paste and went hunting the filesystem for image files). The structured `markdown` field serves host-side consumers like `presentResult` and stays out of the model's view.
- The persona prompt (`buildPersonaText`) gains an "occasionally send a sticker, not in every reply" behavior line; "occasionally" is left to the model — there is no hard cooldown.
- The pet chat card and its history backfill strip markdown images into a `[表情包]` placeholder so raw image syntax never reaches the card bubbles.

## Alternatives considered

- **Fabricating an `assistant/message` image block** — replay validation rejects it: settlement fields must name the live turn/step, a landmine `pet/look` already hit (the card invariant is on record).
- **Carrying an image block in the tool result** — image content in `tool/result` enters derived model history: text-only models burn tokens on visionFallback descriptions, and the generic tool card does not render image blocks, so the picture never reaches the conversation view.
- **A dedicated `/dsh-whale` webServer route plus a full loopback URL** — markdown image destinations starting with `/` are all rewritten to `/api/file`, so a plugin route is unreachable through that syntax; a full `http://127.0.0.1:port/...` URL would force the tool to know the port and auth surface — complexity not worth it.

## Consequences

Gains: no new event types, no context poisoning, a real turn and a real message; in the conversation view the sticker is simply an image inside her assistant bubble. Costs: +7.6MB in vendor; the "occasionally" cadence is prompt-enforced rather than a hard gate (if the model overuses it, the extra-persona field can push back); the win32 root-anchored path relies on DSH_HOME sitting on the same drive as the Harness process (true by default — cross-drive installs would render a broken image, not a crash).
