# Decision: Remote pairing main process imports a narrow server slice, not the full barrel

Status: implemented

[中文](2026-09-18-dshd-remote-narrow-server-api.md) | English

## Problem

Enabling remote in the installed build (or the popup self-heal, poll-driven offer minting, token rotation, or startup recovery — all converge) reaches `DshdRemote.ensureApi()` → `loadServerApi()`, which `import()`ed the entire `exports.js` barrel into the Electron **main** process — the vendored full daemon graph (express, MCP SDK, every provider, the speech chain). ESM loading is synchronous file I/O + compile + top-level evaluation on the calling thread: the import produced ~30k module-load events and ~1.3s on a warm dev machine; on an installed build every first read under `resources/vendor/dshd-remote/node_modules` (107MB / 4098 JS files) goes through antivirus real-time scanning, stretching the synchronous main-thread block into tens of seconds — Windows marks the window "not responding" (same WER AppHangTransient family as the harness-extract `fs.rmSync` precedent). The main process only needed three symbols — `generateLocalPairingOffer`, `RelayDeviceCredentialStore`, `DSH_VENDOR_PACKAGES` (a 12-name constant) — so loading the whole graph for them was overreach.

## Decision

`loadServerApi()` now `import()`s only two narrow siblings of `exports.js`: `pairing-offer.js` and `relay-device-credential-store.js` (~600 module-load events, <100ms warm combined), returning `{ generateLocalPairingOffer, RelayDeviceCredentialStore, DSH_VENDOR_PACKAGES }`. `DSH_VENDOR_PACKAGES` is mirrored as a constant in the main process (upstream defines it inside `dsh-agent.ts`, which itself drags in the provider subgraph); a new parity test in `dshd-remote.test.js` pins the mirror to the vendored source so vendor-sync changes to the list turn red immediately. `SERVER_EXPORT` remains the runtime completeness canary and the daemon child's launch-file entry — the child still `import()`s the full barrel to run `createChisaCodeDaemon`; the isolation architecture is unchanged.

## Alternatives considered

- **Keep the barrel import, rely on caching after first load** — rejected: `serverApi` was already cached; the first load alone is enough to freeze the first installed-build "enable" click for tens of seconds, and caching does not remove the cold-path cost.
- **Move offer minting and vendor completeness checks entirely into the daemon child, zero vendored imports on main** — rejected: it needs a mint request/response route plus error propagation in the runner protocol, and `rotateToken`'s current contract can mint a file-backed offer while the daemon is down — moving it into the child would change that user-facing contract; the feature card already defines the main process as "process management + file-backed pairing/snapshot", which the narrow import satisfies without relocating the boundary.
- **Runtime regex-extract `DSH_VENDOR_PACKAGES` from `dsh-agent.js`** — rejected: dist is a build artifact; any change in tsdown output shape silently degrades extraction (vendor falls back and the dsh provider quietly becomes unavailable). A mirrored constant plus a parity test surfaces drift in `node --test` instead of at runtime.
- **Run the barrel import inside `worker_threads` and post the result back** — rejected: ESM namespaces cannot be structured-cloned across threads, so the function surface would need an RPC wrapper; that costs the same boundary work as moving it into the child with none of the payoff.

## Consequences

Cost: the `DSH_VENDOR_PACKAGES` mirror stays in sync with the vendored source only through the parity test (skipping tests is the only drift path — gates cover it); the narrow api surface means any future barrel member needed on main must be added deliberately as a narrow entry or the boundary re-evaluated. Gain: the enable path's synchronous main-thread load drops from ~1.3s (warm) / tens of seconds (cold install + AV scan) to the <100ms range; `shell:get-remote` poll minting, popup self-heal saves, rotateToken, and startup `sync()` recovery all benefit; `dshd-remote.test.js` reports 36 pass (narrow-surface assertions + child barrel contract + parity), `dshd-daemon-runner`/`remote-epipe`/`stdio-guard`/`lan`/`ipc` suites report 80 pass unchanged, and the real vendored daemon child end-to-end case passes.
