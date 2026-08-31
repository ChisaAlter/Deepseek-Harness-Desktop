/**
 * ChisaCode agent directory adapters: cursor pagination, subagent grouping,
 * archived history, and session lifecycle actions (archive / delete / rename /
 * regenerate title / unarchive). Pure logic over an injected DaemonClient so
 * app.js stays a thin UI binder. All daemon errors propagate to the caller —
 * no optimistic destruction on failure.
 */

import { agentRows } from './session.js';

/**
 * Extract cursor paging state from a fetch_agents / fetch_agent_history
 * response payload. Missing pageInfo (older daemons) degrades to "no more".
 * @param {{ pageInfo?: { nextCursor?: string | null, hasMore?: boolean } }} payload
 * @returns {{ nextCursor: string | null, hasMore: boolean }}
 */
function agentPageInfo(payload) {
  const info = payload?.pageInfo;
  const nextCursor = typeof info?.nextCursor === 'string' && info.nextCursor ? info.nextCursor : null;
  return {
    nextCursor,
    hasMore: info?.hasMore === true && nextCursor !== null,
  };
}

/**
 * Merge a newly fetched page into the existing rows: rows already present are
 * updated in place (daemon copy wins), new rows are appended in page order.
 * @param {Array<{ sessionId: string }>} existing
 * @param {Array<{ sessionId: string }>} incoming
 */
function mergeAgentRows(existing, incoming) {
  const merged = existing.slice();
  const indexById = new Map(merged.map((row, index) => [row.sessionId, index]));
  for (const row of incoming || []) {
    if (!row?.sessionId) continue;
    const index = indexById.get(row.sessionId);
    if (index === undefined) {
      indexById.set(row.sessionId, merged.length);
      merged.push(row);
    } else {
      merged[index] = row;
    }
  }
  return merged;
}

function relationOf(row) {
  const relation = row?.chisacodeAgent?.relation;
  return relation && typeof relation === 'object' ? relation : null;
}

function parentSessionIdOf(row) {
  const relation = relationOf(row);
  if (relation?.kind === 'subagent' && typeof relation.parentAgentId === 'string') {
    return relation.parentAgentId;
  }
  if (typeof row?.parentSessionId === 'string' && row.parentSessionId) {
    return row.parentSessionId;
  }
  return '';
}

/**
 * Group directory rows for the drawer: subagents fold under their direct
 * parent when the parent is loaded; subagents whose parent is not in the
 * loaded set stay top-level flagged `orphanSubagent`. Other relation kinds
 * (detached / handoff / team-slot) intentionally stay top-level.
 * @param {Array<object>} rows
 * @returns {Array<{ row: object, children: Array<object>, orphanSubagent: boolean }>}
 */
function groupSessionRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Set(list.map((row) => row.sessionId));
  const childrenByParent = new Map();
  const top = [];
  for (const row of list) {
    const parentId = parentSessionIdOf(row);
    if (parentId && byId.has(parentId) && parentId !== row.sessionId) {
      const bucket = childrenByParent.get(parentId) || [];
      bucket.push(row);
      childrenByParent.set(parentId, bucket);
      continue;
    }
    top.push({ row, orphanSubagent: Boolean(parentId) });
  }
  return top.map(({ row, orphanSubagent }) => ({
    row,
    children: childrenByParent.get(row.sessionId) || [],
    orphanSubagent,
  }));
}

function sessionRowForest(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = groupSessionRows(list);
  function descendants(parentId) {
    return list.filter((row) => (
      parentSessionIdOf(row) === parentId && row.sessionId !== parentId
    ));
  }
  function expand(row, orphanSubagent, seen) {
    if (seen.has(row.sessionId)) {
      return { row, children: [], orphanSubagent };
    }
    const next = new Set(seen);
    next.add(row.sessionId);
    return {
      row,
      orphanSubagent,
      children: descendants(row.sessionId).map((child) => expand(child, false, next)),
    };
  }
  return groups.map((group) => expand(group.row, group.orphanSubagent, new Set()));
}

/** True when this row must open read-only (subagent track or archived). */
function isReadOnlyRow(row) {
  if (row?.archived === true) return true;
  if (row?.origin === 'subagent' || parentSessionIdOf(row)) return true;
  const agent = row?.chisacodeAgent;
  if (!agent) return false;
  if (relationOf(row)?.kind === 'subagent') return true;
  return typeof agent.archivedAt === 'string' && agent.archivedAt.length > 0;
}

/**
 * List archived / historical agents, most recently updated first.
 * Mirrors the official app: sort updated_at desc + includeArchived.
 * @param {object} client DaemonClient
 * @param {{ cursor?: string | null, limit?: number }} options
 * @returns {Promise<{ rows: Array<object>, nextCursor: string | null, hasMore: boolean }>}
 */
async function listArchivedAgents(client, { cursor = null, limit = 50 } = {}) {
  const payload = await client.fetchAgentHistory({
    sort: [{ key: 'updated_at', direction: 'desc' }],
    filter: { includeArchived: true },
    page: cursor ? { limit, cursor } : { limit },
  });
  const rows = agentRows(payload).filter(
    (row) => typeof row.chisacodeAgent?.archivedAt === 'string' && row.chisacodeAgent.archivedAt,
  );
  const page = agentPageInfo(payload);
  return { rows, nextCursor: page.nextCursor, hasMore: page.hasMore };
}

function requireAgentId(agentId) {
  if (typeof agentId !== 'string' || !agentId) {
    throw new Error('缺少会话 ID');
  }
  return agentId;
}

/** Archive one agent. Daemon cascades to subagents; errors propagate. */
async function archiveMobileAgent(client, agentId) {
  return client.archiveAgent(requireAgentId(agentId));
}

/** Permanently delete one agent. Caller must have confirmed with the user. */
async function deleteMobileAgent(client, agentId) {
  return client.deleteAgent(requireAgentId(agentId));
}

/** Rename one agent. Empty names are rejected locally before hitting the daemon. */
async function renameMobileAgent(client, agentId, name) {
  requireAgentId(agentId);
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new Error('会话名称不能为空');
  }
  return client.updateAgent(agentId, { name: trimmed });
}

/** Ask the daemon to regenerate the title from the first user message. */
async function regenerateMobileTitle(client, agentId) {
  return client.updateAgent(requireAgentId(agentId), { regenerateTitle: true });
}

/**
 * Unarchive one agent. Same path as the official ChisaCode app's 取消归档
 * button: refresh_agent_request clears archivedAt server-side and reloads the
 * session from persistence. This is NOT dsh unarchive and NOT
 * resumeAgent(handle) — do not relabel it as「恢复」.
 */
async function unarchiveMobileAgent(client, agentId) {
  return client.refreshAgent(requireAgentId(agentId));
}

export {
  agentPageInfo,
  archiveMobileAgent,
  deleteMobileAgent,
  groupSessionRows,
  isReadOnlyRow,
  listArchivedAgents,
  mergeAgentRows,
  regenerateMobileTitle,
  renameMobileAgent,
  sessionRowForest,
  unarchiveMobileAgent,
};
