# Decision: mobile-web-server defense-in-depth security headers

Status: implemented

[中文](2026-09-19-mobile-web-server-security-headers.md) | English

## Problem

A full-codebase security review flagged the LAN pairing page server (`src/main/mobile-web-server.js`, `:3180`) as a high-risk exposure of "cleartext HTTP + no auth + no CSP". On deeper verification this was **downgraded**: the server is a pure static SPA host in LAN mode — it **does not proxy `/api`, sets no cookies, and runs no mux**; chat/session/git all traverse the ChisaCode E2EE tunnel (DaemonClient), and the pairing secret travels in the `#offer=` fragment (never sent over the network). It only listens when `remoteEnabled` and not in Away mode. The real exposure is far smaller than first assessed.

## Decision

Add **universally-safe** response headers to static responses (pure gain, behaviour-compatible, no protocol change):

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY` (refuse to be framed)

A new `src/main/mobile-web-server.test.js` pins these headers and explicitly asserts that **no CSP is set**.

**No `Content-Security-Policy`**: adversarial review found the SPA proactively opens a WebSocket to a *different-origin* relay host (the ChisaCode daemon relay, e.g. `ws://<relay-ip>:8411`). The LAN pairing page is a non-secure context at `http://<lan-ip>:3180`, where `connect-src 'self'` matches only `:3180` itself, and `ws:` scheme-source support is inconsistent across browsers — a CSP could block the relay WebSocket and break phone pairing outright. Without the ability to regression-test the CSP matrix on real devices, adding CSP trades a functional regression for defense, so it was dropped.

## Alternatives considered

- **Add a CSP** — rejected: it would block the WebSocket to the different-origin relay and break pairing on the non-secure LAN context (see Decision). Any future CSP must first validate the relay-WS matrix on real devices.
- **Add TLS / auth** — rejected: the payload is only public static assets; the pairing secret rides the fragment and the E2EE tunnel; forcing TLS would touch the `_kill-http-remote` negative contract and require the full real-machine matrix — cost outweighs benefit.
- **Remove `:3180`** — rejected: it is the live LAN pairing landing page (built by `dshd-remote.js` in non-Away mode), not kill-list residue.
- **Escalate to P0 per the initial review** — rejected: the initial review overstated the risk (it assumed cookies/`/api` traversed `:3180` in cleartext); the server actually has no sensitive surface.

## Consequences

The LAN pairing page gains cheap defense-in-depth without touching the kill list or the protocol. The initial "P0 sole unhardened entry" conclusion is corrected to "P2 low-cost hardening". The remaining cleartext HTTP only carries non-sensitive static assets — an acceptable known trade-off.
