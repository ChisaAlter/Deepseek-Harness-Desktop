import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHostFrame, hostFrameNeedsCatalogRefresh, hostLabel } from './frames.js';

test('hostLabel uses cwd folder then 已连接', () => {
  assert.equal(hostLabel({ cwd: 'C:\\Ai\\Deepseek-Harness-Desktop' }), 'Deepseek-Harness-Desktop');
  assert.equal(hostLabel({ cwd: '/tmp/work' }), 'work');
  assert.equal(hostLabel({}), '已连接');
});

test('applyHostFrame adds, updates running, and removes sessions', () => {
  let rows = [];
  rows = applyHostFrame(rows, {
    type: 'host/session-added',
    sessionId: 's1',
    blank: true,
  });
  assert.equal(rows[0].sessionId, 's1');
  assert.equal(rows[0].blank, true);
  rows = applyHostFrame(rows, { type: 'host/session-status', sessionId: 's1', running: true });
  assert.equal(rows[0].running, true);
  rows = applyHostFrame(rows, { type: 'host/session-removed', sessionId: 's1' });
  assert.equal(rows.length, 0);
});

// DEF-SYNC-REVERSE: desktop-side sessions arrive blank via host/session-added and
// only become visible once a title projection / first turn lands. Those frames
// target *other* sessions, so the drawer must apply them to any row.
test('session/projection title updates any session row and unblanks it', () => {
  const rows = [{ sessionId: 'b', blank: true, projections: { values: {} } }, { sessionId: 'a', blank: false }];
  const next = applyHostFrame(rows, {
    type: 'session/projection', sessionId: 'b', key: 'title', value: { title: 'NEW-002 桌面反向标记' },
  });
  assert.equal(next[0].projections.values.title, 'NEW-002 桌面反向标记');
  assert.equal(next[0].blank, false);
  assert.equal(next[1].blank, false);
  assert.equal(next[1].projections, undefined);
});

test('session/projection with a plain string title is accepted', () => {
  const next = applyHostFrame([{ sessionId: 'b', blank: true }], {
    type: 'session/projection', sessionId: 'b', key: 'title', value: '直接字符串',
  });
  assert.equal(next[0].projections.values.title, '直接字符串');
});

test('session/projection for other keys leaves rows untouched', () => {
  const rows = [{ sessionId: 'b', blank: true }];
  const next = applyHostFrame(rows, { type: 'session/projection', sessionId: 'b', key: 'permission', value: {} });
  assert.deepEqual(next, rows);
});

test('session/projection sessionListMetadata drives the blank flag', () => {
  const rows = [{ sessionId: 'b', blank: true }];
  const next = applyHostFrame(rows, { type: 'session/projection', sessionId: 'b', key: 'sessionListMetadata', value: { blank: false } });
  assert.equal(next[0].blank, false);
  const back = applyHostFrame(next, { type: 'session/projection', sessionId: 'b', key: 'sessionListMetadata', value: { blank: true } });
  assert.equal(back[0].blank, true);
});

test('hostFrameNeedsCatalogRefresh flags projections for rows the drawer does not hold', () => {
  const rows = [{ sessionId: 'a' }];
  assert.equal(hostFrameNeedsCatalogRefresh(rows, { type: 'session/projection', sessionId: 'b', key: 'title', value: 'x' }), true);
  assert.equal(hostFrameNeedsCatalogRefresh(rows, { type: 'session/projection', sessionId: 'b', key: 'sessionListMetadata', value: { blank: false } }), true);
  assert.equal(hostFrameNeedsCatalogRefresh(rows, { type: 'session/projection', sessionId: 'a', key: 'title', value: 'x' }), false);
  assert.equal(hostFrameNeedsCatalogRefresh(rows, { type: 'session/projection', sessionId: 'b', key: 'contextPressure', value: {} }), false);
  assert.equal(hostFrameNeedsCatalogRefresh(rows, { type: 'session/queue', sessionId: 'b' }), false);
});

test('session/event turn/start unblanks and marks running for any session', () => {
  const rows = [{ sessionId: 'b', blank: true, running: false }];
  const next = applyHostFrame(rows, { type: 'session/event', sessionId: 'b', event: { type: 'turn/start', seq: 1 } });
  assert.equal(next[0].blank, false);
  assert.equal(next[0].running, true);
});

test('session/event other than turn/start does not change rows', () => {
  const rows = [{ sessionId: 'b', blank: true, running: false }];
  const next = applyHostFrame(rows, { type: 'session/event', sessionId: 'b', event: { type: 'assistant/message', seq: 2 } });
  assert.deepEqual(next, rows);
});
