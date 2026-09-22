# Plan: dshbot official Bots UI fallback (2026-08-29)

Touching: `dshbot`

## Problem

Official `@deepseek-ai/dsh` (≤0.1.1-rc.2) installs and mounts dshbot (bundle,
preset, `client.js`) but the Bots UI never appears. Root cause: the client
injects `sidebar.nav.tab` / `sidebar.page`, which exist only on the desktop
fork’s vendored `ui-sidebar`. Upstream npm packages declare
`sidebar.footer.action` (and related foot/settings seats) but not region tabs.
`slots.inject` waits on undeclared names → silent no-op (QA 2026-08-28).

## Options

| | Approach | Pros | Cons |
| --- | --- | --- | --- |
| A | Upstream `sidebar.nav.tab` / `sidebar.page` to `deepseek-ai/deepseek-harness` | Restores true region-tab UX on official | Needs upstream write/review; not controllable in this repo |
| B | Client detects missing tab/page specs; falls back to `sidebar.footer.action` + panel hosting `BotPage` | Controllable here; desktop path unchanged when tabs exist | Foot entry ≠ region tab; panel UX is a compromise |

**Selected:** B as the mergeable fix. A remains a parallel follow-up (patch notes
only; no upstream PR unless credentials allow).

## Scope

- `vendor/dshbot/client/client.js` — detect + dual registration
- `vendor/dshbot/lib/sidebar-host.js` — pure host probe (tests lock it)
- `vendor/dshbot/package.json` — `engines.node: >=22.15.0`
- Feature card / handbook / README / QA results
- Unit test `src/main/dshbot-official-ui-fallback.test.js`

Out of scope: independent-repo push (owner PAT), npm publish (`NPM_TOKEN`),
live group turns (no API key), Windows TC-EXT-007.

## Acceptance

1. Desktop / vendored host with tab+page specs: still registers tab+page; no
   duplicate footer Bots entry.
2. Official `@deepseek-ai/dsh` clean profile + `#path:/vendor/dshbot`: footer
   shows a visible Bots control; opening it shows the bot list UI; screenshot
   archived under `docs/qa/results/2026-08-29/`.
3. Gate suite including new fallback tests green; no uncaught inject into
   undeclared tab/page slots on official.

## Risks / rollback

- Foot entry competes visually with Settings / Remote — use order `10`, token
  styles, `data-dshbot-official-trigger` for probes.
- Rollback: revert client branch + delete fallback CSS; desktop tabs unaffected.

## Upstream handoff (parallel, non-blocking)

Vendored fork note already documents the slots
(`2026-08-19-sidebar-tabs-dshbot-origin`). Contribute that surface upstream when
a PR path exists; until then official consumers rely on this fallback.
