import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_PAGE_MESSAGES, historyQuery, hostHistoryPage, mergeApprovalPending, mergeOlderHistory, pendingFromHistoryEvents, runningFromHistoryEvents } from './history.js';

test('historyQuery pages like dsh web (50 messages)', () => {
  assert.deepEqual(historyQuery('s1'), { sessionId: 's1', maxMessages: HISTORY_PAGE_MESSAGES });
  assert.deepEqual(historyQuery('s1', { beforeSeq: 9 }), { sessionId: 's1', maxMessages: 50, beforeSeq: 9 });
});

test('hostHistoryPage maps hasMore onto beforeSeq of the oldest event', () => {
  const page = hostHistoryPage({
    hasMore: true,
    events: [
      { event: { type: 'user/message', seq: 40 } },
      { event: { type: 'assistant/message', seq: 41 } },
    ],
    projections: { asOfSeq: 41, values: { title: 't' } },
  });
  assert.equal(page.hasOlder, true);
  assert.equal(page.beforeSeq, 40);
  assert.equal(page.events.length, 2);
});

test('runningFromHistoryEvents uses the newest turn/start or turn/end', () => {
  assert.equal(runningFromHistoryEvents([]), null);
  assert.equal(runningFromHistoryEvents([{ event: { type: 'user/message', seq: 1 } }]), null);
  assert.equal(runningFromHistoryEvents([
    { event: { type: 'turn/start', seq: 1 } },
    { event: { type: 'assistant/message', seq: 2 } },
  ]), true);
  assert.equal(runningFromHistoryEvents([
    { event: { type: 'turn/start', seq: 1 } },
    { event: { type: 'assistant/message', seq: 2 } },
    { event: { type: 'turn/end', seq: 3 } },
  ]), false);
});

test('mergeOlderHistory prepends and dedups by seq', () => {
  const current = [{ event: { seq: 10 } }, { event: { seq: 11 } }];
  const older = [{ event: { seq: 8 } }, { event: { seq: 10 } }, { event: { seq: 9 } }];
  const merged = mergeOlderHistory(older, current);
  assert.deepEqual(merged.map((entry) => entry.event.seq), [8, 9, 10, 11]);
});

test('pendingFromHistoryEvents keeps unanswered approval/asked', () => {
  const pending = pendingFromHistoryEvents([
    { event: { type: 'turn/start', seq: 1 } },
    { event: { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'pwsh', reason: 'outside workspace' } } },
  ], 's1');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].approvalId, 'a1');
  assert.equal(pending[0].sessionId, 's1');
  assert.equal(pending[0].title, 'pwsh');
  assert.equal(pending[0].command, 'outside workspace');
});

test('pendingFromHistoryEvents drops asked after approval/decided', () => {
  const pending = pendingFromHistoryEvents([
    { event: { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'pwsh' } } },
    { event: { type: 'approval/decided', seq: 3, data: { id: 'a1', outcome: 'rejected' } } },
  ]);
  assert.deepEqual(pending, []);
});

test('mergeApprovalPending prefers live mux rpcId over history stubs', () => {
  const fromHistory = pendingFromHistoryEvents([
    { event: { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'pwsh', reason: 'r' } } },
  ], 's1');
  const merged = mergeApprovalPending([
    { rpcId: 'live-rpc', approvalId: 'a1', title: 'pwsh', command: 'r', sessionId: 's1' },
  ], fromHistory);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].rpcId, 'live-rpc');
});
