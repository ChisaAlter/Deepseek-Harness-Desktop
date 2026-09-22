# 手机远程 Web 全功能缺陷完全修复计划（生产交付级）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 2026-09-01 T2 rehearsal（`docs/qa/results/2026-09-01/full-web-v2/REPORT.md`）暴露的全部缺陷修到 0 Fail、0 未豁免 Blocked，并在真机 T2 与公网 T1 上按 [mobile-remote-full-web-cases.md](../../qa/mobile-remote-full-web-cases.md) 签字。

**Architecture:** 缺陷全部在手机 SPA（`mobile/web`）与 daemon mux 转发链，不改 pairing wire、不改桌面 dsh web。每个缺陷 = 一个 TDD 任务（失败单测 → 最小修复 → 单测绿 → 提交），随后把 v2 驱动脚本固化为可重复的 rehearsal 套件，再进入造障批准场 → 人工一次点击清单 → 真机 T2 → 公网 T1 → 签字。

**Tech Stack:** Node 24 `node --test`、`mobile/web` 原生 ESM SPA、`puppeteer-core`（Edge）+ 源码 Electron CDP 9229 双端对照、vendored ChisaCode daemon（`src/main/dshd-daemon-hooks.mjs`）。

**Spec:** [docs/features/mobile-remote.md](../../features/mobile-remote.md)（MUST 矩阵 / NEVER / Invariants）+ [docs/qa/mobile-remote-full-web-cases.md](../../qa/mobile-remote-full-web-cases.md)（关门清单）+ [docs/qa/mobile-remote-live-acceptance.md](../../qa/mobile-remote-live-acceptance.md)（公约）。

## Global Constraints

- Touching: `mobile-remote`。允许改：`mobile/web/**`、`src/shared/dshd-mux-sse.js`、`src/main/dshd-daemon-hooks.mjs`、`tools/remote-web-qa/**`、本卡与 QA 文档。**不改** `vendor/chisacode-remote` 线协议、不改官方 `dsh web`。
- **禁止提交** `src/main/config.js` 的 `REMOTE_FEATURE_ENABLED = true`（本机 LAN 解禁仅工作树）。每次 commit 前 `git diff --stat src/main/config.js` 必须为空。
- 禁止提交密钥、完整 `#offer=`、`%APPDATA%` 路径下任何文件。
- 每次改 `mobile/web/app.js` 或其 import 必须换 `mobile/web/index.html` 的 `app.js?v=` cache-bust（格式 `YYYYMMDD-<slug>`），并在 live 脚本里断言新值。
- 「请在电脑端」文案只允许出现在卡片 DEFER / NEVER 段列出的表面。
- 提交说明 `feature(mobile-remote): <what>`；每个任务一个提交；不 amend、不 force push。
- 桌面对照一律用 `docs/qa/results/2026-09-01/full-web-v2/lib.mjs` 的规范化 oracle（sessionId 集合、aria `会话“X”的操作` / `工作区“X”的操作`、git sheet 主按钮 label），**不**裸比 chip 文案。
- 任一任务的单测不绿或 rehearsal 该模块不绿 → 不进下一任务。

---

## 缺陷登记（本计划的输入）

| ID | 表现 | 根因（已定位 / 待验证） | 修复任务 |
| --- | --- | --- | --- |
| DEF-SYNC-REVERSE | 桌面新建会话 / 改名 60–90s 不到 SPA；重连才见 | `mobile/web/app.js` `handleMuxFrame`：`session/projection` 只在 `payload.sessionId === state.sessionId` 时应用；`host/session-added` 加进来的行 `blank:true` 且无 `workspaceId`，永不翻 `blank=false`；`host/workspace-changed` / `host/workspace-order-changed` / `host/archived-sessions-changed` 完全未处理 | Task 1 |
| DEF-DRAFT-SWITCH | 草稿切走再切回为空；localStorage 里有值 | 文本草稿只靠 textarea `input` 事件持久化；`openSession` 切换前不显式保存；可能存到错误 sessionId。需确定性复现 | Task 2 |
| DEF-ATTACH-TEXTMODEL | 文本模型附图发送：无拦截、无回复、无错误 | SPA 没有发送前 `supportsImages` 守卫（桌面有）；`session/event` 错误事件未渲染成可见错误 | Task 3 |
| DEF-MOVE-NOOP（候选） | 两行组上移 20s 顺序不变 | `insertSessionMove` payload 语义或 `workspace.list` 回退基线陈旧；需对照 vendor `workspace-controller` | Task 4 |
| DEF-ACCESS-LABEL | SPA「完全访问」 vs 桌面「完全权限」 | `mobile/web/host/permission.js` 标签表与桌面 locale 不同源 | Task 5 |
| DEF-SRCH-LIVE | live 帧到达时搜索视图被整表重画（89/93 行） | `renderSessions` 在 mux 刷新路径下 `state.query` / `searchHits` 被绕过 | Task 6 |
| 驱动可靠性 | 多条 Fail 是 oracle 错（`.session-more` 命中 `+`、盯 bare `master`、`offsetParent` 过滤 fixed、标题竞态） | 固化 v2 驱动 | Task 7 |
| Blocked（造障 / 人工 / 轨外） | 见 REPORT.md | 非代码 | Task 9–13 |

---

## Phase 0 · 准备

### Task 0: 分支、基线、守卫脚本

