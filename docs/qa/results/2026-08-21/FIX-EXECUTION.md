# Production QA blockers — fix execution (2026-08-21)

## Changes shipped in tree

1. **`vendor/deepseek-harness` `build:lib:client`** now runs `copy-ghostty-assets.mjs` after tsdown.
2. **`scripts/setup-harness.js`** and **`scripts/after-pack.js`** call `ensureGhosttyAssetsInHarness` so every `lib/client.js` (packages/ and node_modules/) has `lib/assets/{ghostty-vt.wasm,ghostty-write-pty.wasm,SymbolsNerdFontMono-Regular.woff2}`. Pack fails if incomplete.
3. **`src/main/harness-extract.js`** `hasBuiltHarness` requires those assets; incomplete `%APPDATA%/…/runtime/<ver>` is wiped and re-extracted.
4. Shared helper: `src/shared/ghostty-assets.js` (+ tests).

## Verification

| Check | Result |
| --- | --- |
| `node --test` ghostty / after-pack / harness-extract | 29/29 PASS |
| `npm run qa:composer` | PASS (11/11) |
| `npm run qa:source` | PASS (terminal/agents/diff/browser green) |
| `npm run pack` (`dist/win-unpacked`) | PASS; afterPack 55s |
| tar contains wasm | both `packages/…/lib/assets/ghostty-vt.wasm` and `node_modules/@deepseek-ai/…/lib/assets/ghostty-vt.wasm` |
| Local repair of `runtime\0.2.6` assets | both package layouts have wasm |

## Not done in this pass

- NSIS Setup exe (`npm run dist`) — optional; `pack` already exercised afterPack + tar.
- Version bump / GitHub release of 0.2.7.
- Formal in-app appendix A multi-turn matrix re-walk (API chat was green earlier; Ghostty 404 is the critical that this fixes).

## Manual note

Existing 0.2.6 installs that already extracted an incomplete runtime: this code re-extracts on next launch **after** they install a build that includes the extract fix **and** a tar that contains assets. For the current machine, assets were copied into `runtime\0.2.6` in place for immediate unblocking.
