# Android 远程客户端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Do not commit** unless the user asks.

**Goal:** Ship a Kotlin Compose Android client that pairs via the same `#offer=` QR, talks Host unary + WebSocket with a JSON device token, and matches `docs/superpowers/mocks/2026-08-23-android-phone.html` for connect / chat / approval / settings / workspace Git.

**Architecture:** Electron `RemoteGateway` grows JSON login, strips auth headers on the loopback proxy, and exposes a whitelist `POST /__remote__/shell/<name>` onto existing git / `listDir` / settings IPC. `mobile/android/` is a separate Gradle app that reimplements the Host wire (do not import desktop or `@deepseek-ai/dsh-client-*`). Browser SPA stays cookie-based and is not restyled.

**Tech Stack:** Node `http` gateway, Compose BOM + CameraX + OkHttp + EncryptedSharedPreferences, JUnit + MockWebServer, existing `git.js` / `workspace-fs.js`.

**Spec:** `docs/superpowers/specs/2026-08-23-mobile-android-client-design.md`

## Global Constraints

- Token only in `#offer=`. Never log the pairing or device token.
- JSON login when `Accept` or `Content-Type` is `application/json`. Form + 302 stays for the browser.
- `rewriteProxyHeaders` must drop `cookie` and `authorization` on HTTP and WS upgrade.
- Handshake: `host.describe` → `session.list` + `workspace.list` → then WS `/api/events.mux` and `/api/events.host`. No SSE.
- Unary body `{ type: "client-request", rpcId, method, payload }`. Approval via `POST /api/respond` with `allowed-once` | `rejected`.
- Prompt images: `{ type: "image", mediaType, data }` with png/jpeg/webp/gif only.
- Shell whitelist only: gitStatus, gitFetchForStatus, gitDiff, gitCommit, gitPush, gitPull, gitBranchList, gitSwitchBranch, gitCreateBranch, gitCreateChangeRequest, listDir, openSettings, openGallery, getConfig, saveConfig. No PTY, writeFile, readFile, preview.
- Compose copies `--dsw-alias-*` into `DshTokens`. No Material3 default purple / dynamic color. Git action labels stay English. Chinese product copy.
- Do not `npm start` or pack in this worktree (ports 3080/3180 and `%APPDATA%\Deepseek-Harness-Desktop` belong to another QA path).
- Tests first. Do not commit unless asked.

## File map

**Create**

- `src/main/remote-shell.js` + `src/main/remote-shell.test.js`
- `mobile/android/` Gradle app (`applicationId` `ai.deepseek.harness.mobile`)
- Kotlin: `DshTokens`, Offer, Login, Rpc, Handshake, Events, Fold, Title, RemoteShell, GitQuick, Compose screens
- JVM unit tests under `mobile/android/app/src/test/`

**Modify**

- `src/main/remote.js` — JSON login; strip headers; dispatch `/__remote__/shell/`
- `src/main/remote.test.js` — JSON / strip / whitelist
- `src/main/index.js` — inject `invokeShell`
- `mobile/App.js` — freeze Expo stub copy
- `docs/features/mobile-remote.md`, handbook, `mobile/README.md`, `docs/design-language.md`

---

### Task 1: Strip proxy auth headers

**Files:**
- Modify: `src/main/remote.js` (`rewriteProxyHeaders`)
- Test: `src/main/remote.test.js`

**Produces:** `rewriteProxyHeaders` output has no `cookie` or `authorization` keys (any casing).

- [ ] **Step 1: Write the failing test**

Append to `src/main/remote.test.js`:

```js
test('rewriteProxyHeaders strips cookie and authorization so device tokens stay off loopback', () => {
  const headers = rewriteProxyHeaders({
    host: '192.168.1.8:3180',
    cookie: 'dsh_remote=device-secret',
    authorization: 'Bearer device-secret',
    Authorization: 'Bearer device-secret',
  }, { port: 3080 });
  assert.equal(headers.host, '127.0.0.1:3080');
  assert.equal(headers.cookie, undefined);
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.Authorization, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/main/remote.test.js`
Expected: FAIL — `headers.cookie` still present.

- [ ] **Step 3: Write minimal implementation**