**Files:**
- Create: `scripts/check-remote-flag-not-committed.mjs`
- Modify: `package.json`（scripts）

**Interfaces:**
- Produces: `npm run check:remote-flag` — 工作树 `src/main/config.js` 若被 staged 且含 `REMOTE_FEATURE_ENABLED = true` 则 exit 1。

- [ ] **Step 1: 建分支并确认基线绿**

```bash
git checkout -b feature/mobile-remote-defect-remediation
npm test
```
Expected: `pass` 全部、`fail 0`（含 `mobile/web/**/*.test.js` 224 条）。

- [ ] **Step 2: 写守卫脚本**

```js
// scripts/check-remote-flag-not-committed.mjs
import { execFileSync } from 'node:child_process';
const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' });
if (staged.split(/\r?\n/).includes('src/main/config.js')) {
  const diff = execFileSync('git', ['diff', '--cached', '--', 'src/main/config.js'], { encoding: 'utf8' });
  if (/\+const REMOTE_FEATURE_ENABLED = true/.test(diff)) {
    console.error('REMOTE_FEATURE_ENABLED=true must not be committed (local unpark only).');
    process.exit(1);
  }
}
console.log('remote flag guard ok');
```

- [ ] **Step 3: 接到 package.json**

```json
"check:remote-flag": "node scripts/check-remote-flag-not-committed.mjs"
```

- [ ] **Step 4: 验证守卫会拦**

```bash
git add src/main/config.js && npm run check:remote-flag ; git reset src/main/config.js
```
Expected: 第一条 exit 1 并打印 must not be committed；reset 后工作树仍是 `true`。

- [ ] **Step 5: Commit**

```bash
git add scripts/check-remote-flag-not-committed.mjs package.json
git commit -m "feature(mobile-remote): guard against committing local remote unpark"
```

---

## Phase 1 · 缺陷修复（TDD）

### Task 1: DEF-SYNC-REVERSE — 桌面侧变更活推到 SPA

**Files:**
- Create: `mobile/web/host/catalog-refresh.js`、`mobile/web/host/catalog-refresh.test.js`
- Modify: `mobile/web/host/frames.js`、`mobile/web/host/frames.test.js`
- Modify: `mobile/web/app.js:1150-1209`（`handleMuxFrame`）
- Modify: `src/shared/dshd-mux-sse.test.js`
- Modify: `mobile/web/index.html`（cache-bust）

**Interfaces:**
- Produces: `applyHostFrame(sessions, payload)` 新增处理 `session/projection`（key `title` → 任意会话行的 `projections.values.title` + `blank=false`）与 `session/event`（event.type `turn/start` → 该行 `blank=false`, `running=true`）。
- Produces: `catalogRefreshReason(payload) => 'workspace' | 'archived' | 'session' | null` 与 `createCatalogRefreshScheduler(refresh, { delayMs = 400 })` 返回 `schedule(reason)`；多帧合并一次 `refresh()`。

- [ ] **Step 1: 失败测试 — projection 标题落到非当前会话**

```js
// mobile/web/host/frames.test.js（追加）
test('session/projection title updates any session row and unblanks it', () => {
  const rows = [{ sessionId: 'b', blank: true, projections: { values: {} } }];
  const next = applyHostFrame(rows, {
    type: 'session/projection', sessionId: 'b', key: 'title', value: { title: 'NEW-002 桌面反向标记' },
  });
  assert.equal(next[0].projections.values.title, 'NEW-002 桌面反向标记');
  assert.equal(next[0].blank, false);
});

test('session/event turn/start unblanks and marks running for any session', () => {
  const rows = [{ sessionId: 'b', blank: true, running: false }];
  const next = applyHostFrame(rows, { type: 'session/event', sessionId: 'b', event: { type: 'turn/start', seq: 1 } });
  assert.equal(next[0].blank, false);
  assert.equal(next[0].running, true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test mobile/web/host/frames.test.js`
Expected: 2 FAIL（`applyHostFrame` 对这两种 type 直接 `return rows`）。

- [ ] **Step 3: 实现 applyHostFrame 扩展**

```js
// mobile/web/host/frames.js — 在 host/session-status 分支之后追加
  if (payload.type === 'session/projection' && payload.key === 'title') {
    const title = typeof payload.value === 'string'
      ? payload.value
      : (payload.value && typeof payload.value.title === 'string' ? payload.value.title : '');
    return rows.map((row) => (row.sessionId === payload.sessionId
      ? {
        ...row,
        blank: false,
        projections: { ...(row.projections || {}), values: { ...((row.projections || {}).values || {}), ...(title ? { title } : {}) } },
      }
      : row));
  }
  if (payload.type === 'session/event' && payload.event && payload.event.type === 'turn/start') {
    return rows.map((row) => (row.sessionId === payload.sessionId
      ? { ...row, blank: false, running: true }
      : row));
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test mobile/web/host/frames.test.js` → PASS。

- [ ] **Step 5: 失败测试 — 刷新调度器**

