# Gitee route parity evidence (Lane E)

Date: 2026-09-25 (UTC+8 timestamps in dumps). Repo under test:
`https://gitee.com/ayase/Deepseek-Harness-Desktop` — anonymous `GET /api/v5/repos/...`
→ **200**, `{private:false, public:true, default_branch:"main"}`.

**VERDICT: PARITY PASS** — anonymous metadata, anonymous asset download, and the
SHA512SUMS.txt checksum round-trip all work end-to-end on a real release with real
bytes. Two Gitee-vs-GitHub behavioral differences found (see Findings); neither
breaks `release-source.js` as written, but one (`/releases/latest` leaks
prereleases) should be decided before flipping `verified: true`.

## 1. Anonymous baseline (before any writes)

| Request (no token) | Status | Body |
|---|---|---|
| `GET /api/v5/repos/ayase/Deepseek-Harness-Desktop/releases?per_page=30` | 200 | `[]` |
| `GET /api/v5/repos/ayase/Deepseek-Harness-Desktop/releases/latest` | 404 | `{"message":"404 Not Found"}` |

Response headers (dump: `gitee-assets/anon-latest.headers`): `X-RateLimit-Limit: 60`,
`X-RateLimit-Remaining: 58` — anonymous quota same order as GitHub's 60/hr.

## 2. Authenticated writes (token, write path only)

| Request | Status | Result |
|---|---|---|
| `POST /releases` `tag_name=v0.0.0-parity-test, name=parity-test, target_commitish=main, prerelease=true` | 201 | release id `1165913` (dump: `create-release.json`) |
| `POST /releases/1165913/attach_files` `Deepseek-Harness-Desktop-Setup-0.0.0-parity.exe.bin` (1,572,864 B random) | 201 | asset id `3268223` (dump: `upload-bin.json`) |
| `POST /releases/1165913/attach_files` `SHA512SUMS.txt` (182 B) | 201 | asset id `3268224` (dump: `upload-sums.json`) |

`browser_download_url` returned by the API for uploaded assets:
`https://gitee.com/ayase/Deepseek-Harness-Desktop/releases/download/v0.0.0-parity-test/<name>`
— identical *shape* to GitHub's `/releases/download/<tag>/<name>`.

## 3. Anonymous metadata (after upload, no token)

| Request | Status | Notes |
|---|---|---|
| `GET /releases?per_page=30` | 200 | 1 release; `assets[]` = 4 entries (2 uploaded + 2 auto source archives) — dump: `anon-releases-after.json` |
| `GET /releases/latest` | **200 returning the prerelease** | GitHub excludes prereleases here; Gitee does not — Finding F1 |
| `GET /releases/tags/v0.0.0-parity-test` | 200 | dump: `anon-tag.json` |

Observed object shapes:
- Release keys: `id, tag_name, target_commitish, prerelease, name, body, author, created_at, assets`.
  **No `html_url`, no `draft`, no `published_at`.**
- Asset keys: **`browser_download_url`, `name` only** — no `size`, `download_count`,
  `content_type`. `normalizeAssets()`'s `download_url` fallback is unused but harmless.
- Auto-injected archive assets: `v0.0.0-parity-test.zip` / `.tar.gz` pointing at
  `/archive/refs/tags/...` appear inside `assets[]` (GitHub exposes archives via
  `zipball_url`/`tarball_url`, *not* in `assets[]`) — Finding F2.

## 4. Anonymous asset downloads (no token, no cookies supplied)

Both fetched via `curl -L` from the `browser_download_url` in the anonymous JSON
(dumps: `dl-bin.headers`, `dl-sums.headers`):

| Asset | Chain | Final | Bytes |
|---|---|---|---|
| `.../releases/download/v0.0.0-parity-test/Deepseek-Harness-Desktop-Setup-0.0.0-parity.exe.bin` | 302 → `gitee.com/.../attach_files/3268223/download/<name>` → 302 → `foruda.gitee.com/attach_file/...?token=<signed>&ts=<exp>&attname=<name>` | **200** `application/octet-stream`, `Content-Length: 1572864`, `Content-Disposition: attachment` | 1,572,864 |
| `.../releases/download/v0.0.0-parity-test/SHA512SUMS.txt` | same 2-hop pattern via `attach_files/3268224` | **200**, `Content-Length: 182` | 182 |

Also verified: `GET /attach_files/<id>/download/<name>` anonymously → 302 straight
to the signed foruda CDN URL. No login redirect, no 403 at any hop.

**Hash verification** (`node`, local originals vs anonymous downloads):

