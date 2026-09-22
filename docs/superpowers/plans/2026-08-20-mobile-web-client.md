# 手机 Web 客户端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Do not commit** unless the user asks.

**Goal:** Ship an independent mobile Web SPA that pairs via `#offer=`, talks Host unary + WebSocket, and matches `docs/superpowers/mocks/2026-08-20-mobile-phone.html` for connect / chat / approval / settings. Android native is out of this plan.

**Architecture:** Static ESM under `mobile/web/` (no Expo, no official plugin tree). Duplicate the Host wire locally. After remote login, Electron `RemoteGateway` serves this folder for document GETs and still proxies `/api/*` plus WebSocket upgrades to `127.0.0.1:3080`. Re-enable LAN + HTTPS relay.

**Tech Stack:** Vanilla ESM, CSS custom properties copied from official `--dsw-alias-*`, Node `node:test` + `http`/`ws` test servers, existing `RemoteGateway`.

**Spec:** `docs/superpowers/specs/2026-08-20-mobile-web-client-design.md`

## Global Constraints

- No `import` / `require` of `src/main`, `src/renderer`, `src/preload`, or `@deepseek-ai/dsh-client-*` from `mobile/web/` production files.
- Token in URL hash only (`#offer=`). Cookie `dsh_remote`. Login `POST /__remote__/login`.
- Unary body `{ type: "client-request", rpcId, method, payload }`. `rpcId` via `crypto.getRandomValues`, not `randomUUID`.
- Handshake: `host.describe` → `session.list` + `workspace.list` → then WS `/api/events.mux` and `/api/events.host`. No SSE.
- Prompt: `session.prompt` `{ mode: "queue", content: [{ type: "text", text }] }`.
- Approval: `POST /api/respond` `{ type: "client-response", rpcId, result: { ok: true, value: { sessionId, approvalId, outcome } } }` with `allowed-once` | `rejected`.
- Chinese product copy. Official `--dsw-alias-*` only. No Pierre / lucide / Tailwind / marketplace hex. Boot instrument canvas stays off this SPA.
- Settings are memory-only for this connection. Hide desktop rows: 关闭窗口时, Harness 自动恢复, 打开配置文件. Gallery source CRUD stays in the gallery window.
- Relay origins must stay HTTPS after `normalizeRelayOrigin`. No hardcoded relay IP.
- Tests first. Do not commit unless asked.

## File map

**Create**

- `mobile/web/package.json` — `{ "type": "module" }` so Node treats tests as ESM
- `mobile/web/host/offer.js` + `offer.test.js`
- `mobile/web/host/rpc.js` + `rpc.test.js`
- `mobile/web/host/login.js` + `login.test.js`
- `mobile/web/host/handshake.js` + `handshake.test.js`
- `mobile/web/host/events.js` + `events.test.js`
- `mobile/web/conversation/fold.js` + `fold.test.js`
- `mobile/web/conversation/title.js` + `title.test.js`
- `mobile/web/fence.test.js`
- `mobile/web/tokens.css`, `app.css`, `index.html`, `app.js`
- `src/main/mobile-web.js` + `mobile-web.test.js` — resolve SPA root, safe static file, HTML vs API split

**Modify**

- `package.json` — test glob includes `mobile/web/**/*.test.js`; builder `files` includes `mobile/web/**/*` except `*.test.js`
- `src/main/config.js` — `REMOTE_FEATURE_ENABLED = true`
- `src/main/config.test.js` — expect enabled; keep HTTPS-only relay
- `src/main/ipc.test.js` — stub may stay false for isolated IPC tests; do not force production flag false
- `src/main/remote.js` — serve SPA for authenticated HTML; keep `/api` + upgrade proxy
- `src/main/remote.test.js` — invert “official UI” assertion
- `docs/design-language.md` — mobile Web token-copy exception
- `mobile/README.md` — Web-first pairing
- `mobile/App.js` — stop wrapping official UI; tell user to open the pairing URL in the browser

---

### Task 1: Offer parse + import fence

**Files:**
- Create: `mobile/web/package.json`, `mobile/web/host/offer.js`, `mobile/web/host/offer.test.js`, `mobile/web/fence.test.js`
- Modify: `package.json` (test script only)

**Produces:** `decodeOffer(raw)`, `offerFromHash(hash)` → `{ v, token, mode, relay } | null`

- [ ] **Step 1: Write failing tests**