```js
// mobile/web/host/catalog-refresh.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogRefreshReason, createCatalogRefreshScheduler } from './catalog-refresh.js';

test('workspace/archive/session-added frames request a catalog refresh', () => {
  assert.equal(catalogRefreshReason({ type: 'host/workspace-changed' }), 'workspace');
  assert.equal(catalogRefreshReason({ type: 'host/workspace-order-changed' }), 'workspace');
  assert.equal(catalogRefreshReason({ type: 'host/workspace-removed' }), 'workspace');
  assert.equal(catalogRefreshReason({ type: 'host/archived-sessions-changed' }), 'archived');
  assert.equal(catalogRefreshReason({ type: 'host/session-added' }), 'session');
  assert.equal(catalogRefreshReason({ type: 'session/event', event: { type: 'assistant/message' } }), null);
});

test('scheduler coalesces bursts into one refresh', async () => {
  let calls = 0;
  const schedule = createCatalogRefreshScheduler(async () => { calls += 1; }, { delayMs: 10 });
  schedule('workspace'); schedule('session'); schedule('archived');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 1);
});
```

- [ ] **Step 6: 实现调度器**

```js
// mobile/web/host/catalog-refresh.js
const WORKSPACE_TYPES = new Set(['host/workspace-changed', 'host/workspace-order-changed', 'host/workspace-removed']);

function catalogRefreshReason(payload) {
  const type = payload && typeof payload === 'object' ? payload.type : '';
  if (WORKSPACE_TYPES.has(type)) return 'workspace';
  if (type === 'host/archived-sessions-changed') return 'archived';
  if (type === 'host/session-added') return 'session';
  return null;
}

function createCatalogRefreshScheduler(refresh, { delayMs = 400 } = {}) {
  let timer = null;
  let inflight = false;
  let again = false;
  const run = async () => {
    timer = null;
    if (inflight) { again = true; return; }
    inflight = true;
    try { await refresh(); } catch { /* caller shows banner on its own path */ }
    inflight = false;
    if (again) { again = false; schedule('coalesced'); }
  };
  function schedule() {
    if (timer) return;
    timer = setTimeout(run, delayMs);
  }
  return schedule;
}

export { catalogRefreshReason, createCatalogRefreshScheduler };
```

- [ ] **Step 7: 接线 app.js handleMuxFrame**

在 `mobile/web/app.js` 顶部 import：`import { catalogRefreshReason, createCatalogRefreshScheduler } from './host/catalog-refresh.js';`
在模块级声明：`const scheduleCatalogRefresh = createCatalogRefreshScheduler(async () => { await refreshHostCatalog(); renderSessions(); renderHeader(); });`
在 `handleMuxFrame` 中：

```js
  const { payload } = muxPayload(frame);
  // 任意会话的标题 / turn/start 直接落行（不再限制当前会话）
  if (payload?.type === 'session/projection' || (payload?.type === 'session/event' && payload.event?.type === 'turn/start')) {
    state.sessions = applyHostFrame(state.sessions, payload);
    renderSessions();
  }
  if (catalogRefreshReason(payload)) scheduleCatalogRefresh(catalogRefreshReason(payload));
```
保留原有 `session/projection && sessionId === state.sessionId` 分支（权限投影、当前标题栏）。

- [ ] **Step 8: daemon 侧确认转发**

```js
// src/shared/dshd-mux-sse.test.js（追加）
test('host/* and session/projection envelopes are forwarded', () => {
  for (const type of ['host/session-added', 'host/workspace-changed', 'host/workspace-order-changed', 'host/archived-sessions-changed', 'session/projection']) {
    assert.equal(shouldForwardMuxEnvelope({ payload: { type } }), true, type);
  }
});
```
Run: `node --test src/shared/dshd-mux-sse.test.js` → PASS（现实现已放行；此测试是防回归）。

- [ ] **Step 9: cache-bust + 全套单测**

`mobile/web/index.html`：`app.js?v=20260902-sync-reverse`。
Run: `node --test "mobile/web/**/*.test.js" "src/shared/*.test.js"` → 全绿。

- [ ] **Step 10: rehearsal 复测（LIST-003 / NEW-002 / MENU-002）**

前置：源码桌面在跑（`$env:DSH_SMOKE='1'; $env:DSH_REMOTE_PHONE_HOST='1'; $env:DSH_REMOTE_LAN='127.0.0.1'; .\node_modules\electron\dist\electron.exe --remote-debugging-port=9229 --remote-allow-origins=* .`），3080/3180/6767 在听。
Run: `node docs/qa/results/2026-09-01/full-web-v2/retest-menu2.mjs`（只看 NEW-002 / MENU-002 行）
Expected: `Pass NEW-002 — 桌面反向 N→N+1`；`Pass MENU-002 — 桌面改名 → 手机跟随`（≤30s）。

- [ ] **Step 11: Commit**

```bash
npm run check:remote-flag
git add mobile/web/host/frames.js mobile/web/host/frames.test.js mobile/web/host/catalog-refresh.js mobile/web/host/catalog-refresh.test.js mobile/web/app.js mobile/web/index.html src/shared/dshd-mux-sse.test.js
git commit -m "feature(mobile-remote): apply desktop-side session/workspace frames to the drawer (DEF-SYNC-REVERSE)"
```

---

### Task 2: DEF-DRAFT-SWITCH — 草稿按会话可靠往返

**Files:**
- Create: `mobile/web/conversation/draft-switch.js`、`mobile/web/conversation/draft-switch.test.js`
- Modify: `mobile/web/app.js:1481-1493`（`openSession`）、`app.js:4383-4388`（input 监听）
- Modify: `mobile/web/index.html`

