function muxPayload(frame) {
  const envelope = frame?.envelope;
  const nested = envelope?.payload && typeof envelope.payload === 'object'
    ? envelope.payload
    : envelope;
  const rpcId = typeof frame?.rpcId === 'string' && frame.rpcId
    ? frame.rpcId
    : (typeof envelope?.rpcId === 'string' ? envelope.rpcId : '');
  return { rpcId, payload: nested && typeof nested === 'object' ? nested : null };
}

function approvalFromMux(frame) {
  const { rpcId, payload } = muxPayload(frame);
  if (!rpcId || payload?.type !== 'approval/requested') return null;
  return {
    rpcId,
    sessionId: payload.sessionId || '',
    approvalId: payload.approvalId || '',
    title: payload.toolName || '需要审批',
    command: payload.reason || '',
    actions: [
      { id: 'rejected', label: '拒绝', variant: 'ghost', outcome: 'rejected' },
      { id: 'allowed-once', label: '允许一次', variant: 'primary', outcome: 'allowed-once' },
    ],
    host: true,
  };
}

function approvalResolvedId(frame) {
  const { payload } = muxPayload(frame);
  if (payload?.type !== 'approval/resolved') return '';
  return typeof payload.approvalId === 'string' ? payload.approvalId : '';
}

function runningFromMux(frame) {
  const { payload } = muxPayload(frame);
  if (payload?.type !== 'host/session-status' && payload?.type !== 'session/running') return null;
  if (typeof payload.running !== 'boolean') return null;
  return payload.running;
}

function muxEventShouldApply(payload) {
  if (!payload || payload.type !== 'session/event') return false;
  return payload.event?.type !== 'assistant/chunk';
}

export { approvalFromMux, approvalResolvedId, muxEventShouldApply, muxPayload, runningFromMux };
