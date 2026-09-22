# Production QA Blockers Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the 2026-08-21 production acceptance Critical blockers so Windows installers ship a working Ghostty terminal (no wasm 404), pack/extract cannot silently omit assets, automation gates are green or honestly fixed, and appendix-A can pass in-app on a fresh package.

**Architecture:** DEF-002 is a **build + pack + runtime-reuse** failure, not a Ghostty engine bug. Root `pnpm run build` / `build:lib:client` runs `tsc` + `tsdown` but does **not** run `ui-user-terminal`'s `copy-ghostty-assets.mjs` (that step only lives on the package-local `bundle` script). `lib/` is gitignored, so a clean build can emit `lib/client.js` with **no** `lib/assets/*.wasm`. Pack copies that tree into `deepseek-harness.tar`; the host serves `dirname(client.js)/assets/<file>` → 404. `hasBuiltHarness` only checks CLI + web dist, so a bad extract under `userData/runtime/<version>` never self-heals. Fix by (1) making asset copy part of the normal client build or an unavoidable pre-pack step, (2) failing `afterPack` without wasm, (3) rejecting incomplete extracts at runtime. DEF-001 (`qa:source` walk failures) is a **separate** track: source trees already had assets when the walk failed, so do not treat it as a Ghostty cascade—retest after DEF-002, then harden walk or product only with new evidence.

**Tech Stack:** Desktop `scripts/after-pack.js`, `scripts/setup-harness.js`, `src/main/harness-extract.js`; vendored `ui-user-terminal` (`copy-ghostty-assets.mjs`, `assets.ts`, `runtime.ts`); `qa:source` / `qa:composer`; acceptance under `docs/qa/`.

**Spec / evidence:**
- [`docs/qa/results/2026-08-21/EXECUTION-REPORT.md`](../../qa/results/2026-08-21/EXECUTION-REPORT.md)
- [`docs/qa/production-acceptance-test-cases.md`](../../qa/production-acceptance-test-cases.md)
- Agent Note (background): `vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-19-terminal-ghostty-libghostty-vt.md`
- Review of this plan: session 2026-08-21 (build path omits copy; DEF-001 not proven cascade)

## Delivery standard for this plan

**In scope (must be true to close this plan):**

- No `libghostty-vt (404)` on packaged Windows build (drawer + surface).
- Pack gate fails without wasm; incomplete `userData` runtime re-extracts or repairs.
- `npm run qa:composer` and `npm run qa:source` exit 0 (or walk fixes landed with tests).
- Appendix A turns 1–5 pass **in-app** on the fixed package.
- Short release note for users stuck on bad 0.2.6 extracts.

**Explicitly not required to close this plan** (spot-check or later round / exemption): full P0 matrix extras (识图、主题库、卸载、升级矩阵全量), P1/P2, macOS/Linux installers.

## Global Constraints

- Windows x64 installer is the delivery artifact; source QA is necessary but not sufficient.
- Do not commit API keys.
- Prefer foundation fixes: wire copy into the build/pack path; missing wasm must fail pack; do not soft-skip Ghostty at runtime.
- `hasBuiltHarness` must use the **same on-disk layout** the plugin asset server uses (`dirname(client.js)/assets/…`). Wrong paths cause either sticky 404 or wipe-and-re-extract every launch.
- Same-version hotfix (still `0.2.6`) must self-heal via Task 4; bumping to `0.2.7` alone is not a substitute for the completeness check.
- Keep official `dsh web` language; no xterm rollback in this plan.
- Verification ladder: focused unit tests → `qa:composer` → `qa:source` → packaged smoke + wasm probe → in-app appendix A → update execution report.

## Confirmed root causes

| ID | Symptom | Cause | Independence |
| --- | --- | --- | --- |
| DEF-002 | `Unable to load libghostty-vt (404)` | Packaged runtime has `lib/client.js` but no `lib/assets/ghostty-*.wasm` (both `packages/client/ui-user-terminal` and `node_modules/@deepseek-ai/dsh-client-ui-user-terminal`). Host resolves `join(dirname(client.js), 'assets', name)`. | Product Critical |
| DEF-002a | Clean build can omit assets | Root `build` / `build:lib:client` does not run `copy-ghostty-assets.mjs`; only package `bundle` does. `lib/` is gitignored. | **Primary** build-path bug |
| DEF-002b | Upgrade may not self-heal | `hasBuiltHarness` only checks `apps/cli/lib/bin.js` + `apps/web/dist/index.html`. | Runtime reuse bug |
| DEF-001 | `qa:source` fails drawer / agents / diff / browser / terminal.surface | Walk/selectors/timing and/or product UI; **source tree already had wasm** when this failed; composer terminal path passed. | **Separate** from DEF-002 — retest after fix, then fix with new evidence |
| DEF-003 | Appendix A incomplete in-app | Coverage gap, not a code defect. | Acceptance only |