**Interfaces:**
- Produces: `switchDraft({ store, fromId, toId, currentText, currentAttachments }) => { text, attachments }`：先把 `fromId` 的文本/附件写回 store，再读 `toId`。
- Produces: textarea 上 `data-draft-session` 属性 = 当前绑定的 sessionId；input 监听只在 `draft.dataset.draftSession === state.sessionId` 时保存。

- [ ] **Step 1: 确定性复现（fake host）**

```bash
node tools/mobile-web-qa/run-qa.mjs --only draft-switch
```
若该子集不存在，先在 `tools/mobile-web-qa/` 现有用例文件里加一条：打开 A → `page.type('#draft','CMP-018')` → 点 B 行 → 读 `localStorage['dsh-chisacode-drafts:<serverId>']` 断言 `JSON.parse(v)[A] === 'CMP-018'` → 点 A 行 → 断言 `#draft.value === 'CMP-018'`。
Expected: 第二个断言 FAIL（复现），并把中间 localStorage 快照打印出来定位是「存错 id」还是「载入被清」。

- [ ] **Step 2: 失败单测 — switchDraft 纯函数**

```js
// mobile/web/conversation/draft-switch.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { switchDraft } from './draft-switch.js';
import { createDraftStore } from '../chisacode/controller.js';

function memStorage() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; }

test('switchDraft persists the outgoing draft and restores the incoming one', () => {
  const store = createDraftStore(memStorage(), 'srv');
  let r = switchDraft({ store, fromId: 'A', toId: 'B', currentText: 'CMP-018 草稿', currentAttachments: [] });
  assert.equal(r.text, '');
  r = switchDraft({ store, fromId: 'B', toId: 'A', currentText: '', currentAttachments: [] });
  assert.equal(r.text, 'CMP-018 草稿');
});

test('switchDraft with same id is a no-op read', () => {
  const store = createDraftStore(memStorage(), 'srv');
  store.save('A', 'x');
  assert.equal(switchDraft({ store, fromId: 'A', toId: 'A', currentText: 'x', currentAttachments: [] }).text, 'x');
});
```

- [ ] **Step 3: 实现**

```js
// mobile/web/conversation/draft-switch.js
function switchDraft({ store, fromId, toId, currentText, currentAttachments }) {
  if (store && fromId && fromId !== toId) {
    store.save(fromId, typeof currentText === 'string' ? currentText : '');
    store.saveAttachments(fromId, Array.isArray(currentAttachments) ? currentAttachments : []);
  }
  if (!store || !toId) return { text: '', attachments: [] };
  return { text: store.load(toId) || '', attachments: store.loadAttachments(toId) || [] };
}
export { switchDraft };
```

- [ ] **Step 4: 接线 openSession 与 input 监听**

`openSession` 开头替换 1481-1493：
```js
  const previousSessionId = state.sessionId;
  const restored = state.transport === 'chisacode'
    ? switchDraft({ store: draftStore, fromId: previousSessionId, toId: sessionId, currentText: draft.value, currentAttachments: state.attachments })
    : { text: '', attachments: [] };
  state.sessionId = sessionId;
  draft.dataset.draftSession = sessionId;
  draft.value = restored.text;
  state.attachments = restored.attachments;
```
input 监听：
```js
draft.addEventListener('input', () => {
  if (state.transport === 'chisacode' && state.sessionId && draft.dataset.draftSession === state.sessionId) {
    draftStore?.save(state.sessionId, draft.value);
  }
  ...
```

- [ ] **Step 5: 单测 + fake host 复现脚本转绿**

Run: `node --test mobile/web/conversation/draft-switch.test.js`；`node tools/mobile-web-qa/run-qa.mjs --only draft-switch` → PASS。

- [ ] **Step 6: cache-bust `20260902-draft-switch`，rehearsal CMP-018**

Run: `node docs/qa/results/2026-09-01/full-web-v2/run-chat-appr.mjs`（看 CMP-018 行）→ `Pass CMP-018 — 草稿隔离 OK`。

- [ ] **Step 7: Commit**

```bash
git add mobile/web/conversation/draft-switch.js mobile/web/conversation/draft-switch.test.js mobile/web/app.js mobile/web/index.html tools/mobile-web-qa
git commit -m "feature(mobile-remote): persist draft on session switch instead of relying on input events (DEF-DRAFT-SWITCH)"
```

---

### Task 3: DEF-ATTACH-TEXTMODEL — 发送前识图守卫 + 错误事件可见

**Files:**
- Create: `mobile/web/host/attach-guard.js`、`mobile/web/host/attach-guard.test.js`
- Modify: `mobile/web/host/models.js`（`flattenModels` 保留 `supportsImages`、`visionFallbackModel`）+ `models.test.js`
- Modify: `mobile/web/app.js`（发送路径 `session.prompt` 前；`renderLog` 错误事件）
- Modify: `mobile/web/index.html`

**Interfaces:**
- Produces: `attachmentGuard({ current, attachments, visionFallback }) => { ok: true } | { ok: false, message }`；`message` 固定为 `当前模型不支持图片；请切换识图模型或移除附件`。
- Produces: `flattenModels` 输出行带 `supportsImages: boolean|undefined`，`state.modelCatalog.visionFallback`（daemon `visionFallbackModel` 透传）。

- [ ] **Step 1: 失败测试**

