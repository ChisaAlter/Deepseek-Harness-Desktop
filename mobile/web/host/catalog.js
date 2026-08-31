import { isUntitledBlank } from '../conversation/title.js';

function sessionItems(sessions) {
  if (Array.isArray(sessions?.items)) return sessions.items;
  if (Array.isArray(sessions)) return sessions;
  return [];
}

function archivedSet(workspaces) {
  const ids = workspaces?.archivedSessionIds;
  return new Set(Array.isArray(ids) ? ids : []);
}

function archivedIdList(workspaces) {
  return Array.isArray(workspaces?.archivedSessionIds) ? workspaces.archivedSessionIds : [];
}

function workspaceIndex(workspaces) {
  const items = Array.isArray(workspaces?.items) ? workspaces.items : [];
  const bySession = new Map();
  for (const workspace of items) {
    for (const sessionId of workspace.sessionIds || []) {
      bySession.set(sessionId, workspace);
    }
  }
  return { items, bySession };
}

function toRow(session, workspace, archived) {
  const sessionId = session.sessionId;
  const path = typeof workspace?.path === 'string' ? workspace.path : '';
  return {
    sessionId,
    cwd: typeof session.cwd === 'string' && session.cwd ? session.cwd : path,
    running: session.running === true,
    parentSessionId: typeof session.parentSessionId === 'string' ? session.parentSessionId : '',
    origin: typeof session.origin === 'string' ? session.origin : '',
    workspaceId: workspace?.workspaceId || '',
    workspaceTitle: workspace?.title || '',
    workspacePath: path,
    projections: session.projections && typeof session.projections === 'object'
      ? session.projections
      : { values: {} },
    archived: archived === true,
    blank: isUntitledBlank(session),
  };
}

function missingArchivedRow(sessionId) {
  return {
    sessionId,
    cwd: '',
    running: false,
    parentSessionId: '',
    origin: '',
    workspaceId: '',
    workspaceTitle: '',
    workspacePath: '',
    projections: { values: { title: '缺失会话' } },
    archived: true,
    blank: false,
  };
}

function liveSessionRows({ sessions, workspaces }) {
  const archived = archivedSet(workspaces);
  const { bySession } = workspaceIndex(workspaces);
  return sessionItems(sessions).flatMap((session) => {
    const sessionId = session?.sessionId;
    if (!sessionId) return [];
    if (isUntitledBlank(session)) return [];
    if (session.origin === 'dshbot') return [];
    if (archived.has(sessionId)) return [];
    return [toRow(session, bySession.get(sessionId), false)];
  });
}

function archivedSessionRows({ sessions, workspaces }) {
  const { bySession } = workspaceIndex(workspaces);
  const byId = new Map();
  for (const session of sessionItems(sessions)) {
    if (session?.sessionId) byId.set(session.sessionId, session);
  }
  return archivedIdList(workspaces).flatMap((sessionId) => {
    if (!sessionId) return [];
    const session = byId.get(sessionId);
    if (session?.origin === 'dshbot') return [];
    if (!session) return [missingArchivedRow(sessionId)];
    return [toRow(session, bySession.get(sessionId), true)];
  });
}

function workspaceDrawerSections(liveRows, workspaces) {
  const items = Array.isArray(workspaces?.items) ? workspaces.items : [];
  const rows = Array.isArray(liveRows) ? liveRows : [];
  const used = new Set();
  const sections = items.map((workspace) => {
    const ids = new Set(workspace.sessionIds || []);
    const grouped = rows.filter((row) => ids.has(row.sessionId));
    for (const row of grouped) used.add(row.sessionId);
    return { workspace, rows: grouped };
  });
  return {
    sections,
    ungrouped: rows.filter((row) => !used.has(row.sessionId)),
  };
}

function workspaceChoices(workspaces, hostDescribe = {}) {
  const items = Array.isArray(workspaces?.items) ? workspaces.items : [];
  const choices = items.map((workspace) => ({
    id: workspace.workspaceId,
    name: workspace.title || workspace.path || workspace.workspaceId,
    cwd: workspace.path || '',
  }));
  return {
    choices,
    home: typeof hostDescribe.home === 'string' ? hostDescribe.home : '',
    scratchCwd: typeof hostDescribe.scratchCwd === 'string' ? hostDescribe.scratchCwd : '',
    noFolder: { id: '', name: '无工作区文件夹', cwd: '' },
  };
}

function heldSessionRow({ sessions, workspaces, sessionId }) {
  if (!sessionId) return null;
  const archived = archivedSet(workspaces);
  if (archived.has(sessionId)) return null;
  const session = sessionItems(sessions).find((item) => item?.sessionId === sessionId);
  if (!session || session.origin === 'dshbot') return null;
  const { bySession } = workspaceIndex(workspaces);
  return toRow(session, bySession.get(sessionId), false);
}

function withHeldLiveRow(liveRows, held) {
  const rows = Array.isArray(liveRows) ? liveRows : [];
  if (!held || held.blank === true) return rows;
  if (rows.some((row) => row.sessionId === held.sessionId)) return rows;
  return [held, ...rows];
}

function workspaceIdFromCreate(value) {
  const nested = value && typeof value === 'object' && value.workspace && typeof value.workspace === 'object'
    ? value.workspace
    : value;
  if (!nested || typeof nested !== 'object') return '';
  if (typeof nested.workspaceId === 'string' && nested.workspaceId) return nested.workspaceId;
  return typeof nested.id === 'string' && nested.id ? nested.id : '';
}

export {
  archivedSessionRows,
  heldSessionRow,
  liveSessionRows,
  withHeldLiveRow,
  workspaceChoices,
  workspaceDrawerSections,
  workspaceIdFromCreate,
};
