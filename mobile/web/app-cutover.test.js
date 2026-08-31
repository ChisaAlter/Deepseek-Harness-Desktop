import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.js'), 'utf8');

test('paired SPA path does not call ACP fetchAgents or createAgent', () => {
  assert.equal(app.includes('fetchAgents'), false, 'app.js still mentions fetchAgents');
  assert.equal(app.includes('createMobileAgent'), false, 'app.js still mentions createMobileAgent');
  assert.equal(app.includes('createAgent('), false, 'app.js still mentions createAgent(');
});

test('paired SPA path does not tell users to create branches on the desktop', () => {
  assert.equal(app.includes('创建新分支（请在电脑端操作）'), false);
  assert.equal(app.includes('请在电脑上发布仓库'), false);
  assert.equal(app.includes('新建分支请在电脑端操作'), false);
});

test('composer and drawer gaps follow the 4px spacing grid', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8');
  assert.match(css, /\.composer-side \{ display: flex; align-items: center; gap: 8px; \}/);
  assert.match(css, /\.session-row \{ display: flex; align-items: center; gap: 4px; \}/);
  assert.equal(css.includes('.composer-side { display: flex; align-items: center; gap: 2px; }'), false);
});

test('paired SPA executes host slash commands, not session.prompt as /permission chat', () => {
  assert.match(app, /commands\/execute/);
  assert.match(app, /commands\/list/);
  assert.match(app, /runHostCommand\(permissionCommand\(modeId\)\)/);
  assert.equal(app.includes('promptPayload([textBlock(permissionCommand'), false);
  assert.equal(app.includes("promptPayload([textBlock('/plan off')])"), false);
});

test('new-session browse unwraps workspace.create nested id and keeps open blank sessions', () => {
  assert.match(app, /workspaceIdFromCreate\(/);
  assert.match(app, /heldSessionRow\(/);
  assert.match(app, /withHeldLiveRow\(/);
});

test('history poll hydrates unanswered approval/asked into the strip', () => {
  assert.match(app, /pendingFromHistoryEvents\(/);
  assert.match(app, /mergeApprovalPending\(/);
  const poll = app.slice(app.indexOf('historyPollTimer = setInterval'));
  assert.match(poll, /applyHistoryPayload\(payload\)/);
  assert.match(poll, /renderApproval\(\)/);
});

test('opening a session refreshes Git so the titlebar pill can show', () => {
  assert.match(app, /void refreshGit\(\)/);
});

test('drawer search is host session.search with a 20-hit hasMore hint', () => {
  assert.match(app, /hostCall\(paired\.client, 'session\.search', \{ query \}\)/);
  assert.match(app, /state\.searchHasMore = result\.hasMore === true/);
  assert.match(app, /还有更多结果，请改用更精确的词/);
});

test('paired SPA uses host history poll and freeze bars, not ACP files', () => {
  assert.match(app, /historyQuery\(/);
  assert.match(app, /sessionRowForest/);
  assert.match(app, /subscribeHostMux/);
  assert.match(app, /session\.selectModel/);
  assert.match(app, /gitCreateBranch/);
  assert.match(app, /host\.listDirectory/);
  assert.match(app, /freezePane/);
  assert.equal(app.includes('openEventSockets({ origin'), false);
});