```js
// mobile/web/host/attach-guard.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentGuard } from './attach-guard.js';

test('blocks images on a text-only model without vision fallback', () => {
  const r = attachmentGuard({ current: { provider: 'ayase', model: 'grok-4.6', supportsImages: false }, attachments: [{ mediaType: 'image/png', data: 'x' }], visionFallback: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /不支持图片/);
});
test('allows when model supports images or a vision fallback exists', () => {
  assert.equal(attachmentGuard({ current: { supportsImages: true }, attachments: [{}], visionFallback: null }).ok, true);
  assert.equal(attachmentGuard({ current: { supportsImages: false }, attachments: [{}], visionFallback: { provider: 'deepseek', model: 'V4-Flash-Vision' } }).ok, true);
});
test('allows text-only sends regardless', () => {
  assert.equal(attachmentGuard({ current: { supportsImages: false }, attachments: [], visionFallback: null }).ok, true);
});
test('unknown supportsImages is treated as unsupported (fail closed)', () => {
  assert.equal(attachmentGuard({ current: {}, attachments: [{}], visionFallback: null }).ok, false);
});
```

- [ ] **Step 2: 实现守卫**

```js
// mobile/web/host/attach-guard.js
const MESSAGE = '当前模型不支持图片；请切换识图模型或移除附件';
function attachmentGuard({ current, attachments, visionFallback }) {
  const hasImages = Array.isArray(attachments) && attachments.length > 0;
  if (!hasImages) return { ok: true };
  if (current && current.supportsImages === true) return { ok: true };
  if (visionFallback && visionFallback.model) return { ok: true };
  return { ok: false, message: MESSAGE };
}
export { attachmentGuard };
```

- [ ] **Step 3: models.js 透传字段（先加测试）**

在 `mobile/web/host/models.test.js` 增：`flattenModels` 输入含 `{ provider, id, supportsImages: false }` 与 `visionFallbackModel: { provider, model }` 时，输出 `rows[i].supportsImages === false`、`current.supportsImages` 对齐当前行、`visionFallback` 等于输入。跑 → FAIL → 在 `flattenModels` 里把这两个字段从 `session.models` 返回体复制到行与 `current`（当前行按 provider+model 匹配）。

- [ ] **Step 4: 接线发送路径**

在 `app.js` `session.prompt` 调用前（约 2005 行）：
```js
  const guard = attachmentGuard({ current: state.modelCatalog.current, attachments: images, visionFallback: state.modelCatalog.visionFallback });
  if (!guard.ok) { showBanner(guard.message); return; }
```

- [ ] **Step 5: 错误事件可见**

在 `renderLog` 折页里：`session/event` 且 `event.type` 匹配 `/error|turn\/failed|rejected/` 的事件渲染为 `.log-error` 行，文本 `event.message || event.error || '本轮失败'`。测试：`mobile/web/conversation/fold.test.js` 增一条 `foldEvents` 把 `{type:'turn/error', message:'x'}` 折成 `{ kind: 'error', text: 'x' }`。

- [ ] **Step 6: cache-bust `20260902-attach-guard`；单测 + rehearsal CMP-021**

Run: `node docs/qa/results/2026-09-01/full-web-v2/run-chat-appr.mjs` → `CMP-021` 期望改为：附图 + grok-4.6 点发送 → banner「当前模型不支持图片…」，无新用户气泡。脚本对应断言改成读 `#banner`。

- [ ] **Step 7: Commit**

```bash
git add mobile/web/host/attach-guard.js mobile/web/host/attach-guard.test.js mobile/web/host/models.js mobile/web/host/models.test.js mobile/web/conversation/fold.js mobile/web/conversation/fold.test.js mobile/web/app.js mobile/web/index.html docs/qa/results/2026-09-01/full-web-v2/run-chat-appr.mjs
git commit -m "feature(mobile-remote): pre-send image guard for text-only models and visible turn errors (DEF-ATTACH-TEXTMODEL)"
```

---

### Task 4: DEF-MOVE-NOOP — 上移/下移语义对齐 host

**Files:**
- Read: `vendor/deepseek-harness/packages/api/workspace-controller/src/**`（`insertSessionBefore` 请求字段与语义）
- Modify: `mobile/web/host/catalog.js:111-135`、`catalog.test.js`
- Create: `docs/qa/results/<日期>/move-probe.mjs`（live 探针）

**Interfaces:**
- Produces: `insertSessionMove(row, direction, workspaces, liveRows)` 输出与 host 契约一致；新增单测覆盖 2 行 / 3 行 / 首尾边界。

- [ ] **Step 1: 读 host 契约**

`rg -n "insertSessionBefore" vendor/deepseek-harness/packages/api/workspace-controller vendor/deepseek-harness/packages/host/apiproxy/src/api/rpc-map.ts`，抄下字段名与说明（`sessionId` 是被移动者？`beforeSessionId` 为 null 是否表示末尾？）。

- [ ] **Step 2: live 探针**

```js
// move-probe.mjs：配对 → 在 dshd-qa-* 组开 3 条会话 → 抄 workspace.list 该夹 sessionIds → 对第 3 条 hostCall('workspace.insertSessionBefore', payload) → 再抄 sessionIds → 打印 before/after 与 payload
```
Expected：能看出是 (a) RPC 无效（顺序不变）还是 (b) 顺序变了但 SPA 没重画。

- [ ] **Step 3: 失败单测（按 Step 1 契约写）**

