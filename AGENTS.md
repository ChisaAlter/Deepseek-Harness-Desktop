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

## Native window motion

Windows main/launcher windows must preserve native DWM transitions. Follow [window-motion](docs/features/window-motion.md): 20px transparent page-painted corners AND native animation styles; never trade away either. Pets/overlays are separate. After window styling, Electron upgrades or upstream integration, run `node scripts/run-window-motion-qa.mjs` on Windows; state-only checks do not certify visible animation. On an interactive desktop also run with `--composed`: all four corners must remain transparent after activation, blur, resize and restore; page alpha alone misses DWM rectangular borders.

## Surfaces and terminal (work loops)

The right column and conversation terminal drawer implement **work loops** (Files search/save, Browser navigation, Diff scopes, selection into chat), not an empty-state card grid. Empty-state cards are not done. Contract: [2026-08-16-surfaces-terminal-work-loops.md](vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md). Out of scope (GPU terminal embedding, worktree, turn-diff, review-comment pick) stays in that note; do not fake those capabilities.

Surface tabs keep the close control **to the right of the title**. Do not move it unless the user explicitly asks.

## Product handbook

Architecture, flows, and module maps live in [docs/handbook/README.md](docs/handbook/README.md). Read the matching handbook module before editing a product area; keep long current-state explanation there, not in chat.

## Maintenance system（治理）

发布工作以 [发布操作流程](docs/handbook/modules/release-process.md) 为唯一当前执行规则：固定范围与候选，局部诊断先分类，核心加影响验收，最终原包晋级。历史报告、旧全表要求和技能中冲突的执行约定不覆盖该流程。不得替用户签署放行或编造偏好；用户当前明确要求优先。

[docs/maintenance/README.md](docs/maintenance/README.md) 是系统总览：契约层（feature 卡 + rules）、决策层（[docs/decisions/](docs/decisions/README.md)）、叙事层（docs/postmortem/）、语言层（docs/i18n/）、执行层（`scripts/verify-*` + git hooks）。

- 只为长期架构、兼容性、持久格式或流程取舍写/更新决策；普通修复用提交说明和行为证据即可。新内部记录默认单语，已授权工作可直接实施，不必先走提案。操作流见 `.devin/skills/dshd-maintenance`。
- 已配对文档在核对两侧后 `verify-translation-pairing --write` 重录 sidecar；内部单语记录不要求翻译。
- Bug 修复保留能发现旧故障的行为复现，并核对 CI 发现范围。反复出现时先区分回归、未闭环和相似症状；文档、字符串或属性门禁不代表用户实际结果通过。
- 本地门禁：`npm run check:governance`（结构）/ `npm run doc-sync`（全量文档）；选检查见 `.devin/skills/dshd-checks`。外部 PR/issue 开放，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Feature Spine

Product behavior that ships and will be re-edited lives under [docs/features/](docs/features/README.md): one card per feature binds user paths, invariants, allowed touch, gates, and source links. Specs and plans stay in `docs/superpowers/`; cards hold shipped invariants only. The handbook does not replace cards.

1. Before changing product behavior, open `docs/features/<id>.md`. If there is no card, add one first or state explicitly that this is a local fix that does not change the product contract.
2. Identify the relevant card when useful. **Allowed touch** locates the expected implementation; it is not an approval boundary. Within authorized work, update it when necessary files change; ask only for a missing material product decision.
3. Update affected current facts and the latest relevant `last verified` evidence, linking history instead of appending release journals. Rules should point to the owning card and avoid duplicating detailed contracts. Reference checks do not certify semantic agreement.
4. Prefer commit subjects `feature(<id>): …` so regressions are traceable against the card.

## Running the app from source (agent workflow)

- Start: `npm start` (prestart rebuilds the vendored client when stale, then launches Electron). Inside Devin Desktop the shell inherits `ELECTRON_RUN_AS_NODE=1`, which makes `electron.exe` run as plain Node and exit silently with code 0 — always launch with `env -u ELECTRON_RUN_AS_NODE npm start`.
- User preference: **restart the app after every code change** (stop the repo's `electron.exe` processes, then relaunch). `vendor/dshbot` is junction-linked into `dsh-home/profiles/web/node_modules`, so plugin edits need only the restart, no re-ensure.
- If the prestart rebuild fails inside `tsc -b` with `TS6059`/`TS6307` errors blaming `apps/web`'s file list for files under `packages/**/src` (e.g. `http-proxy`, `session-*`), the cause is a stale incremental `tsconfig.tsbuildinfo` that still lists e2e tests since moved to the host-face `exclude` — run `node node_modules/typescript/bin/tsc -b apps/web --clean` (from `vendor/deepseek-harness`), then rebuild; do not "fix" `apps/web/tsconfig.json`.
