import test from 'node:test';
import assert from 'node:assert/strict';
import { muxPatch } from './live.js';

test('muxPatch folds session events and approval takeover for the open session', () => {
  const event = muxPatch({
    type: 'server-request',
    rpcId: 'e1',
    payload: {
      type: 'session/event',
      sessionId: 's1',
      event: { type: 'user/message', seq: 1, time: 1, data: {} },
      view: { for: 'call', view: { card: 'bash' } },
    },
  }, 's1');
  assert.equal(event.type, 'event');
  assert.equal(event.entry.view.view.card, 'bash');

  const other = muxPatch({
    payload: { type: 'session/event', sessionId: 's2', event: { type: 'user/message' } },
  }, 's1');
  assert.equal(other, null);

  const asked = muxPatch({
    rpcId: 'r-ap',
    payload: {
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'a1',
      toolName: 'bash',
      reason: 'git status',
    },
  }, 's1');
  assert.equal(asked.type, 'approval');
  assert.equal(asked.pending.outcomeNeeded, true);
  assert.equal(asked.pending.rpcId, 'r-ap');
  assert.equal(asked.pending.command, 'git status');

  const done = muxPatch({ payload: { type: 'approval/resolved', sessionId: 's1' } }, 's1');
  assert.equal(done.type, 'approval-clear');

  const title = muxPatch({
    payload: { type: 'session/projection', sessionId: 's1', key: 'title', value: '壁纸图库', seq: 3 },
  }, 's1');
  assert.equal(title.type, 'title');
  assert.equal(title.value, '壁纸图库');
});