`mobile/web/host/offer.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeOffer, offerFromHash } from './offer.js';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

test('decodeOffer reads v1 lan and relay payloads', () => {
  const lan = decodeOffer(b64url({ v: 1, token: 'secret-token', mode: 'lan' }));
  assert.equal(lan.token, 'secret-token');
  assert.equal(lan.mode, 'lan');
  const relay = decodeOffer(b64url({
    v: 1, token: 'secret-token', mode: 'relay', relay: 'https://relay.example',
  }));
  assert.equal(relay.mode, 'relay');
  assert.equal(relay.relay, 'https://relay.example');
});

test('offerFromHash reads #offer= and ignores query', () => {
  const raw = b64url({ v: 1, token: 'abc', mode: 'lan' });
  assert.equal(offerFromHash(`#offer=${raw}`).token, 'abc');
  assert.equal(offerFromHash(`?token=leaked#offer=${raw}`).token, 'abc');
  assert.equal(offerFromHash('#nope=1'), null);
  assert.equal(decodeOffer('%%%'), null);
});
```

`mobile/web/fence.test.js`: walk `mobile/web` production `.js`/`.html`/`.css` (skip `*.test.js`) and reject `from ['"]\\.\\./\\.\\./src/`, `require(['"]\\.\\./\\.\\./src/`, `@deepseek-ai/dsh-client-`.

- [ ] **Step 2: Run tests — expect fail** (module not found)

```
node --test mobile/web/host/offer.test.js mobile/web/fence.test.js
```

- [ ] **Step 3: Minimal implementation**

`offer.js` must work in browser and Node: prefer `atob` / `Buffer` for base64url. Validate `v === 1` and non-empty `token`. `mode` is `relay` or `lan`.

`mobile/web/package.json`: `{ "type": "module", "private": true }`

Update root `"test"` to:

`node --test "src/**/*.test.js" "mobile/web/**/*.test.js"`

- [ ] **Step 4: Re-run — expect pass**

- [ ] **Step 5: Do not commit**

---

### Task 2: Unary Host client

**Files:**
- Create: `mobile/web/host/rpc.js`, `mobile/web/host/rpc.test.js`

**Produces:** `mintRpcId()`, `callUnary({ fetchImpl, origin, method, payload, signal })` → `{ rpcId, ok, value, error }`

- [ ] **Step 1: Failing test** — fake `fetchImpl` captures URL, headers, body

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { callUnary, mintRpcId } from './rpc.js';

test('mintRpcId is uuid-shaped without randomUUID', () => {
  const id = mintRpcId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('callUnary posts client-request and returns echoed result', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      type: 'server-response',
      rpcId: body.rpcId,
      result: { ok: true, value: { version: '1' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const out = await callUnary({
    fetchImpl, origin: 'http://127.0.0.1:3180', method: 'host.describe', payload: {},
  });
  assert.equal(out.ok, true);
  assert.equal(out.value.version, '1');
  assert.equal(seen[0].url, 'http://127.0.0.1:3180/api/host.describe');
  const sent = JSON.parse(seen[0].init.body);
  assert.equal(sent.type, 'client-request');
  assert.equal(sent.method, 'host.describe');
  assert.equal(seen[0].init.credentials, 'include');
  assert.equal(seen[0].init.headers['content-type'], 'application/json');
});

test('callUnary throws on HTTP failure and surfaces result.ok false', async () => {
  await assert.rejects(() => callUnary({
    fetchImpl: async () => new Response('nope', { status: 502 }),
    origin: 'http://x', method: 'session.list', payload: {},
  }));
  const out = await callUnary({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: body.rpcId,
        result: { ok: false, error: { code: 'bad-request', message: 'nope', details: { issues: [] } } },
      }));
    },
    origin: 'http://x', method: 'session.list', payload: {},
  });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'bad-request');
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `rpc.js`** — `POST ${origin}/api/${method}`, `credentials: 'include'`. Mismatch `rpcId` is an error. Also export `respond({ fetchImpl, origin, rpcId, value, signal })` posting `{ type: 'client-response', rpcId, result: { ok: true, value } }` to `/api/respond`.

Add a test that `respond` hits `/api/respond` with `allowed-once`.

- [ ] **Step 4: Re-run — expect pass**

---

### Task 3: Offer login

**Files:**
- Create: `mobile/web/host/login.js`, `mobile/web/host/login.test.js`

**Produces:** `loginWithOffer({ fetchImpl, origin, offer })` POSTs `application/x-www-form-urlencoded` `token=` to `/__remote__/login` with `redirect: 'manual'` (or follow, but assert 302/200). Failure → throw with Chinese-safe message for the connect screen.

Use `offerFromHash` from Task 1.

---

### Task 4: Handshake order

**Files:**
- Create: `mobile/web/host/handshake.js`, `mobile/web/host/handshake.test.js`

**Produces:** `async function handshake({ call, connectEvents })`

Order recorded by a fake `call`: `host.describe`, `session.list`, `workspace.list` (list+workspaces may be parallel; both **before** `connectEvents()`). `connectEvents` must not run if describe fails.

Return `{ host, sessions, workspaces }`.

---

### Task 5: Mux/host WebSocket

**Files:**
- Create: `mobile/web/host/events.js`, `mobile/web/host/events.test.js`

**Produces:** `openEventSockets({ origin, WebSocketImpl, onMux, onHost, signal })`

- Converts `http:` → `ws:`, `https:` → `wss:`
- Opens `/api/events.mux` and `/api/events.host`
- Parses text frames as `server-request`; ignore malformed
- Abort closes both sockets

Test with a tiny `ws` WebSocket server or a fake class that records URLs and emits `message` events.

Do **not** use EventSource.

---

### Task 6: Fold + session title

**Files:**
- Create: `mobile/web/conversation/fold.js`, `fold.test.js`, `title.js`, `title.test.js`

**Produces:**

- `foldEvents(entries)` → `[{ id, role: 'user'|'assistant'|'tool', text, card? }]`
- Map `user/message` (source kind user), `assistant/chunk` (concat), `assistant/message` (finalize), `tool/call` (card from `view.card` if present)
- `sessionTitle(row)` → `新会话` when `blank`; else projection title / `session/title` / short id

---

### Task 7: Re-enable remote feature flag

**Files:**
- Modify: `src/main/config.js`, `src/main/config.test.js`

Change `REMOTE_FEATURE_ENABLED` to `true`. Update the test currently asserting `false` and “remote stays disabled”. Keep: HTTP relay origins still normalize to `''`; enabling relay still requires HTTPS origin.

Run `node --test src/main/config.test.js`.

---

### Task 8: Gateway serves the SPA

**Files:**
- Create: `src/main/mobile-web.js`, `src/main/mobile-web.test.js`
- Modify: `src/main/remote.js`, `src/main/remote.test.js`, `package.json` builder `files`

**Produces:** `resolveMobileWebRoot()`, `safeJoin(root, urlPath)`, `shouldProxyToHost(url)` (`/api`, `/__remote__/`, websocket already handled)

Authenticated `GET` with HTML accept for `/` or SPA assets under the web root → read file (fallback `index.html` for `/`). Never proxy official HTML. `POST /api/session.list` still hits upstream.

Invert test `paired HTML and assets come from the official UI`:

- Place a temp SPA (`index.html` contains `手机远程`, `app.js` contains `mobile-spa`) via `mobileWebRoot` option on `RemoteGateway`
- Authed `GET /` matches `手机远程`, does **not** match `Into the Unknown`
- Authed `GET /app.js` is the SPA file
- Authed `POST /api/session.list` still returns upstream body
- Unauthed HTML still login page mentioning `#offer=`

Packaging: add `mobile/web/**/*` to `build.files`, exclude `**/*.test.js`. Resolver: unpackaged `path.join(__dirname, '../../mobile/web')`.

---

### Task 9: SPA chrome from the mock

**Files:**
- Create: `mobile/web/index.html`, `tokens.css`, `app.css`, `app.js` (screens can live in `app.js` for v1)

Copy tokens from `src/shared/dsh-webui-tokens.css` **by value** into `tokens.css` (do not import that file from the SPA if the fence forbids `../../src`; pasting values is the exception). Layout from the mock: connect, chat+drawer, approval takeover, settings overlay with horizontal nav. Chinese copy from the mock. No 56px rail. Empty state = 新会话.

`app.js` may use placeholder data until Task 10.

Add a tiny DOM test only if cheap; otherwise visual check against the mock is the gate for this task. Prefer extracting render helpers that unit-test: `visibleScreen(state)`, `settingsTabs()`, `desktopRowsHidden()` returning the forbidden row titles.

---

### Task 10: Wire SPA to Host

**Files:**
- Modify: `mobile/web/app.js`

On load: `offerFromHash(location.hash)` → `loginWithOffer` if present → `handshake` → `openEventSockets`. Connect screen: paste URL, parse hash, same path. Session drawer from `session.list`. Open session → `session.history` + fold. Send → `session.prompt`. Mux `approval/requested` → composer takeover → `respond` `allowed-once` / `rejected`. Settings overlay: `settings.describe` if available; persist in memory; never show 关闭窗口时 / Harness 自动恢复 / 打开配置文件.

If a settings namespace is missing, show the tab with an empty/in-progress hint — no fake toggles that claim to write Host.

---

### Task 11: Docs + Expo stub

**Files:**
- Modify: `docs/design-language.md`, `mobile/README.md`, `mobile/App.js`

Design language: add 手机 Web 例外 — token copy, not plugin tree, not boot canvas.

README: browser scans QR; after login 3180 serves this SPA; `/api` still Host; Android app is not the v1 client.

`App.js`: remove WebView of official UI. Short Chinese: 请用系统浏览器打开桌面二维码链接.

---

### Task 12: Verification

Run:

```
node --test "src/**/*.test.js" "mobile/web/**/*.test.js"
```

Confirm:

- fence test green
- remote test: authed `/` is SPA
- config: `REMOTE_FEATURE_ENABLED === true`, HTTP relay origin stripped
- Manual: `Start-Process` the mock still matches shipped CSS/layout closely enough to ship Web v1

**Do not commit** unless asked. Android scan / native screens are a later plan.

## Spec coverage

| Spec item | Task |
|---|---|
| Import fence, no official plugins | 1, 11 |
| `#offer=` login | 3, 10 |
| Unary + uuid | 2 |
| Handshake then WS | 4, 5 |
| Fold / titles | 6 |
| Re-enable LAN+relay | 7 |
| 3180 serves SPA, `/api` proxied | 8 |
| Screens from mock | 9, 10 |
| Memory-only settings, hidden desktop rows | 10 |
| Design-language exception + README | 11 |
