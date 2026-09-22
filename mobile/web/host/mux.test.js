import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalFromMux, approvalResolvedId, muxEventShouldApply, runningFromMux } from './mux.js';

test('approvalFromMux reads rpcId and tool name from a mux envelope', () => {
  const pending = approvalFromMux({
    rpcId: 'r1',
    envelope: {
      type: 'server-request',
      rpcId: 'r1',
      payload: {
        type: 'approval/requested',
        sessionId: 's1',
        approvalId: 'a1',
        toolName: 'bash',
        reason: 'rm -rf',
      },
    },
  });
  assert.equal(pending.rpcId, 'r1');
  assert.equal(pending.approvalId, 'a1');
  assert.equal(pending.title, 'bash');
  assert.equal(pending.actions.length, 2);
});

test('approvalResolvedId returns the settled approval id', () => {
  assert.equal(approvalResolvedId({
    rpcId: 'r2',
    envelope: { type: 'approval/resolved', approvalId: 'a1' },
  }), 'a1');
});

test('runningFromMux reads host/session-status including idle', () => {
  assert.equal(runningFromMux({
    rpcId: 'r3',
    envelope: {
      type: 'server-request',
      payload: { type: 'host/session-status', sessionId: 's1', running: false },
    },
  }), false);
  assert.equal(runningFromMux({
    rpcId: 'r4',
    envelope: {
      type: 'server-request',
      payload: { type: 'host/session-status', sessionId: 's1', running: true },
    },
  }), true);
});

test('muxEventShouldApply skips assistant/chunk live events', () => {
  assert.equal(muxEventShouldApply({
    type: 'session/event',
    sessionId: 's1',
    event: { type: 'assistant/chunk', seq: 9 },
  }), false);
  assert.equal(muxEventShouldApply({
    type: 'session/event',
    sessionId: 's1',
    event: { type: 'tool/call', seq: 10 },
  }), true);
});
