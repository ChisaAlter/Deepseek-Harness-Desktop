import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverApprovalRespond, isHostRpcTimeout } from './approval-respond.js';

const pending = {
  rpcId: 'rpc-1',
  sessionId: 's1',
  approvalId: 'appr-1',
};

const asked = {
  event: { type: 'approval/asked', data: { id: 'appr-1', toolName: 'Write' } },
};

const decided = {
  event: { type: 'approval/decided', data: { id: 'appr-1' } },
};

test('isHostRpcTimeout matches the daemon hostRpc ceiling', () => {
  assert.equal(isHostRpcTimeout(new Error('Timeout waiting for message (30000ms)')), true);
  assert.equal(isHostRpcTimeout(new Error('电脑没有响应')), false);
});

test('deliverApprovalRespond returns ok when hostRpc resolves', async () => {
  let probed = false;
  const result = await deliverApprovalRespond({
    hostCall: async () => ({ ok: true }),
    client: {},
    pending,
    outcome: 'allowed-once',
    loadHistory: async () => {
      probed = true;
      return { events: [] };
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(probed, false);
});

test('timeout after host already decided is success', async () => {
  const result = await deliverApprovalRespond({
    hostCall: async () => {
      throw new Error('Timeout waiting for message (30000ms)');
    },
    client: {},
    pending,
    outcome: 'rejected',
    loadHistory: async () => ({ events: [asked, decided] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ackMissing, true);
});

test('timeout while approval is still asked is failure', async () => {
  const timeout = new Error('Timeout waiting for message (30000ms)');
  const result = await deliverApprovalRespond({
    hostCall: async () => {
      throw timeout;
    },
    client: {},
    pending,
    outcome: 'allowed-once',
    loadHistory: async () => ({ events: [asked] }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, timeout);
});

test('non-timeout errors stay failures', async () => {
  const err = new Error('桌面端未启动');
  const result = await deliverApprovalRespond({
    hostCall: async () => {
      throw err;
    },
    client: {},
    pending,
    outcome: 'allowed-once',
    loadHistory: async () => ({ events: [asked, decided] }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, err);
});