```js
test('insertSessionMove up/down on a 3-row group returns host-contract payloads', () => {
  const ws = { items: [{ workspaceId: 'w', sessionIds: ['a', 'b', 'c'] }] };
  const rows = ['a', 'b', 'c'].map((id) => ({ sessionId: id, workspaceId: 'w' }));
  assert.deepEqual(insertSessionMove(rows[1], 'up', ws, rows), { workspaceId: 'w', sessionId: 'b', beforeSessionId: 'a' });
  assert.deepEqual(insertSessionMove(rows[1], 'down', ws, rows), { workspaceId: 'w', sessionId: 'c', beforeSessionId: 'b' });
  assert.equal(insertSessionMove(rows[0], 'up', ws, rows), null);
  assert.equal(insertSessionMove(rows[2], 'down', ws, rows), null);
});
```
若 Step 1 契约是「把 `sessionId` 移到 `beforeSessionId` 之前」则上面即当前实现应绿；若 (b)，改为在 `moveSession` 成功后 **用 RPC 返回的 sessionIds 直接覆写** `state.workspaces.items[w].sessionIds` 再 `renderSessions()`，不等 `refreshHostCatalog`。

- [ ] **Step 4: 修复 + 单测绿 + rehearsal MENU-007（3 行组）**

在 `retest-menu3.mjs` MENU-007 前先用工作区 `+` 再建一条，保证 3 行；Expected：`Pass MENU-007 — 上移生效`。

- [ ] **Step 5: Commit** `feature(mobile-remote): align manual session ordering with workspace.insertSessionBefore (DEF-MOVE-NOOP)`

---

### Task 5: DEF-ACCESS-LABEL — 权限预设文案与桌面同源

**Files:**
- Read: `rg -n "完全权限|工作区写入|只读" vendor/deepseek-harness/packages/client --glob "*.{ts,tsx,json}"`
- Modify: `mobile/web/host/permission.js`、`permission.test.js`

- [ ] **Step 1: 抄桌面 locale 三条中文**（预期 `只读 / 工作区写入 / 完全权限`）。
- [ ] **Step 2: 失败测试**：`permission.test.js` 断言 `presetLabel('full-access') === '完全权限'`（与桌面字符串全等）。
- [ ] **Step 3: 改标签表；跑测试绿。**
- [ ] **Step 4: 更新 live 脚本正则**：`docs/qa/results/2026-09-01/full-web-v2/run-cmp.mjs`、`run-lay.mjs` 中 `/完全访问/` → `/完全权限/`。
- [ ] **Step 5: Commit** `feature(mobile-remote): use desktop permission preset labels (DEF-ACCESS-LABEL)`

---

### Task 6: DEF-SRCH-LIVE — 搜索态不被 live 刷新重画

**Files:**
- Modify: `mobile/web/app.js:600-630`（`renderSessions`）
- Create: `mobile/web/conversation/search-view.js` + test

**Interfaces:**
- Produces: `searchViewActive(query, searchState) => boolean`：`query.trim()` 非空即为真，与 `searchLoading` 无关；`renderSessions` 在此为真时只渲染 `searchHits`。

- [ ] **Step 1: 失败测试**

```js
test('search view stays active while hits are loading or empty', () => {
  assert.equal(searchViewActive('验证码', { searchLoading: true, searchHits: [] }), true);
  assert.equal(searchViewActive('验证码', { searchLoading: false, searchHits: null }), true);
  assert.equal(searchViewActive('   ', { searchHits: [{}] }), false);
});
```

- [ ] **Step 2: 实现并接线**：`renderSessions` 用 `searchViewActive(state.query, state)`；`refreshHostCatalog` 与 `handleMuxFrame` 路径 **不得** 清 `state.searchHits` / `state.query`（grep 确认无 `state.query = ''` 出现在这些路径；若有则移除）。
- [ ] **Step 3: rehearsal**：`retest-list2.mjs` SRCH-001 在发送一轮 running 期间搜索，行数恒 ≤20。
- [ ] **Step 4: Commit** `feature(mobile-remote): keep search results stable across live catalog refreshes (DEF-SRCH-LIVE)`

---

### Task 7: 固化 v2 rehearsal 套件（消灭驱动假 Fail）

**Files:**
- Create: `tools/remote-web-qa/full-web-v2/lib.mjs`（从 `docs/qa/results/2026-09-01/full-web-v2/lib.mjs` 迁入并整理）
- Create: `tools/remote-web-qa/full-web-v2/run.mjs`（按 §16 顺序串所有模块；`--module PAIR,LAY,...` 可选）
- Create: `tools/remote-web-qa/full-web-v2/report.mjs`（生成 `REPORT.md` + §17 汇总，Blocked 必带 reason）
- Modify: `package.json`：`"qa:remote:v2": "node tools/remote-web-qa/full-web-v2/run.mjs"`

