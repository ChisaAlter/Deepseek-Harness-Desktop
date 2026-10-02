# AGENTS.md — WhaleIsle

Electron desktop shell around the official DeepSeek Harness Web UI (`vendor/deepseek-harness`).

## Design language (mandatory)

Any UI, layout, or frontend change must follow the WhaleIsle design language defined in [docs/design-language.md](docs/design-language.md) — the sole visual authority, with its baseline pinned to the vendored harness Web UI (`vendor/deepseek-harness`; pin recorded in `vendor/harness-upstream.json`). Change the document first, then the code. Do not invent a second skin for the desktop chrome or new panels. The boot page is the documented instrument-canvas exception in [docs/design-language.md](docs/design-language.md#桌面启动页); do not spread that sheet.

- Product spec: [docs/design-language.md](docs/design-language.md)
- Motion recipes and inventory: [docs/motion.md](docs/motion.md)
- Token / CSS Modules mechanics: [vendor/deepseek-harness/docs/web-styling.md](vendor/deepseek-harness/docs/web-styling.md)
- Client plugin rules: [vendor/deepseek-harness/packages/client/AGENTS.md](vendor/deepseek-harness/packages/client/AGENTS.md)

Reuse `ui-primitives` and `--dsw-alias-*` tokens. The boot page consumes baseline font/motion tokens from [src/shared/dsh-webui-tokens.css](src/shared/dsh-webui-tokens.css) plus the `--boot-*` table in [src/renderer/boot-tokens.css](src/renderer/boot-tokens.css).

Harness-internal work also follows [vendor/deepseek-harness/AGENTS.md](vendor/deepseek-harness/AGENTS.md).

## Native window motion

Windows main/launcher windows must preserve native DWM transitions. Follow [window-motion](docs/features/window-motion.md): 20px transparent page-painted corners AND native animation styles; never trade away either. Pets/overlays are separate. When window styling, Electron upgrades or upstream integration affects the main/launcher window contract, run `node scripts/run-window-motion-qa.mjs` on Windows; state-only checks do not certify visible animation. On an interactive desktop also run with `--composed`: all four corners must remain transparent after activation, blur, resize and restore; page alpha alone misses DWM rectangular borders.

## Surfaces and terminal (work loops)

The right column and conversation terminal drawer implement **work loops** (Files search/save, Browser navigation, Diff scopes, selection into chat), not an empty-state card grid. Empty-state cards are not done. Contract: [2026-08-16-surfaces-terminal-work-loops.md](vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md). Out of scope (GPU terminal embedding, worktree, turn-diff, review-comment pick) stays in that note; do not fake those capabilities.

Surface tabs keep the close control **to the right of the title**. Do not move it unless the user explicitly asks.

## Product handbook

Architecture, flows, and module maps live in [docs/handbook/README.md](docs/handbook/README.md). Read the matching handbook module before editing a product area; keep long current-state explanation there, not in chat.

## Maintenance system（治理）

[WhaleIsle 维护系统](docs/maintenance/README.md)是整个仓库及所有 vendor 子项目唯一的项目维护准则。维护顺序、验证选择、成本限制与停止规则只在该处维护；[发布操作说明](docs/handbook/modules/release-process.md)细化候选和原包晋级，不另立准则。AGENTS、CLAUDE、技能、rules 和历史记录只定位负责契约与操作，不追加审批、测试阶梯或数字指标。用户当前明确要求继续优先。合并上游前先读该准则的[上游合并与差异保护](docs/maintenance/README.md#上游合并与差异保护)一节。

产品、持久数据、权限、设计与实际装配契约保持有效；普通修复复用已有测试和证据，禁止借清理削弱必要行为覆盖。维护操作入口见 `.devin/skills/dshd-maintenance`，验证工具入口见 `.devin/skills/dshd-checks`，外部贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Feature Spine

Product behavior that ships and will be re-edited lives under [docs/features/](docs/features/README.md): one card per feature binds user paths, invariants, allowed touch, gates, and source links. Specs and plans stay in `docs/superpowers/`; cards hold shipped invariants only. The handbook does not replace cards.

1. Before changing product behavior, open `docs/features/<id>.md`. If there is no card, add one first or state explicitly that this is a local fix that does not change the product contract.
2. Identify the relevant card when useful. **Allowed touch** locates the expected implementation; it is not an approval boundary. Within authorized work, update it when necessary files change; ask only for a missing material product decision.
3. Update affected current facts and the latest relevant `last verified` evidence, linking history instead of appending release journals. Rules should point to the owning card and avoid duplicating detailed contracts. Reference checks do not certify semantic agreement.
4. Prefer commit subjects `feature(<id>): …` so regressions are traceable against the card.

## Running the app from source (agent workflow)

- Start: `npm start` (prestart rebuilds the vendored client when stale, then launches Electron). Inside Devin Desktop the shell inherits `ELECTRON_RUN_AS_NODE=1`, which makes `electron.exe` run as plain Node and exit silently with code 0 — always launch with `env -u ELECTRON_RUN_AS_NODE npm start`.
- User preference: **restart the app after product runtime code changes** (stop the repo's `electron.exe` processes, then relaunch). Maintenance tooling and documentation changes do not require launching or packaging the product. `vendor/dshbot` is junction-linked into `dsh-home/profiles/web/node_modules`, so plugin edits need only the restart, no re-ensure.
- If the prestart rebuild fails inside `tsc -b` with `TS6059`/`TS6307` errors blaming `apps/web`'s file list for files under `packages/**/src` (e.g. `http-proxy`, `session-*`), the cause is a stale incremental `tsconfig.tsbuildinfo` that still lists e2e tests since moved to the host-face `exclude` — run `node node_modules/typescript/bin/tsc -b apps/web --clean` (from `vendor/deepseek-harness`), then rebuild; do not "fix" `apps/web/tsconfig.json`.
