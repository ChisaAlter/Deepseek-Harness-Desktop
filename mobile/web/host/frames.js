function hostLabel(host) {
  const cwd = String(host?.cwd || '').trim().replace(/[\\/]+$/, '');
  if (!cwd) return '已连接';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || cwd;
}

function applyHostFrame(sessions, payload) {
  const rows = Array.isArray(sessions) ? sessions.slice() : [];
  if (!payload || typeof payload !== 'object') return rows;
  if (payload.type === 'host/session-added') {
    const sessionId = payload.sessionId;
    if (!sessionId || rows.some((row) => row.sessionId === sessionId)) return rows;
    const { type: _type, ...summary } = payload;
    rows.unshift({
      ...summary,
      sessionId,
      blank: payload.blank === true,
      running: payload.running === true,
      cwd: payload.cwd,
      origin: payload.origin,
      projections: summary.projections && typeof summary.projections === 'object' ? summary.projections : { values: {} },
    });
    return rows;
  }
  if (payload.type === 'host/session-removed') {
    return rows.filter((row) => row.sessionId !== payload.sessionId);
  }
  if (payload.type === 'host/session-status') {
    return rows.map((row) => (
      row.sessionId === payload.sessionId
        ? { ...row, running: payload.running === true }
        : row
    ));
  }
  // Desktop-side sessions are announced blank; the title projection (or the
  // first turn) is what makes them a real drawer row — for *any* session, not
  // only the one open on the phone (DEF-SYNC-REVERSE).
  if (payload.type === 'session/projection' && payload.key === 'title') {
    const title = projectionTitle(payload.value);
    return rows.map((row) => {
      if (row.sessionId !== payload.sessionId) return row;
      const projections = row.projections && typeof row.projections === 'object' ? row.projections : {};
      const values = projections.values && typeof projections.values === 'object' ? projections.values : {};
      return {
        ...row,
        blank: false,
        projections: { ...projections, values: { ...values, ...(title ? { title } : {}) } },
      };
    });
  }
  if (payload.type === 'session/projection' && payload.key === 'sessionListMetadata') {
    const blank = payload.value && typeof payload.value === 'object' && typeof payload.value.blank === 'boolean'
      ? payload.value.blank
      : null;
    if (blank === null) return rows;
    return rows.map((row) => (row.sessionId === payload.sessionId ? { ...row, blank } : row));
  }
  if (payload.type === 'session/event' && payload.event && payload.event.type === 'turn/start') {
    return rows.map((row) => (
      row.sessionId === payload.sessionId
        ? { ...row, blank: false, running: true }
        : row
    ));
  }
  return rows;
}

/**
 * A title / list-metadata projection for a session the drawer does not hold
 * means the host has a row we filtered out (blank) or never saw: refetch.
 */
function hostFrameNeedsCatalogRefresh(rows, payload) {
  if (!payload || payload.type !== 'session/projection') return false;
  if (payload.key !== 'title' && payload.key !== 'sessionListMetadata') return false;
  const list = Array.isArray(rows) ? rows : [];
  return !list.some((row) => row && row.sessionId === payload.sessionId);
}

function projectionTitle(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.title === 'string') return value.title.trim();
  return '';
}

export { applyHostFrame, hostFrameNeedsCatalogRefresh, hostLabel };