## File map

| File | Responsibility |
| --- | --- |
| `vendor/.../ui-user-terminal/scripts/copy-ghostty-assets.mjs` | Copies wasm/font into `lib/assets` |
| `vendor/.../ui-user-terminal/package.json` | Local `bundle` script (insufficient alone) |
| Harness root build (`package.json` / `scripts/build.ts` or equivalent hook) **or** desktop pre-pack | **Must** invoke copy after client tsdown |
| `scripts/setup-harness.js` | `pnpm run build` — inherits fixed root build or adds explicit copy |
| `scripts/after-pack.js` | Assert wasm beside staged `client.js`; fail pack otherwise |
| `src/main/harness-extract.js` | Completeness includes wasm; wipe+re-extract incomplete trees |
| `src/main/harness-extract.test.js` | Unit tests for completeness / re-extract |
| after-pack tests | Gate tests for missing/present assets |
| `src/main/release-ui-walk.js` | Only if DEF-001 still red after DEF-002 |
| `docs/qa/results/...` | Evidence |
| Desktop release notes / short decision note | Not a harness Agent Note unless harness build scripts change |

---

### Task 1: Baseline reconfirm (≤5 min)

**Files:** read-only install + source paths (optional one-line note in the next execution report).

**Steps:**
- [ ] Confirm installed `runtime/<ver>/.../ui-user-terminal/lib/assets/` missing while `lib/client.js` present (packages and/or node_modules).
- [ ] Confirm source `lib/assets/ghostty-vt.wasm` present locally.
- [ ] Skip a long baseline doc unless something contradicts the table above.

**Done when:** No contradiction with DEF-002 / DEF-002a.

---

### Task 2: Wire Ghostty asset copy into the normal build path (primary fix)

**Files:**
- Modify (pick the smallest durable hook — prefer one):
  - Harness: root client build after tsdown for `ui-user-terminal`, **or** package `tsdown`/post-build hook that always runs `scripts/copy-ghostty-assets.mjs`
  - And/or desktop: `scripts/setup-harness.js` / pre-`afterPack` step that runs the copy against `vendor/deepseek-harness/packages/client/ui-user-terminal`
- Keep: `copy-ghostty-assets.mjs` as the single copy implementation (DRY)

**Steps:**
- [ ] Reproduce: delete `lib/assets`, run the **same build command pack uses** (`pnpm run build` in vendor or documented pack prerequisite), show assets still missing **before** the fix.
- [ ] Implement the hook so that command always leaves:
  - `lib/assets/ghostty-vt.wasm`
  - `lib/assets/ghostty-write-pty.wasm`
  - `lib/assets/SymbolsNerdFontMono-Regular.woff2`
- [ ] Re-run build on a cleaned `lib/assets` and confirm files return.
- [ ] If the hook lives in harness, update harness Agent Note in Task 8; if only desktop pre-pack, document under desktop docs/release notes only.

**Done when:** Clean `build` (or the exact pack prerequisite) cannot produce `client.js` without sibling `assets/` wasm.

---

### Task 3: Fail pack if Ghostty assets are missing

**Files:**
- Modify: `scripts/after-pack.js` (`assertHarnessRuntime`)
- Test: existing after-pack test style or new focused test next to it

**Interfaces:**
- Resolve the staged terminal package the same way the runtime will: directory that contains `lib/client.js`, then require `lib/assets/ghostty-vt.wasm` (and write-pty; font recommended).
- Accept either layout if both can appear after flatten:
  - `packages/client/ui-user-terminal/lib/assets/...`
  - `node_modules/@deepseek-ai/dsh-client-ui-user-terminal/lib/assets/...`
- Rule: **at least one** complete `client.js` + `assets` pair must exist; error message lists checked paths.

**Steps:**
- [ ] Failing test: fixture with `lib/client.js` and no assets → `assertHarnessRuntime` throws naming `ghostty-vt.wasm`.
- [ ] Passing test: fixture with assets → no throw for those paths.
- [ ] Implement assertion after staged harness is fully copied, before tar.
- [ ] Run focused tests.

