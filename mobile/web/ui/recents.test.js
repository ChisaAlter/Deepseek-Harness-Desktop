import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSessionRows } from './recents.js';

const row = (sessionId, extra = {}) => ({
  sessionId, title: sessionId, projections: { values: {} }, ...extra,
});

test('recents keep only live titled top-level sessions, capped at 8', () => {
  const rows = [
    row('a'), row('blank', { blank: true }), row('archived', { archived: true }),
    row('bot', { origin: 'dshbot' }), row('sub', { origin: 'subagent' }),
    ...Array.from({ length: 10 }, (_, i) => row(`s${i}`)),
  ];
  const picked = recentSessionRows(rows);
  assert.deepEqual(picked.map((r) => r.sessionId), ['a', 's0', 's1', 's2', 's3', 's4', 's5', 's6']);
});

test('recents sort by the most-recent-activity timestamp when rows carry one', () => {
  const rows = [
    row('old', { updatedAt: '2026-01-01T00:00:00Z' }),
    row('new', { lastActivityAt: '2026-09-20T00:00:00Z' }),
    row('mid', { updatedAt: '2026-06-01T00:00:00Z' }),
  ];
  assert.deepEqual(
    recentSessionRows(rows).map((r) => r.sessionId),
    ['new', 'mid', 'old'],
  );
});

test('recents keep list order when no row carries an activity timestamp', () => {
  const rows = [row('x'), row('y'), row('z')];
  assert.deepEqual(recentSessionRows(rows).map((r) => r.sessionId), ['x', 'y', 'z']);
});

test('recents tolerate non-array input', () => {
  assert.deepEqual(recentSessionRows(undefined), []);
  assert.deepEqual(recentSessionRows(null), []);
});