```
orig sha512 : af874c2ffb442259829994c6349f615e76731abbc92cc47001a2900c07c3c328c32171049ae1cc12e9295182fc548afdd81749c06d3fbc7a0e3551ec51f8cd2c
dl   sha512 : af874c2ffb442259829994c6349f615e76731abbc92cc47001a2900c07c3c328c32171049ae1cc12e9295182fc548afdd81749c06d3fbc7a0e3551ec51f8cd2c
manifest    : af874c2ffb442259829994c6349f615e76731abbc92cc47001a2900c07c3c328c32171049ae1cc12e9295182fc548afdd81749c06d3fbc7a0e3551ec51f8cd2c
bytes equal : true   hash match : true   SHA512SUMS.txt download identical : true
```

## 5. Cleanup

`DELETE /releases/1165913` (token) → **204**. Post-delete anonymous baseline
restored: `/releases` → 200 `[]`, `/releases/latest` → 404. Uploads all succeeded,
so removal is permitted and done; the release no longer exists for debugging —
this file plus `gitee-assets/` dumps are the record.

## 6. Comparison vs `src/launcher/release-source.js` (gitee block, lines 18-29, 47-90)

Matches reality:
- `apiBase` URL correct; `/releases`, `/releases/latest`, `/releases/tags/<tag>`
  all reachable anonymously with JSON bodies.
- `giteeJson` 404→`null` matches the observed empty-latest contract.
- `normalizeAssets()` prefers `browser_download_url` — present on every Gitee asset.
- `summarizeForRoute` `release.html_url || desc.page` fallback is *required* on
  Gitee (no `html_url` in the payload) and works.
- `update.downloadFile` follows redirects (≤8) — the observed 2-hop chain
  (page URL → `attach_files` → signed `foruda.gitee.com` CDN URL) fits; final hop
  sends a correct `Content-Length`, so the content-length check passes.
  `downloadHeaders` only attaches `Authorization` for GitHub hosts — anonymous
  Gitee fetches stay clean. The signed CDN URL carries `token`/`ts` and expires,
  so redirect-following at fetch time (as implemented) is mandatory.
- `pickChecksumAsset` (`SHA512SUMS.txt` exact) + `parseSha512Sums`
  (`<hex>  <name>`) match the manifest format proven above.
- `pickInstaller` requires `/\.exe$/i` — real `*-Setup-x.y.z.exe` uploads will
  match (the parity `.exe.bin` asset deliberately did not).

## Findings

- **F1 (behavioral, decide before `verified:true`):** Gitee `/releases/latest`
  returns prereleases — verified: our `prerelease:true` release was served as
  `latest` (200). `latestFor()`/`summarizeRelease()` keep the `prerelease` flag
  but never filter it, so a higher-version prerelease on Gitee would be offered
  as an update where GitHub would not. Recommend filtering `release.prerelease`
  in the gitee path (or accept and document) before enabling the route.
- **F2 (shape, benign today):** `assets[]` includes auto source archives
  (`/archive/refs/tags/*.zip|.tar.gz`). Harmless to `pickInstaller` (`.exe`
  filter) and `pickChecksumAsset` (exact-name), but any future code assuming
  `assets[]` == uploaded files will miscount.
- **F3 (minor):** no `html_url` on releases → `htmlUrl` falls back to the generic
  releases index page, not the per-tag page (`/releases/<tag>` exists on the web
  UI; could be synthesized if a deep link is wanted).
- **F4 (informational):** asset objects carry only `name` + `browser_download_url`;
  no `size`. Progress UI can rely on `Content-Length` at download time instead.

## Recommendation

The anonymous read path — release metadata, installer-asset download, and
SHA512SUMS.txt verification — is proven end-to-end on the real repo with
byte-identical round-trip. The URL pattern `release-source.js` consumes
(`browser_download_url` → `/releases/download/<tag>/<name>` → signed CDN) matches
reality exactly. The gitee route can be marked **verified for the download
contract**, conditional on a decision for F1 (prerelease leak in `/latest`).
No source changes were made by this lane.

## Evidence inventory (`docs/superpowers/evidence/gitee-assets/`)

- `anon-repo.json`, `anon-releases.json`, `anon-latest.json` + `.headers` — pre-test baseline
- `create-release.json`, `upload-bin.json`, `upload-sums.json` — authenticated write responses
- `anon-releases-after.json`, `anon-latest-after.json`, `anon-tag.json` — anonymous metadata with release live
- `dl-bin.headers`, `dl-sums.headers` — full anonymous redirect chains
- `Deepseek-Harness-Desktop-Setup-0.0.0-parity.exe.bin`, `SHA512SUMS.txt` — uploaded originals
- `dl-*.bin`, `dl-SHA512SUMS.txt` — anonymous downloads (byte-identical)
- `delete-release.json`, `post-delete-*.json` — teardown + restored baseline
