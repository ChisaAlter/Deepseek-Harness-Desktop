function titleFromProjection(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof value.title === 'string' && value.title.trim()) {
    return value.title.trim();
  }
  return '';
}

function muxPatch(frame, sessionId) {
  const payload = frame?.payload;
  if (!payload || payload.sessionId !== sessionId) return null;
  if (payload.type === 'session/event') {
    return { type: 'event', entry: { event: payload.event, view: payload.view } };
  }
  if (payload.type === 'approval/requested') {
    return {
      type: 'approval',
      pending: {
        rpcId: frame.rpcId,
        sessionId: payload.sessionId,
        approvalId: payload.approvalId,
        title: payload.toolName || '需要审批',
        command: payload.reason || '',
        outcomeNeeded: true,
      },
    };
  }
  if (payload.type === 'approval/resolved') {
    return { type: 'approval-clear' };
  }
  if (payload.type === 'session/projection' && payload.key === 'title') {
    const value = titleFromProjection(payload.value);
    return value ? { type: 'title', value } : null;
  }
  return null;
}

export { muxPatch, titleFromProjection };
