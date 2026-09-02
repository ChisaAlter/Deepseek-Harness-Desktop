import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogRefreshReason, createCatalogRefreshScheduler } from './catalog-refresh.js';

test('workspace / archive / session-added frames request a catalog refresh', () => {
  assert.equal(catalogRefreshReason({ type: 'host/workspace-changed' }), 'workspace');
  assert.equal(catalogRefreshReason({ type: 'host/workspace-order-changed' }), 'workspace');
  assert.equal(catalogRefreshReason({ type: 'host/workspace-removed' }), 'workspace');
  assert.equal(catalogRefreshReason({ type: 'host/archived-sessions-changed' }), 'archived');
  assert.equal(catalogRefreshReason({ type: 'host/session-added' }), 'session');
  assert.equal(catalogRefreshReason({ type: 'host/session-removed' }), 'session');
});

test('chat traffic never triggers a catalog refresh', () => {
  assert.equal(catalogRefreshReason({ type: 'session/event', event: { type: 'assistant/message' } }), null);
  assert.equal(catalogRefreshReason({ type: 'session/projection', key: 'title' }), null);
  assert.equal(catalogRefreshReason({ type: 'host/session-status' }), null);
  assert.equal(catalogRefreshReason(null), null);
});

test('scheduler coalesces a burst into one refresh', async () => {
  let calls = 0;
  const schedule = createCatalogRefreshScheduler(async () => { calls += 1; }, { delayMs: 10 });
  schedule('workspace');
  schedule('session');
  schedule('archived');
  await new Promise((resolve) => { setTimeout(resolve, 60); });
  assert.equal(calls, 1);
});

test('scheduler re-runs once when frames arrive during an in-flight refresh', async () => {
  let calls = 0;
  let release = null;
  const schedule = createCatalogRefreshScheduler(() => new Promise((resolve) => {
    calls += 1;
    release = resolve;
  }), { delayMs: 5 });
  schedule('workspace');
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  assert.equal(calls, 1);
  schedule('session');
  schedule('session');
  release();
  await new Promise((resolve) => { setTimeout(resolve, 40); });
  assert.equal(calls, 2);
  release();
});

test('scheduler swallows refresh errors so the mux loop survives', async () => {
  const schedule = createCatalogRefreshScheduler(async () => { throw new Error('host down'); }, { delayMs: 5 });
  schedule('workspace');
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  assert.ok(true);
});
