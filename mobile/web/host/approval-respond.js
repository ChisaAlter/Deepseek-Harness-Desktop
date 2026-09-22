import { pendingFromHistoryEvents } from './history.js';

function isHostRpcTimeout(error) {
  return /Timeout waiting for message/i.test(String(error?.message || error || ''));
}

function historyEventsOf(payload) {
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload)) return payload;
  return [];
}

function stillPending(events, pending) {
  return pendingFromHistoryEvents(events, pending.sessionId).some(
    (item) => item.approvalId === pending.approvalId || (pending.rpcId && item.rpcId === pending.rpcId),
  );
}

async function deliverApprovalRespond({ hostCall, client, pending, outcome, loadHistory }) {
  const body = {
    rpcId: pending.rpcId,
    value: {
      sessionId: pending.sessionId,
      approvalId: pending.approvalId,
      outcome,
    },
  };
  try {
    await hostCall(client, 'respond', body);
    return { ok: true };
  } catch (error) {
    if (!isHostRpcTimeout(error) || typeof loadHistory !== 'function') {
      return { ok: false, error };
    }
    try {
      const payload = await loadHistory(pending.sessionId);
      if (!stillPending(historyEventsOf(payload), pending)) {
        return { ok: true, ackMissing: true };
      }
    } catch {
      // Keep the original timeout when history cannot be probed.
    }
    return { ok: false, error };
  }
}

export { deliverApprovalRespond, isHostRpcTimeout };
