# AGPL shipping (desktop + Worker)

ChisaCode-derived code under `vendor/chisacode-remote/` is **AGPL-3.0-or-later**. The Electron shell remains MIT; mixing is intentional and must stay documented.

## Before any Setup / GitHub Release that includes this tree

1. **NOTICE** present at `vendor/chisacode-remote/NOTICE` (and called out from root README or license appendix).
2. **Corresponding source** available for network users of the modified Worker and for recipients of the desktop binary:
   - Public git tag / release asset with this directory, **or**
   - In-app / docs URL that points at the exact commit (AGPL §13 for remote interaction).
3. Top-level license blurb: MIT for shell; AGPL for `chisacode-remote` + deployed relay Worker forks.
4. Do not strip copyright headers from vendored files.
5. Accepting AGPL in product planning ≠ ready to ship Setup — this checklist must be green.

## Boundary

| MIT (shell) | AGPL (this fork) |
| --- | --- |
| `src/main/*` IPC, windows, launcher | `packages/server` daemon |
| `ui-settings-remote` chrome copy | `packages/relay` Worker |
| dsh-im / marketplace | `packages/protocol`, `client`, app pairing runtime |

Modified Worker in production is a network service under AGPL — publish corresponding source for that deployment.
