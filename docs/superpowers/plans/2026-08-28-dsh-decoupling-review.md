# dsh decoupling review — necessity and stability audit of the landed work

> **SUPERSEDED (2026-08-28).** Trent confirmed a **full revert (全量回撤)** of all dsh decoupling work. PR #67 was merged into main (`541d36d5`) as-is, reverting both #64 and #66 in their entirety — including the token-mirror gate and handoff-doc corrections this review recommended keeping. The narrow-revert recommendation below was not adopted; this doc stays on its branch as a historical record and is not merged into main.

**Date:** 2026-08-28 · **Reviewed tree:** `main@47a35cec` (merge of PR #66) · **In flight:** PR #67 (`cursor/revert-dsh-decoupling-aebd`, OPEN, clean two-commit revert of #66 then #64, exactly the 13 landed files)

**Kind:** review note (doc-only, no product-contract change; no feature card touched). Strict audit of PR #64 (decoupling analysis) and PR #66 (Phase 0 instrumentation): was it necessary, and does it affect application stability or day-to-day usage?

## 1. Verified facts

- **Runtime neutrality holds.** Neither `src/shared/harness-fork-delta.js` nor `src/shared/dsh-webui-token-mirror.js` is imported by any main/preload/renderer module — the only consumers are `scripts/check-harness-fork-delta.js`, the test files, and CI (grep across the repo excluding vendor). Phase 0 touched no spawn (`src/main/dsh.js`), no overlays (`harness-controller.js` patch assembly), no IPC (`src/preload/index.js`), no packaging logic (`after-pack.js`). The two modules + tests do land as **dead files in the packaged asar** (`build.files` includes `src/**/*`, same as every other `*.test.js` already shipped); no code path loads them.
- **Gates run green as landed.** 21/21 unit tests pass (`node --test` on the two suites); `check:fork-delta` completes in ~8.5 s and reports exactly the committed baseline (1,372 changed paths → 431 registered / 18 marked / 2 composition / 921 unregistered, M=604). CI runs for PR #66 and the main merge both succeeded.
- **Sync dry-run is genuinely report-only.** Reproduced against `dsh-v0.1.1-rc.2`: 20 conflicts (matches the execution plan's recorded number), exit 0, and afterwards no worktree, no `refs/backup/harness-pre-sync`, no working-tree change. A dirty tree is refused up front by `assertClean` (verified — it even rejects an untracked file). The weekly workflow has **never run yet** (first scheduled slot 2026-08-31).
- **The fork-delta CI job fetches upstream on every run.** `actions/checkout` is shallow, so the pin commit is never local and `ensurePinCommit` fetches `dsh-v0.1.1-rc.1` from `github.com/deepseek-ai/deepseek-harness` on each PR — a new external network dependency in PR-blocking CI.
- **The ratchet trips on routine work.** Any new unregistered vendor path exceeds `UNREGISTERED_BASELINE.total` (921) — including new `.agents/notes` files, which the repo's own workflow mandates for vendor slices (232 of the 306 unregistered adds are notes). Most vendor-touching product PRs will red the gate and need a one-line baseline bump. That is documented intent ("consciously raised in the same PR"), but it normalizes bumping and dilutes the drift signal.
- **The revert also deletes non-decoupling content.** #67 restores the pre-#66 `2026-08-27-dsh-tools-upstream-handoff.md`, whose extraction instructions were **verified wrong** during Phase 0 (the PR #54 merge diff does not apply upstream because `core/session`/`core/agent-loop` context includes `ddabf839`; rc.2 lacks the fix). Reverting reinstates a broken procedure.

## 2. Verdict on necessity

1. **Wholesale decoupling: not necessary, and the analysis said so.** #64's defer verdict is correct and its numbers reproduce (625 modified upstream files; the desktop *is* the fork). No decoupling of product code was performed or should be.
2. **Phase 0: not necessary for shipping or stability of the app itself.** Zero runtime effect (above). It is risk-management tooling for future pin bumps and fork-surface hygiene — optional by construction, per its own rollback note ("no runtime surface depends on any of it").
3. **Standalone value ranking** (independent of any decoupling ambition):
   - **Token-mirror gate — highest.** Guards a *shipped* design-language invariant (launcher/boot/installer parity with `design-platform.css`, 63 tokens × 2 themes), closing analysis §6.5. This is a product-parity gate mislabeled as decoupling work.
   - **Handoff doc corrections — real.** Factual fixes verified against actual upstream trees; losing them is a regression.
   - **Sidecar-by-default paragraph — small but sound.** 4 lines codifying the already-observed practice (usage-panel / dsh-im / dshbot).
   - **Sync dry-run sentinel — conditional.** Valuable only if a pin bump is on the roadmap (upstream moved rc.2→HEAD from 20 to 311 conflicts within one day, so the pricing is informative); worthless standing cost otherwise.
   - **Fork-delta ratchet — weakest as built.** Enforces registry completeness, but the notes-trip friction plus the upstream-fetch dependency in PR-blocking CI make it the noisiest piece. If kept, `.agents/notes/**` should be exempted from the unregistered bucket.
4. **Was reverting the right call?** Directionally yes if Trent's intent is "no decoupling program" — but #67 as cut is over-broad: it deletes the two artifacts whose value is unrelated to decoupling (token mirror, handoff corrections) and the analysis doc that itself argues *against* decoupling.

## 3. Stability / usage impact

| Artifact | End-user runtime | Dev/CI workflow | Sync/upgrade risk | Notes |
| --- | --- | --- | --- | --- |
| fork-delta ratchet (module + script + `test.yml` job) | **None** (no runtime import; dead file in asar) | **Medium friction**: baseline bump on most vendor PRs; upstream fetch in blocking CI can red on network/upstream outage; +1 job ≈10 s | Improves registry fidelity | CI green at baseline verified |
| sync dry-run (script + weekly workflow) | **None** | **None on PRs** (separate schedule, conflicts exit 0); weekly runner minutes | **Reduces** it: continuous conflict pricing | Residue-free + dirty-tree guard verified; never yet run on schedule |
| token-mirror gate (module + tests in `npm test`) | **None** | **Low**: +66 ms; fails when vendor tokens change without mirror update — intended, actionable | n/a | Removal = **medium design-parity risk**: next `ui-theme` token change silently diverges launcher/boot/installer visuals |
| sidecar-by-default paragraph | None | None | None | Policy prose only |
| handoff doc edits | None | None | Keeps the upstream handoff executable | Revert reinstates a verified-broken extraction command |
| analysis doc (#64) | None | None | None | Institutional record of *why not* to decouple |

## 4. Keep vs revert

- **Keeping everything on main:** worst realistic outcomes are (a) chronic baseline bumps training contributors to raise the ratchet blindly, (b) an occasional false-red PR when the upstream fetch fails, (c) unnoticed weekly-job rot. Nothing can affect users.
- **Merging #67 as-is:** no user-facing regression either — but it loses the only machine check on token parity right when `ui-theme` carries active fork work (46 unregistered changed paths; wallpaper + transparent-theme), restores broken handoff instructions, deletes the defer-verdict record (inviting the same analysis to be redone), and returns pin-bump conflict discovery to upgrade time (measured price already at 311 conflicts vs upstream HEAD).

## 5. Recommendation

**Narrow the revert; do not merge #67 as-is.** Concretely:

1. **Remove** (the decoupling-shaped, friction-carrying pieces): the `fork-delta` CI job + `scripts/check-harness-fork-delta.js` + `src/shared/harness-fork-delta.{js,test.js}` + `check:fork-delta`, and the weekly `harness-sync-dry-run.yml` + `scripts/check-harness-sync-dry-run.js` + `check:sync-dry-run` — unless a pin bump is planned soon, in which case keep the dry-run pair.
2. **Keep** (non-decoupling value): `src/shared/dsh-webui-token-mirror.{js,test.js}` (runs inside existing `npm test`; guards the design-language card), the handoff doc corrections, the Feature Spine sidecar paragraph (drop its fork-delta sentence if the ratchet goes), and the #64 analysis doc as the standing record of the defer decision.
3. If the ratchet is instead kept, exempt `.agents/notes/**` from the unregistered bucket and pre-fetch or vendor the pin object to de-flake CI.

Either endpoint is safe for users: **no Phase 0 artifact has any effect on end-user runtime**, so this decision is purely about developer-workflow cost vs guard-rail value.