**Interfaces（oracle 规则，写进 lib 顶部注释并单测）：**
- 会话行：`#session-list .session-row:not(.workspace-head):not(.session-child)`；行菜单 `[aria-label="会话操作"]`；工作区菜单 `[aria-label="工作区操作"]`；`+` 是 `[aria-label="在此工作区新建会话"]`。
- 桌面工作区头：`button[aria-label^="工作区“"]`；桌面行菜单：`button[aria-label="会话“<title>”的操作"]`；桌面折叠：先展开 `[class*="_folder"][aria-expanded="false"]`（跳过 已归档），再循环点「展开其余 N 个会话」直到无。
- Git 主按钮：git sheet 内匹配 `/^(Commit & push|Commit, push & PR|Push & create PR|Publish repository|View PR|Commit|Push|Pull|Sync branch)$/` 的行，**不是** pill。
- 裸仓核对：`git -C <bare> log --oneline -3 main`（桌面 `gitPush` 推的是当前分支名）。
- 标题稳定：菜单类用例前等待 `title !== 'session' && title !== '新会话'`（最多 30s）。
- 可见性：用 `getBoundingClientRect().width>0` 而非 `offsetParent`。
- 新会话必先 `switchGrok()`（§0.9），否则默认模型无密钥发送悬死。

- [ ] **Step 1: 迁入 lib 并加 oracle 单测**（`lib.test.mjs`：`multisetDiff`、`catalogRefreshReason` 不在此；只测纯函数 `normalizeAccessLabel`、`primaryLabelOf(sheetText)`）。
- [ ] **Step 2: run.mjs 串联 PAIR→LAY→LIST→SRCH→MENU→ARCH→NEW→CMP→CHAT→APPR→GIT→DISC→FRZ→SET→SIGN**，每模块结束写 results.json；任一 P0 Fail 时默认停在该模块（`--continue` 可绕）。
- [ ] **Step 3: 全套跑一遍**：`npm run qa:remote:v2`。Expected：Task 1–6 修复后 Fail=0；Blocked 只剩「造障 / 人工 / 轨外」三类。
- [ ] **Step 4: Commit** `feature(mobile-remote): reusable full-web v2 rehearsal suite with hardened oracles`

---

## Phase 2 · 门禁与代码审查

### Task 8: 自动化门禁 + 审查

- [ ] `npm test`（全仓）、`node --test "mobile/web/**/*.test.js"`、`npm run qa:remote`（remote gate）、`npm run check:remote-flag`。
- [ ] 按 `superpowers:requesting-code-review` 对 Task 1–7 的提交范围做一次审查：重点核 NEVER（无 `host.pickDirectory` / `/api` 代理 / DSH_HOME 注入）、卡不变量（sticky 键不变、mux 不转发 `assistant/chunk`）、以及每个修复都有失败→通过的测试。
- [ ] 审查意见逐条修完再进 Phase 3。

---

## Phase 3 · 实机（T2 rehearsal → 造障 → 人工 → 真机 T2 → 公网 T1）

### Task 9: T2 rehearsal 全量复跑（自动）

- [ ] 桌面：源码 Electron（命令见 Task 1 Step 10），确认 `apps/web/dist/index.html` 存在（缺则 `node ..\..\node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-web-frontend run build`）。
- [ ] 夹具：新建 `C:\Ai\dshd-qa-ws-<日期>` + `README.md`；`git init --bare C:\Ai\dshd-qa-remote-<日期>.git`；clone 一份推 `main` 与 `qa-remote-only`。
- [ ] `npm run qa:remote:v2 -- --out docs/qa/results/<日期>/full-web-v2`。
- [ ] 期望：Fail=0；Blocked 仅 PAIR-015/017/018、LIST-011、SRCH-004、ARCH-006、CHAT-007、GIT-007（造障）；PAIR-002b/003/005/019（打断全场）；GIT-005/006/013/014、ARCH-003、CMP-010/019、APPR-003、MENU-014、DISC-001/004（人工）；PAIR-001/006、LAY-015（轨外）；PAIR-016（T3）。

### Task 10: 造障批准场（须书面同意后一次做完，末尾恢复）

- [ ] 取得执行人书面同意（聊天记录即可，写进报告）。
- [ ] PAIR-015/017/018 + LIST-011 + SRCH-004 + ARCH-006 + CHAT-007 + GIT-007：停 Harness（桌面启动器「停止」或 kill `chisacode-daemon-runner` 子进程 **仅限本机 dev 实例**）→ 手机刷新 / 搜索 / 取消归档 / 切会话 / 开分支菜单，各截图断言「明文错误、非空列表、可重试」→ 恢复 → LIST-001 再过。
- [ ] PAIR-003/019：断中继（防火墙拦 `125.124.85.212:8411` 出站 60s）→ 弹窗无二维码；已配对 SPA 断线横幅、不卸配对 → 恢复。
- [ ] PAIR-002b/005：桌面设置远程切「外出」→ 3180 停听、二维码 origin 变公网；切回「局域网」→ 恢复。
- [ ] 全部记录到 results.json（`record(id,'Pass'|'Fail',note,[shots])`）。

### Task 11: 人工一次点击清单（同一台桌面，手机 SPA 与桌面并排截图）