**Done when:** `afterPack` cannot ship a tar without Ghostty assets on disk.

---

### Task 4: Invalidate incomplete extracted runtimes

**Files:**
- Modify: `src/main/harness-extract.js`
- Modify: `src/main/harness-extract.test.js`

**Steps:**
- [ ] Extend completeness beside CLI + web: require Ghostty wasm next to the terminal `lib/client.js` that the extract actually contains (same dual-layout rule as Task 3).
- [ ] If extracted dir exists but fails completeness → `rm` and re-extract from tar (do not keep serving it).
- [ ] Unit-test incomplete → re-extract; complete → no re-extract.
- [ ] Guard against false negatives: only require paths that exist in a known-good pack fixture.

**Done when:** Installing/running a fixed build repairs a previously bad `userData/runtime/<sameVersion>` without manual delete.

---

### Task 5: Rebuild package + wasm probe

**Files:**
- Run: `npm run dist` (Windows)
- Evidence: `docs/qa/results/<date>/`

**Steps:**
- [ ] Build with gates on.
- [ ] Negative once: strip assets pre-assert → pack fails.
- [ ] Positive: unpacked/extracted tree has wasm beside `client.js`.
- [ ] Launch packaged app; open terminal drawer — **no** 404 banner; pane paints.
- [ ] Probe: HTTP GET `/plugins/@deepseek-ai/dsh-client-ui-user-terminal/assets/ghostty-vt.wasm` → **200** (or equivalent packaged smoke assertion).
- [ ] Optionally extend packaged smoke to assert that status once.

**Done when:** Fresh package proven on disk + over HTTP + visually.

---

### Task 6: Re-run DEF-001; harden walk only with new evidence

**Files:**
- Run: `npm run qa:composer`, `npm run qa:source`
- Modify only if still red: `src/main/release-ui-walk.js` (+ tests)

**Steps:**
- [ ] `qa:composer` must stay green.
- [ ] `qa:source` after DEF-002 fix. If green → record log; **no** walk drive-by.
- [ ] If still failing: keep artifacts (`DSH_SMOKE_KEEP=1`), identify whether drawer height, `dshd-open-surface` settle, or preview URL/toolbar selectors are wrong; minimal walk or product fix; re-run to green.
- [ ] Do not close DEF-001 as “fixed by wasm” without a green `qa:source` log.

**Done when:** Both QA scripts exit 0.

---

### Task 7: Product follow-ups only if walk is green but UI is wrong

**Steps:**
- [ ] Manual Browser URL / Agents empty copy only if Task 6 proves product mismatch.
- [ ] Minimal fixes; no surfaces refactors.

**Done when:** No open Critical from DEF-001 product side, or written N/A with evidence.

---

### Task 8: Appendix A in-app + execution report + notes

**Files:**
- Update: `docs/qa/results/<date>/EXECUTION-REPORT.md` (new dated report OK)
- Update: `.github/release-notes.md` (next tag)
- Docs: **desktop** short note if only `after-pack` / `harness-extract` / desktop setup changed
- Harness Agent Note triplet **only if** Task 2 changed harness build/bundle scripts under `vendor/deepseek-harness`

**Steps:**
- [ ] In-app appendix A turns 1–5 on fixed package (tools + approvals as needed).
- [ ] Spot-check tray close/quit if time; not a blocker for closing **this** plan if Criticals are clear (record Partial).
- [ ] Flip report conclusion when delivery standard above is met.
- [ ] Release notes: wasm in installer; old incomplete runtime auto-repairs; advise upgrade from 0.2.6 bad extracts.

**Done when:** Report matches delivery standard; users know why 0.2.6 terminal broke and how it heals.

---

## Verification ladder (final)

1. Focused unit tests (pack assert + extract completeness)  
2. Clean build → `lib/assets` present without manual copy  
3. `npm run qa:composer`  
4. `npm run qa:source`  
5. Packaged smoke + wasm HTTP 200  
6. Manual/CDP: no ghostty 404  
7. In-app appendix A five turns  
8. Execution report + release notes  

## Out of scope

- Replacing Ghostty with xterm  
- macOS/Linux installer matrices as gate  
- Full remaining P0/P1/P2 acceptance (unless time left after close)  
- Enabling remote / mobile SPA  

## Suggested execution order

Task 1 → **2 (build hook)** → **3 (pack gate)** → **4 (extract repair)** → 5 → 6 → (7 if needed) → 8
