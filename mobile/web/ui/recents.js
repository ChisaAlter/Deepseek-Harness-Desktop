import { isUntitledBlank } from '../conversation/title.js';
import { isSubagentRow } from '../chisacode/directory.js';

/**
 * Drawer「最近」rows: the same visible live top-level rows renderSessions
 * shows — no archived, no untitled blank, no dshbot, no subagents. Sorted by
 * the row's most-recent-activity timestamp when session.list carries one;
 * otherwise the list order is kept.
 */
export function recentSessionRows(rows, { limit = 8 } = {}) {
  const visible = (Array.isArray(rows) ? rows : []).filter((row) => (
    row?.sessionId
    && row.archived !== true
    && !isUntitledBlank(row)
    && row.origin !== 'dshbot'
    && !isSubagentRow(row)
  ));
  const activityOf = (row) => Date.parse(row?.lastActivityAt || row?.updatedAt || '') || 0;
  const sorted = visible.some((row) => activityOf(row) > 0)
    ? [...visible].sort((a, b) => activityOf(b) - activityOf(a))
    : visible;
  return sorted.slice(0, limit);
}