| ID | 操作 | 期望 |
| --- | --- | --- |
| GIT-013 | 临时仓设裸仓 HEAD→main，SPA 在 main 上 Push | 弹 Continue / Abort / Checkout feature；Abort 不推，Continue 推 |
| GIT-014 | 临时仓 origin 改坏路径，SPA Push | toast 含 git 错误，可复制，不永久 loading |
| GIT-005 | 分支菜单点 `origin/qa-remote-only` | 建本地跟踪并检出，非 detached |
| GIT-006 | 从 clone 推分支名 `qa/we!rd` | 列出但禁用 + hint |
| GIT-015 | 会话 cwd 指向未登记目录 | 胶囊显示授权错误，不是「没有分支」 |
| ARCH-003 | 桌面已归档 ⋯ 取消归档 | 手机 ≤30s 回活列表 |
| CMP-010 / CMP-019 / APPR-003 | 桌面打开同一会话：改权限 / 开 Plan / 桌面裁决审批 | 手机 chip 跟、Plan chip 出、审批条消失 |
| MENU-014 | 桌面拖拽会话顺序 | 手机顺序跟 |
| DISC-004 | 手机断线时桌面发一句 | 重连后手机补齐 |

- [ ] 逐条执行并 `record`。

### Task 12: F-APPR 强化（审批模块必须真弹一次）

- [ ] 在桌面 PermissionSelect 把会话切到「会询问」的档（若三档都不询问：临时改 `dsh-home/settings.yaml` 该会话工具策略为 ask，测完还原）。
- [ ] 手机发 `在工作区根目录创建 dshd-qa-approve.txt，内容 qa。` → 手机条 + 桌面窗同时截图（APPR-001/LAY-008 三视口用浏览器缩放补 360/430）→ 手机允许一次（APPR-002）→ 再触发桌面拒绝（APPR-003）→ 再触发手机拒绝（APPR-004）→ 审批期间发送禁用 / 斜杠关（APPR-005）→ 无幽灵 pending（APPR-006）。
- [ ] 若模型仍直答：换 DeepSeek 路由复测一次并注明模型；两模型都不弹才允许 Blocked。

### Task 13: 真机 T2（LAN 手机浏览器）

- [ ] 桌面远程=局域网；手机与桌面同网；系统相机扫二维码（PAIR-006）；`http://<LAN>:3180/app.js` 指纹含最新 cache-bust（PAIR-004）。
- [ ] 手点走 S 套件：LAY-001~013（真机宽 + 桌面设备模式 360/430）、LAY-015 安全区、LIST-001（对桌面截图抄 D/P）、CHAT-001/002 五轮（附验证码原文）、CHAT-003 ACK、CMP-009 权限再聊、CMP-021 附图被拦、GIT-001/008/009/010 临时仓、DISC-001 关 Wi-Fi 横幅 + 草稿 → 开 Wi-Fi 重连。
- [ ] 报告标「T2 真机」，与 Task 9 rehearsal 分节。

### Task 14: 公网 T1

- [ ] 部署：把 `mobile/web/` 当前树发到 nginx `/dshd/`（执行人既有流程）；`curl http://125.124.85.212:3389/dshd/index.html` 的 `app.js?v=` 必须等于仓库 `index.html`；`curl .../dshd/app.js | rg -c fetchAgents` = 0（PAIR-001/004）。
- [ ] 桌面远程=外出；手机蜂窝网络 + 系统相机扫码进 chat（PAIR-006）；sticky 无 hash 重连（PAIR-010）；跨 origin 不继承（PAIR-011）。
- [ ] 在公网 T1 上重跑 Task 13 同一手点清单 + CHAT-009（DevTools 远程调试看 mux 无 `assistant/chunk`）。
- [ ] 报告标「T1」。

### Task 15: 签字与收口

- [ ] 用 `report.mjs` 生成 `REPORT.md`：§17 每模块 P0 基数 vs Pass/Fail/Blocked(豁免?)/NA；Fail 必须为 0；Blocked 只允许带产品负责人豁免栏的条目。
- [ ] SIGN-001~004 逐条勾：无白名单、无非法证据、改状态 P0 均有双端截图、每模块主/反/空/失败/边界都有条目。
- [ ] 更新 `docs/features/mobile-remote.md` `last verified`（写清 T2 真机 / T1 结果与残留 Blocked 豁免）；`docs/qa/mobile-remote-live-acceptance.md` 引用本次报告。
- [ ] 决策记录：0.2.8 是否解禁 `REMOTE_FEATURE_ENABLED`。**只有** T1 全部 P0 Pass 且无未豁免 Blocked 才允许在独立提交里翻 `true`；否则保持 parked，`check:remote-flag` 继续拦。
- [ ] 清理：归档/删除测试会话（标题含 qa / 反向标记 / SEED / ACK）、unlist `dshd-qa-*` 工作区（磁盘保留）。

---

## Self-Review

- **Spec coverage：** REPORT.md 列出的 7 个缺陷各有任务（1–6）；驱动假 Fail → Task 7；全部 Blocked 类别 → Task 10（造障）/ 11（人工）/ 12（审批）/ 13–14（轨外）；签字与卡片 → Task 15。MUST 矩阵未被本计划改动的行（Files/MCP 冻结、NEVER）由 Task 8 审查与 FRZ 模块复跑覆盖。
- **Placeholder scan：** Task 2 Step 1 与 Task 4 Step 1–2 是显式诊断步骤，给出了精确命令与判定分叉；无 TBD。
- **Type consistency：** `applyHostFrame(sessions, payload)`、`catalogRefreshReason(payload)`、`createCatalogRefreshScheduler(refresh, { delayMs })`、`switchDraft({ store, fromId, toId, currentText, currentAttachments })`、`attachmentGuard({ current, attachments, visionFallback })`、`insertSessionMove(row, direction, workspaces, liveRows)`、`searchViewActive(query, searchState)` 在各任务中签名一致。