In `rewriteProxyHeaders`, skip names `cookie` and `authorization` (already lowercased).

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test src/main/remote.test.js`
Expected: PASS

---

### Task 2: JSON login

**Files:**
- Modify: `src/main/remote.js` (`handleHttp` login branch)
- Test: `src/main/remote.test.js`

**Produces:** `POST /__remote__/login` with JSON body returns `{ ok, deviceToken }` or `{ ok: false, error: "配对密钥无效" }`.

- [ ] **Step 1: Write the failing test**

```js
test('JSON login mints a device token without an HTML body', async () => {
  const upstream = http.createServer((_req, res) => res.end('ok'));
  const upstreamPort = await listen(upstream);
  const token = generateToken();
  const config = memoryConfig({ remoteToken: token, remoteDevices: [] });
  const gateway = new RemoteGateway(config);
  await gateway.start({ port: 0, token, target: { port: upstreamPort } });
  const port = gateway.port || gateway.server.address().port;
  const login = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'DshAndroid/1',
    },
    body: JSON.stringify({ token }),
  });
  assert.equal(login.status, 200);
  const json = JSON.parse(login.body);
  assert.equal(json.ok, true);
  assert.ok(json.deviceToken);
  assert.notEqual(json.deviceToken, token);
  assert.match(String(login.headers.get('set-cookie') || ''), /dsh_remote=/);

  const denied = await request(port, '/__remote__/login', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'nope' }),
  });
  assert.equal(denied.status, 401);
  assert.equal(JSON.parse(denied.body).error, '配对密钥无效');
  assert.doesNotMatch(denied.body, /<!DOCTYPE html>/i);

  await gateway.stop();
  await close(upstream);
});
```

Keep the existing form+302 test unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/main/remote.test.js`
Expected: FAIL — JSON POST still 401 HTML or 302.

- [ ] **Step 3: Write minimal implementation**

Detect JSON via `content-type` or `accept` containing `application/json`. Parse `{ token }`. On mismatch send `401` JSON. On match `pairDevice` and `200` JSON plus `set-cookie`.

- [ ] **Step 4: Run the tests and make sure they pass**

Expected: PASS including the existing form login test.

---

### Task 3: Shell whitelist

**Files:**
- Create: `src/main/remote-shell.js`, `src/main/remote-shell.test.js`
- Modify: `src/main/remote.js`, `src/main/index.js`
- Test: `src/main/remote.test.js`

**Produces:** `isRemoteShellName(name)`, `invokeDesktopShell({ name, payload, git, fs, host })`, gateway route `POST /__remote__/shell/:name`.

- [ ] **Step 1: Write failing tests**

`src/main/remote-shell.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isRemoteShellName, invokeDesktopShell, REMOTE_SHELL_NAMES } = require('./remote-shell');

test('whitelist includes git and listDir and rejects writeFile', () => {
  assert.equal(isRemoteShellName('gitStatus'), true);
  assert.equal(isRemoteShellName('listDir'), true);
  assert.equal(isRemoteShellName('writeFile'), false);
  assert.equal(isRemoteShellName('ptyCreate'), false);
  assert.ok(REMOTE_SHELL_NAMES.includes('gitCommit'));
});

test('invokeDesktopShell maps gitStatus cwd', async () => {
  const seen = [];
  const result = await invokeDesktopShell({
    name: 'gitStatus',
    payload: { cwd: '/ws' },
    git: { gitStatus: async (cwd) => { seen.push(cwd); return { isRepo: true, refName: 'main' }; } },
  });
  assert.deepEqual(seen, ['/ws']);
  assert.equal(result.ok, true);
  assert.equal(result.result.refName, 'main');
});
```

Gateway tests: unauthenticated POST → 401; `writeFile` → 404; `gitStatus` with injected `invokeShell` → 200 JSON.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/main/remote-shell.test.js src/main/remote.test.js`

- [ ] **Step 3: Implement mapping and HTTP dispatch**

`REMOTE_SHELL_NAMES` exactly as the spec table. `handleHttp`: after auth, if `POST` and path `/__remote__/shell/<name>`, parse JSON (limit 1 MiB for commit/diff), call `this.invokeShell(name, payload)`, JSON respond. Wire `index.js`:

```js
const { invokeDesktopShell } = require('./remote-shell');
const git = require('./git');
const { listDir } = require('./workspace-fs');
const { openHarnessSettings } = require('./window');
const { loadConfig, saveConfig, publicConfig, normalizeRendererConfigPatch } = require('./config');

