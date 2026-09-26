# Delta update pipeline evidence (Lane D)

Date: 2026-09-25. Machine: Windows 11, Node v26.7.0, repo `C:\Ai\Deepseek-Harness-Desktop`.
Real bases used: installed runtime `C:\Program Files\Deepseek-Harness-Desktop` (v0.3.2,
legacy product dir) and repo build output `dist\win-unpacked` (v0.3.3).

**VERDICT: PASS** — a delta artifact built between the real 0.3.2 subtree and the real
0.3.3 build applied onto a staged copy of 0.3.2 reproduces the 0.3.3 file set exactly
(67/67 files, all SHA-256 equal). Fail-closed behavior verified on the same real
artifact: a drifted base file aborts with `base-mismatch` before any byte is touched.

## Format (public edge)

Asset name: `<product>-delta-<from>-<to>.zip` (e.g. `Whale-Isle-delta-0.3.2-0.3.3.zip`);
artifact digest rides the release's existing `SHA512SUMS.txt`.

```
manifest.json:
{ "format": "dshd-delta@1", "product": "...", "fromVersion": "0.3.2", "toVersion": "0.3.3",
  "files": [ { "path": "resources/app.asar", "op": "patch",
               "baseSha256": "…", "sha256": "…", "size": N, "payload": "payload/0" },
             { "path": "x", "op": "add",    "sha256": "…", "size": N, "payload": "payload/1" },
             { "path": "y", "op": "delete", "baseSha256": "…" } ] }
```

`baseSha256` and `payload` are lane-internal fields on top of the frozen
`{path, op, sha256, size}` edge. `patch` payloads carry **whole replacement bytes**
(no binary diff yet — the win comes from shipping only changed files); the format
has room for a real binary-diff encoding later via a `payload` encoding field.
Paths are forward-slash relatives; `..`, drive letters, backslashes, absolute and
empty segments are rejected at manifest parse AND again at target resolution.

## Zip container choice

`package.json` ships **no** archive dependency (`unzipper@0.12.5` is a read-only
transitive of electron-builder; no yazl/adm-zip/archiver present). Chosen:
`src/launcher/delta/zip.js` — a ~150-line dependency-free store+deflate ZIP
writer/reader over `node:zlib` (CRC32 + central directory + streaming inflate on
extract). Not PowerShell `Compress-Archive`: it keeps tests hermetic, verifies
CRC32 per entry, and needs no child_process. Classic-zip limit: 65535 entries /
4 GiB per file — a full install tree (~102k files) exceeds the entry cap and the
writer refuses loudly (`zip entry count … exceeds limit`), which is correct: a
real delta only carries *changed* files.

## Apply semantics

`applyDeltaFile(zip, targetDir, { expectedSha512 })`:

1. artifact SHA-512 vs `SHA512SUMS.txt` value (when given),
2. `manifest.json` parse + per-payload sha256/size verified during streamed
   extraction into `<targetDir>/.dshd-delta-<pid>-<ts>/` (inside the tree →
   same-volume renames),
3. base-hash preflight on every patched/deleted file — any drift throws
   `base-mismatch` before a single target byte changes (idempotent re-apply:
   already-at-target patches and already-absent deletes are skipped),
4. commit by rename with backups (`staging/old/*`); on any commit failure the
   placed files are un-placed and backups restored, then staging is removed.

The failure surface is `DeltaApplyError.code` ∈ `artifact-sha512-mismatch`,
`bad-zip`, `manifest-invalid`, `payload-missing`, `payload-mismatch`,
`base-mismatch`, `target-missing`, `apply-failed` — all mean "use the full
installer". `installDelta` (src/launcher/delta/install.js) maps every one of
them plus download/verify/release-resolution failures to
`ctx.launcher.installRelease(tag)` — the same full path as
`shell:install-release` (slim/full split included) — returning `mode:'full'`
with `deltaFallback:<reason>`.

## IPC contract

