import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
} from './directory.js';

function row(id, agent = {}) {
  return { sessionId: id, chisacodeAgent: { id, ...agent } };
}

test('agentPageInfo reads pageInfo and degrades to no-more without it', () => {
  assert.deepEqual(
    agentPageInfo({ pageInfo: { nextCursor: 'c1', hasMore: true } }),
    { nextCursor: 'c1', hasMore: true },
  );
  // hasMore without a cursor is unusable — treat as done, not an infinite spinner.
  assert.deepEqual(
    agentPageInfo({ pageInfo: { nextCursor: null, hasMore: true } }),
    { nextCursor: null, hasMore: false },
  );
  assert.deepEqual(agentPageInfo({}), { nextCursor: null, hasMore: false });
  assert.deepEqual(agentPageInfo(undefined), { nextCursor: null, hasMore: false });
});

test('mergeAgentRows appends new rows and lets the daemon copy win on repeats', () => {
  const existing = [row('a', { title: 'old' }), row('b')];
  const incoming = [row('a', { title: 'new' }), row('c')];
  const merged = mergeAgentRows(existing, incoming);
  assert.deepEqual(merged.map((item) => item.sessionId), ['a', 'b', 'c']);
  assert.equal(merged[0].chisacodeAgent.title, 'new');
  // The input arrays are not mutated.
  assert.equal(existing[0].chisacodeAgent.title, 'old');
});

test('groupSessionRows folds subagents under a loaded parent', () => {
  const parent = row('p1');
  const child = row('s1', { relation: { kind: 'subagent', parentAgentId: 'p1' } });
  const solo = row('x1');
  const groups = groupSessionRows([parent, solo, child]);
  assert.deepEqual(groups.map((group) => group.row.sessionId), ['p1', 'x1']);
  assert.deepEqual(groups[0].children.map((item) => item.sessionId), ['s1']);
  assert.equal(groups[0].orphanSubagent, false);
});

test('groupSessionRows keeps orphan subagents visible at top level with a flag', () => {
  const orphan = row('s9', { relation: { kind: 'subagent', parentAgentId: 'missing' } });
  const groups = groupSessionRows([orphan]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].row.sessionId, 's9');
  assert.equal(groups[0].orphanSubagent, true);
});

test('groupSessionRows leaves non-subagent relations top-level', () => {
  const parent = row('p1');
  const handoff = row('h1', { relation: { kind: 'handoff', parentAgentId: 'p1' } });
  const groups = groupSessionRows([parent, handoff]);
  assert.deepEqual(groups.map((group) => group.row.sessionId), ['p1', 'h1']);
  assert.deepEqual(groups[0].children, []);
});

test('groupSessionRows folds host parentSessionId under the parent', () => {
  const groups = groupSessionRows([
    { sessionId: 'live-1' },
    { sessionId: 'child-1', parentSessionId: 'live-1', origin: 'subagent' },
  ]);
  assert.equal(groups[0].row.sessionId, 'live-1');
  assert.equal(groups[0].children[0].sessionId, 'child-1');
});

test('sessionRowForest keeps grandchild subagents instead of dropping them', () => {
  const forest = sessionRowForest([
    { sessionId: 'root', projections: { values: { title: '糖果最少取数保证匹配' } } },
    { sessionId: 'mid', parentSessionId: 'root', projections: { values: { title: '不使用任何外部工具回答以下' } } },
    { sessionId: 'leaf', parentSessionId: 'mid', projections: { values: { title: '最少取糖保证苹果桃子' } } },
  ]);
  assert.equal(forest.length, 1);
  assert.equal(forest[0].row.sessionId, 'root');
  assert.equal(forest[0].children.length, 1);
  assert.equal(forest[0].children[0].row.sessionId, 'mid');
  assert.deepEqual(forest[0].children[0].children.map((node) => node.row.sessionId), ['leaf']);
});

test('isReadOnlyRow marks host subagents and archived rows', () => {
  assert.equal(isReadOnlyRow({ sessionId: 'a', origin: 'subagent', parentSessionId: 'p' }), true);
  assert.equal(isReadOnlyRow({ sessionId: 'a', archived: true }), true);
});

test('isReadOnlyRow marks subagents and archived agents read-only', () => {
  assert.equal(isReadOnlyRow(row('a')), false);
  assert.equal(isReadOnlyRow(row('a', { relation: { kind: 'subagent', parentAgentId: 'p' } })), true);
  assert.equal(isReadOnlyRow(row('a', { archivedAt: '2026-08-27T00:00:00Z' })), true);
  assert.equal(isReadOnlyRow({ sessionId: 'legacy' }), false);
});

test('listArchivedAgents asks for archived history and keeps only archived rows', async () => {
  const calls = [];
  const client = {
    async fetchAgentHistory(options) {
      calls.push(options);
      return {
        entries: [
          { agent: { id: 'a1', title: '归档的', archivedAt: '2026-08-26T00:00:00Z' } },
          { agent: { id: 'a2', title: '活跃的' } },
        ],
        pageInfo: { nextCursor: 'c2', hasMore: true },
      };
    },
  };
  const result = await listArchivedAgents(client, { cursor: 'c1', limit: 10 });
  assert.deepEqual(calls, [{
    sort: [{ key: 'updated_at', direction: 'desc' }],
    filter: { includeArchived: true },
    page: { limit: 10, cursor: 'c1' },
  }]);
  assert.deepEqual(result.rows.map((item) => item.sessionId), ['a1']);
  assert.equal(result.nextCursor, 'c2');
  assert.equal(result.hasMore, true);
});

test('listArchivedAgents first page sends no cursor', async () => {
  const calls = [];
  const client = {
    async fetchAgentHistory(options) {
      calls.push(options);
      return { entries: [] };
    },
  };
  await listArchivedAgents(client);
  assert.deepEqual(calls[0].page, { limit: 50 });
});

test('lifecycle actions forward to the daemon and propagate errors', async () => {
  const calls = [];
  const client = {
    async archiveAgent(id) { calls.push(['archive', id]); },
    async deleteAgent(id) { calls.push(['delete', id]); },
    async updateAgent(id, patch) { calls.push(['update', id, patch]); },
    async refreshAgent(id) { calls.push(['refresh', id]); },
  };
  await archiveMobileAgent(client, 'a1');
  await deleteMobileAgent(client, 'a1');
  await renameMobileAgent(client, 'a1', '  新名字  ');
  await regenerateMobileTitle(client, 'a1');
  await unarchiveMobileAgent(client, 'a1');
  assert.deepEqual(calls, [
    ['archive', 'a1'],
    ['delete', 'a1'],
    ['update', 'a1', { name: '新名字' }],
    ['update', 'a1', { regenerateTitle: true }],
    ['refresh', 'a1'],
  ]);

  const failing = {
    async deleteAgent() { throw new Error('daemon 拒绝'); },
  };
  await assert.rejects(() => deleteMobileAgent(failing, 'a1'), /daemon 拒绝/);
});

test('lifecycle actions reject missing agent ids and empty names locally', async () => {
  await assert.rejects(() => archiveMobileAgent({}, ''), /缺少会话 ID/);
  await assert.rejects(() => renameMobileAgent({}, 'a1', '   '), /会话名称不能为空/);
});
