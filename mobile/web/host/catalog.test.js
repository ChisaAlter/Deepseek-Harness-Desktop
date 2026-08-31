import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archivedSessionRows,
  heldSessionRow,
  liveSessionRows,
  withHeldLiveRow,
  workspaceChoices,
  workspaceDrawerSections,
  workspaceIdFromCreate,
} from './catalog.js';

const sessions = {
  items: [
    {
      sessionId: 'live-1',
      blank: false,
      running: true,
      cwd: 'C:\\proj',
      projections: { values: { title: '正在做的事' } },
    },
    { sessionId: 'blank-1', blank: true, running: false },
    { sessionId: 'bot-1', blank: false, origin: 'dshbot', projections: { values: { title: 'bot' } } },
    {
      sessionId: 'arch-1',
      blank: false,
      projections: { values: { title: '旧会话' } },
    },
    {
      sessionId: 'child-1',
      blank: false,
      parentSessionId: 'live-1',
      origin: 'subagent',
      projections: { values: { title: '子任务' } },
    },
  ],
};

const workspaces = {
  items: [
    {
      workspaceId: 'ws-1',
      title: 'proj',
      path: 'C:\\proj',
      sessionIds: ['live-1', 'blank-1', 'arch-1', 'child-1'],
    },
  ],
  archivedSessionIds: ['arch-1'],
};

test('liveSessionRows hides blank, dshbot, and archived sessions', () => {
  const rows = liveSessionRows({ sessions, workspaces });
  assert.deepEqual(rows.map((row) => row.sessionId).sort(), ['child-1', 'live-1']);
  const live = rows.find((row) => row.sessionId === 'live-1');
  assert.equal(live.workspaceId, 'ws-1');
  assert.equal(live.cwd, 'C:\\proj');
  assert.equal(live.running, true);
});

test('archivedSessionRows only returns archived ids', () => {
  const rows = archivedSessionRows({ sessions, workspaces });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 'arch-1');
  assert.equal(rows[0].archived, true);
});

test('workspaceDrawerSections groups live rows under workspace.list order', () => {
  const live = liveSessionRows({ sessions, workspaces });
  const { sections, ungrouped } = workspaceDrawerSections(live, workspaces);
  assert.equal(sections[0].workspace.workspaceId, 'ws-1');
  assert.deepEqual(sections[0].rows.map((row) => row.sessionId).sort(), ['child-1', 'live-1']);
  assert.deepEqual(ungrouped, []);
});

test('heldSessionRow keeps the open blank session that liveSessionRows hides', () => {
  const held = heldSessionRow({ sessions, workspaces, sessionId: 'blank-1' });
  assert.equal(held.sessionId, 'blank-1');
  assert.equal(held.blank, true);
  assert.equal(held.workspaceId, 'ws-1');
  assert.equal(heldSessionRow({ sessions, workspaces, sessionId: 'bot-1' }), null);
  assert.equal(heldSessionRow({ sessions, workspaces, sessionId: 'arch-1' }), null);
  assert.equal(heldSessionRow({ sessions, workspaces, sessionId: '' }), null);
});

test('withHeldLiveRow only inserts a non-blank held session', () => {
  const live = liveSessionRows({ sessions, workspaces });
  const blankHeld = heldSessionRow({ sessions, workspaces, sessionId: 'blank-1' });
  assert.deepEqual(withHeldLiveRow(live, blankHeld).map((row) => row.sessionId).sort(), live.map((row) => row.sessionId).sort());
  const promoted = { ...blankHeld, blank: false, projections: { values: { title: '连接完成并给出验证码' } } };
  const next = withHeldLiveRow(live, promoted);
  assert.equal(next.some((row) => row.sessionId === 'blank-1'), true);
  assert.equal(next.find((row) => row.sessionId === 'blank-1').blank, false);
});

test('workspaceIdFromCreate reads harness workspace.create nested view', () => {
  assert.equal(
    workspaceIdFromCreate({
      workspace: { workspaceId: '8b5c28dd-d551-42e0-8f65-35171c62c43e', path: 'C:\\tmp' },
      created: true,
    }),
    '8b5c28dd-d551-42e0-8f65-35171c62c43e',
  );
  assert.equal(workspaceIdFromCreate({ workspaceId: 'flat-id' }), 'flat-id');
  assert.equal(workspaceIdFromCreate({ workspace: { id: 'legacy' } }), 'legacy');
  assert.equal(workspaceIdFromCreate({ created: false }), '');
  assert.equal(workspaceIdFromCreate(null), '');
});

test('workspaceChoices maps host workspace.list plus no-folder sentinel', () => {
  const { choices, noFolder } = workspaceChoices(workspaces, { home: 'C:\\Users\\t', scratchCwd: 'C:\\dsh\\none' });
  assert.equal(choices[0].id, 'ws-1');
  assert.equal(choices[0].cwd, 'C:\\proj');
  assert.equal(noFolder.id, '');
  assert.equal(noFolder.cwd, '');
});