const remote = new RemoteGateway({
  getConfig: loadConfig,
  saveConfig,
  getTarget: () => { /* existing */ },
  invokeShell: (name, payload) => invokeDesktopShell({
    name,
    payload,
    git,
    fs: { listDir },
    host: {
      openSettings: (sectionId) => openHarnessSettings(sectionId),
      getConfig: () => publicConfig(loadConfig()),
      saveConfig: (patch) => publicConfig(saveConfig(normalizeRendererConfigPatch(patch || {}))),
    },
  }),
});
```

`openGallery` calls `openHarnessSettings('appearance')` and returns `{ opened: 'appearance' }`.

- [ ] **Step 4: Run the tests and make sure they pass**

Expected: PASS

---

### Task 4: Android Gradle shell + tokens + offer

**Files:**
- Create: `mobile/android/` Gradle project, `DshTokens.kt`, `Offer.kt`, `OfferTest.kt`, `MainActivity.kt` connect/permission/scan scaffolds
- Modify: `mobile/App.js` freeze copy

**Produces:** `decodeOffer` / `offerFromPaste` matching `mobile/web/host/offer.js`. Theme colors from `mobile/web/tokens.css`.

- [ ] **Step 1: Write failing JVM tests** (`app/src/test/java/ai/deepseek/harness/mobile/pair/OfferTest.kt`)

Round-trip `v=1` lan/relay; reject junk; parse full URL hash; ignore `?token=`.

- [ ] **Step 2: Run `./gradlew test` and confirm OfferTest fails (class missing)**

- [ ] **Step 3: Implement Offer.kt + Compose connect/scan screens using DshTokens (no Material dynamic color). CameraX barcode for `#offer=`. Permission-denied copy matches the mock. Device token store interface.**

- [ ] **Step 4: `./gradlew test` PASS for Offer**

---

### Task 5: Host client + conversation fold

**Files:**
- Create: `Rpc.kt`, `Handshake.kt`, `Events.kt`, `Fold.kt`, `Title.kt` + tests
- Create: Chat / drawer / approval Compose

**Produces:** Same envelopes as `mobile/web/host/rpc.js`. Handshake order identical to `handshake.test.js`. Fold includes image blocks on user bubbles.

- [ ] **Step 1: JVM tests with MockWebServer** — offer login JSON, unary `client-request` + echoed `rpcId`, handshake order, 401 returns to connect, respond `allowed-once`.

- [ ] **Step 2: Confirm tests fail**

- [ ] **Step 3: Implement OkHttp unary + WS (Authorization Bearer). Composer takeover for approval. No SSE.**

- [ ] **Step 4: `./gradlew test` PASS**

---

### Task 6: Images, settings hub, Git capsule

**Files:**
- Create: `RemoteShell.kt`, `GitQuick.kt`, settings hub Compose, workspace Git chrome, image rail
- Test: `GitQuickTest.kt`, `RemoteShellCodecTest.kt`

**Produces:** `gitQuick(status)` English labels matching the mock (`Commit`, `Commit & push`, `Pull`, …). Shell POST `/__remote__/shell/<name>`. Phone appearance in DataStore. Computer rows call `openSettings` / `openGallery` / `saveConfig`. Workspace 32px split capsule.

- [ ] **Step 1: Write GitQuick and shell codec tests**

- [ ] **Step 2: Confirm fail**

- [ ] **Step 3: Implement camera/gallery pickers (JPEG/PNG/WebP/GIF → base64 prompt). Settings groups from the mock. Git chrome against real shell JSON.**

- [ ] **Step 4: `./gradlew test` PASS**

---

### Task 7: Spine docs

**Files:**
- Modify: `docs/features/mobile-remote.md`, `docs/handbook/modules/mobile-remote.md`, `docs/handbook/flows/remote-pair.md`, `docs/handbook/blueprint.md`, `docs/handbook/appendix/main-modules.md`, `mobile/README.md`, `docs/design-language.md`, `docs/features/README.md` last-verified via the card

Remove invariant 「Android 应用内扫码不在本卡」. Allowed touch adds `mobile/android/` and gateway shell whitelist. Android token-copy exception beside the Web SPA exception.

---

## Spec coverage

| Spec section | Task |
|---|---|
| JSON login / cookie coexistence | 2 |
| Strip cookie/authorization | 1 |
| Shell whitelist | 3 |
| Compose tokens, scan, Keystore | 4 |
| Host unary/WS/approval/fold | 5 |
| Images / settings split / Git capsule | 6 |
| Feature card / handbook / design-language | 7 |
| Expo frozen, no iOS, no fake gallery, no PTY | 3 + 4 + 6 |
