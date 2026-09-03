# AGENTS.md — Deepseek-Harness-Desktop

Electron desktop shell around the official DeepSeek Harness Web UI (`vendor/deepseek-harness`).

## Design language (mandatory)

Any UI, layout, or frontend change must follow the DSHD design language defined in [docs/design-language.md](docs/design-language.md) — the sole visual authority, with its baseline pinned to the vendored harness Web UI (`vendor/deepseek-harness`; pin recorded in `vendor/harness-upstream.json`). Change the document first, then the code. Do not invent a second skin for the desktop chrome or new panels. The boot page is the documented instrument-canvas exception in [docs/design-language.md](docs/design-language.md#桌面启动页); do not spread that sheet.

- Product spec: [docs/design-language.md](docs/design-language.md)
- Motion recipes and inventory: [docs/motion.md](docs/motion.md)
- Token / CSS Modules mechanics: [vendor/deepseek-harness/docs/web-styling.md](vendor/deepseek-harness/docs/web-styling.md)
- Client plugin rules: [vendor/deepseek-harness/packages/client/AGENTS.md](vendor/deepseek-harness/packages/client/AGENTS.md)

Reuse `ui-primitives` and `--dsw-alias-*` tokens. The boot page consumes baseline font/motion tokens from [src/shared/dsh-webui-tokens.css](src/shared/dsh-webui-tokens.css) plus the `--boot-*` table in [src/renderer/boot-tokens.css](src/renderer/boot-tokens.css).

Harness-internal work also follows [vendor/deepseek-harness/AGENTS.md](vendor/deepseek-harness/AGENTS.md).

## Surfaces and terminal (work loops)

The right column and conversation terminal drawer implement **work loops** (Files search/save, Browser navigation, Diff scopes, selection into chat), not an empty-state card grid. Empty-state cards are not done. Contract: [2026-08-16-surfaces-terminal-work-loops.md](vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md). Out of scope (GPU terminal embedding, worktree, turn-diff, review-comment pick) stays in that note; do not fake those capabilities.

Surface tabs keep the close control **to the right of the title**. Do not move it unless the user explicitly asks.

## Product handbook

Architecture, flows, and module maps live in [docs/handbook/README.md](docs/handbook/README.md). Read the matching handbook module before editing a product area; keep long current-state explanation there, not in chat.

## Feature Spine

Product behavior that ships and will be re-edited lives under [docs/features/](docs/features/README.md): one card per feature binds user paths, invariants, allowed touch, gates, and source links. Specs and plans stay in `docs/superpowers/`; cards hold shipped invariants only. The handbook does not replace cards.

1. Before changing product behavior, open `docs/features/<id>.md`. If there is no card, add one first or state explicitly that this is a local fix that does not change the product contract.
2. Start the session with `Touching: <id>` (template in [docs/features/README.md](docs/features/README.md)). Keep the diff inside that card’s **Allowed touch**; expanding scope needs user confirmation.
3. After the change, update the card’s `last verified`. If invariants or user paths changed, edit the card and keep any matching short `.cursor/rules` entry in sync.
4. Prefer commit subjects `feature(<id>): …` so regressions are traceable against the card.
