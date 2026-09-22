# Marketplace Phase-1 review-fix plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Stay in the `feat/marketplace-parity` worktree.

**Goal:** Close the Phase-1 gaps the adversarial review proved: install specs match dsh-market `installTargetFor`, failed adds actually roll back, and a successful profile write plus failed `startHarness()` does not look like a failed install.

**Architecture:** Catalog rows resolve `installSpec` the way dsh-market does (valid `npm`, else `github:owner/repo` / `#path:/` from the GitHub URL). Last-token of `install` is only a fallback when it is already an allowed spec. Tarball/git/file URLs never reach `dsh plugin add`. Install validation snapshots profile deps and `node_modules`, removes unloadable or loader-id-colliding packages, and IPC returns a structured “installed, Harness down” result instead of throwing.

**Tech Stack:** Node `node:test`, Electron main, vendor vitest for `ui-settings-plugin-inventory`.

**Spec:** [docs/superpowers/specs/2026-08-18-marketplace-parity-design.md](../specs/2026-08-18-marketplace-parity-design.md)

## Global Constraints

- Do not preinstall or vendor `dshmarket`. Do not port hoist / release-age / fetchTimeout retries (explicit Phase-1 deferral).
- Do not widen Host `installPlugin` / `isValidGithubSpec` to `#path:` or tarballs.
- Do not implement Phase 2–4 (screenshots UI, themes, updates, backup, diagnostics).
- Do not send quoted GitHub-release `.tgz` URLs to the CLI.
- Frontend stays `ui-primitives` + `--dsw-alias-*`.
- TDD: failing test first, then minimal production code.

---

## Task 1: Catalog `installSpec` = dsh-market `installTargetFor`

Files: `src/main/marketplace-catalog.js`, `src/main/marketplace-catalog.test.js`, spec mapping table.

- Valid `npm` field wins (fixes Layer-1 vs last-token).
- Else `https://github.com/owner/repo` → `github:owner/repo`; `/tree/<ref>/<posix>` → `github:owner/repo#path:/<posix>`.
- Else unquoted last `install` token only if it is already an allowed npm/`github:`/`#path:` spec.
- TTL-fresh cache uses a “using recent cache” warning, not “online update failed”.
- Prove 4s abort and TTL expiry with tests.

## Task 2: Install rollback and loader-id collision

Files: `src/main/marketplace-install.js`, `src/main/marketplace-install.test.js`, `src/main/marketplace-allowbuilds.js`, `src/host/install-dsh-plugin-client.js` (+ its allowBuilds test).

- New `node_modules` names and matching existing profile specs count as installed names (GitHub empty delta still `remove`s).
- Reject owner/repo that does not match the row URL (test it).
- `dsh.bundle.patch: true` is not loadable; a real patch file is.
- Duplicate inserted loader ids vs already-installed bundles → `remove` and fail.
- Parse `prepare not allowed` (including ndjson `\"`) and `name@git+https://github.com/owner/repo.git` allowBuilds keys.

## Task 3: IPC / window / Settings copy

Files: `src/main/ipc.js`, `src/main/ipc.test.js`, `src/main/window.js`, `src/main/window-marketplace.test.js`, vendor marketplace tab + locales + desktop-shell types.

- `startHarness()` throw after `ok: true` returns `ok: true`, `harnessStarted: false`, Chinese explanation; do not throw to the renderer.
- UI shows that copy and does not treat it as “install failed, try add again”.
- Pending marketplace jump clears only after a successful jump.
- `refresh-marketplace` forwards locale the same way as list (no forced `'zh'`).
- Empty `installSpec` is not an Install CTA.

## Task 4: Docs

Rewrite spec install mapping, allow-list (`#path:`), boot queued jump, and the test bullet that still says npm-else-github. Update the Agent Note to the same present-tense facts.