`src/main/ipc-delta.js`: `shell:install-delta` on `LAUNCHER_ONLY`; progress via
`ctx.send(event, 'shell:update-progress', { delta:true, ...payload })`; returns
`{ok, mode:'delta'|'full', error?}`. `contributeStatus()` scans the delta cache
(`userData/deltas`, override `DSHD_DELTA_DIR`) synchronously →
`{deltas:{available:[{tag,from,size}], lastError?}}` or `null`.

## Elevation boundary

In-place apply writes into the install dir. Under `%LOCALAPPDATA%\Programs`
(per-user) it works unelevated; under `C:\Program Files` the renames hit ACL
denial → `apply-failed` → full installer (NSIS elevates via UAC). Locked
runtime files (running exe/dlls) behave the same way — `installDelta` probes
`probeDesktopRunning` and calls `stopExternalDesktop` first; still-busy →
`runtime-busy` → full path. The full package never self-patches (cannot patch
a running own install) — gated to `unsupported-package` → full path; the
electron-updater differential lane remains the self-update optimization.

## Local validation (real trees)

`tmp/delta-lab/` (gitignored): `v032` = top-level files + `locales/` +
`resources/app.asar` + `resources/app.asar.unpacked/` copied from the installed
0.3.2 dir (Program Files untouched — read-only copies only); `v033` = same
subtree from `dist/win-unpacked`.

```
node scripts/build-delta.mjs --from tmp/delta-lab/v032 --to tmp/delta-lab/v033 \
  --out tmp/delta-lab/Whale-Isle-delta-0.3.2-0.3.3.zip \
  --from-version 0.3.2 --to-version 0.3.3 --product Whale-Isle
→ ops: +5 ~4 -3 =58 unchanged; size 122,741,388 B (vs ~350 MB subtree)
  sha512sums: d30f9892…83eaa219  Whale-Isle-delta-0.3.2-0.3.3.zip
```

Ops breakdown on real data: `patch` `resources/app.asar` (51→66 MB) + 3 unpacked
workers; `add` `Whale Isle.exe` + 4 arm64 conpty prebuilds; `delete`
`Deepseek-Harness-Desktop.exe`, `Uninstall Deepseek-Harness-Desktop.exe`,
`uninstallerIcon.ico`.

Apply + verify (`applyDeltaFile` on `cp -r v032 staged-032`):
`{"ok":true,"fromVersion":"0.3.2","toVersion":"0.3.3","applied":{"added":5,"patched":4,"deleted":3,"skipped":0}}`;
`scanTree(staged)` vs `scanTree(v033)` → file-count 67=67, missing [], extra [],
hash-diffs [] → **ROUND-TRIP PASS**.

Fail-closed on the real artifact: append `TAMPERED` to `staged/resources/app.asar`
→ `apply rejected: base-mismatch - base file drifted: resources/app.asar`;
post-scan shows zero files changed and zero `.dshd-delta-*` staging leftovers.

CLI version-spec resolution also verified: `--to 0.3.3` resolves to
`dist\win-unpacked` (repo package.json version match); `--from <dir>` with
`--from-version` flags covers arbitrary trees.

## Tests

`node --test src/launcher/delta/*.test.js` → 29/29 pass:
zip CRC/tamper, manifest schema + path traversal rejection, build→apply
round-trip, base drift, artifact sha512 gate, add-conflict, idempotent
re-apply, hostile manifest, install orchestration fallbacks
(asset-missing/unverified/busy/no-base/unsupported-package/full-failure),
`shell:install-delta` register contract + `contributeStatus` shapes.

## Known limits / follow-ups for other lanes

- Whole-file `patch` payloads (no bsdiff); fine while app.asar dominates churn.
- `release-source.js` does not expose a raw release-with-assets fetcher;
  `install.js` replicates the route-aware `fetchJson` (GitHub via
  `update.githubJson`, Gitee inline) — a `releaseRaw(route, tag)` seam there
  would remove the duplication.
- `contributeStatus().deltas.available` is *locally cached* artifacts only;
  remote availability is a network call and stays out of the sync status path.
- Renderer wiring (`installDelta` button, progress labels for `apply`/
  `fallback` phases) is Lane A; phases emitted: `resolve`, `download`
  (`differential:true`), `verify`, `apply`, `install` (+`deltaFallback:<reason>`
  when handing off to the full installer).
