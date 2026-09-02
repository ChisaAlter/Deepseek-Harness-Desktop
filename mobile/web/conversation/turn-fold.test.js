import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents, groupTurns } from './fold.js';
import { intendedDiff, lineDiff, toolRowModel } from './tool-model.js';

function ev(seq, type, data, extra = {}) {
  return { event: { type, seq, time: seq, data }, ...extra };
}

const user = (seq, text) => ev(seq, 'user/message', {
  id: `u${seq}`, source: { kind: 'user' }, content: [{ type: 'text', text }],
});

test('streamed reasoning and text deltas fold into separate rows in block order', () => {
  const rows = foldEvents([
    ev(1, 'turn/start', { turn: 3 }),
    user(2, '看看这个'),
    ev(3, 'step/start', { turn: 3, step: 0 }),
    ev(4, 'assistant/chunk', { chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } }),
    ev(5, 'assistant/chunk', { chunk: { type: 'reasoning-delta', index: 0, text: '先读' } }),
    ev(6, 'assistant/chunk', { chunk: { type: 'reasoning-delta', index: 0, text: '文件' } }),
    ev(7, 'assistant/chunk', { chunk: { type: 'block-start', index: 1, blockType: 'text' } }),
    ev(8, 'assistant/chunk', { chunk: { type: 'text-delta', index: 1, text: '好的' } }),
  ]);
  assert.deepEqual(rows.map((r) => [r.role, r.text, r.turn, r.running === true]), [
    ['user', '看看这个', null, false],
    ['reasoning', '先读文件', 3, false],
    ['assistant', '好的', 3, true],
  ]);
});

test('assistant/message replaces the streamed partial and reasoning never leaks into the answer', () => {
  const rows = foldEvents([
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'assistant/chunk', { chunk: { type: 'reasoning-delta', index: 0, text: '想一想' } }),
    ev(3, 'assistant/chunk', { chunk: { type: 'text-delta', index: 1, text: '答' } }),
    ev(4, 'assistant/message', {
      message: { content: [{ type: 'reasoning', text: '想一想完整' }, { type: 'text', text: '答案' }] },
    }),
    ev(5, 'turn/end', { turn: 1 }),
  ]);
  assert.deepEqual(rows.map((r) => [r.role, r.text]), [
    ['reasoning', '想一想完整'],
    ['assistant', '答案'],
  ]);
  assert.equal(rows.some((r) => r.running), false);
});

test('tool/call pairs with tool/result; an ended turn marks unanswered calls stopped', () => {
  const rows = foldEvents([
    ev(1, 'turn/start', { turn: 2 }),
    ev(2, 'tool/call', { callId: 'c1', name: 'read', arguments: JSON.stringify({ path: 'C:\\proj\\src\\a.js' }), turn: 2, step: 0 }),
    ev(3, 'tool/result', {
      message: { source: { callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'line1\nline2' }] }] },
    }),
    ev(4, 'tool/call', { callId: 'c2', name: 'bash', arguments: JSON.stringify({ command: 'npm test' }) }),
    ev(5, 'turn/end', { turn: 2 }),
  ]);
  const [read, bash] = rows;
  assert.equal(read.role, 'tool');
  assert.equal(read.call.result.content[0].text, 'line1\nline2');
  const readModel = toolRowModel(read.call, { cwd: 'C:\\proj' });
  assert.equal(readModel.title, '读取');
  assert.equal(readModel.summary, 'src\\a.js');
  assert.equal(readModel.state, 'ok');
  assert.equal(readModel.output, 'line1\nline2');
  const bashModel = toolRowModel(bash.call);
  assert.equal(bashModel.title, 'Bash');
  assert.equal(bashModel.summary, 'npm test');
  assert.equal(bashModel.state, 'stopped');
});

test('error results carry an error summary; interrupted results read as stopped', () => {
  const failed = toolRowModel({
    name: 'grep', argsRaw: JSON.stringify({ pattern: 'TODO' }),
    result: { content: [{ type: 'text', text: 'boom\nmore' }], isError: true },
  });
  assert.equal(failed.state, 'error');
  assert.equal(failed.errorSummary, 'boom');
  assert.equal(failed.title, 'Grep');
  const stopped = toolRowModel({
    name: 'edit', argsRaw: '{}',
    result: { content: [], isError: true, error: { name: 'Interrupted', code: 'interrupted' } },
  });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.output, 'Interrupted: interrupted');
});

test('unknown tools use the generic title with the wire name in the summary', () => {
  const model = toolRowModel({ name: 'mystery_tool', argsRaw: JSON.stringify({ target: 'x' }) });
  assert.equal(model.title, '工具调用');
  assert.equal(model.summary, 'mystery_tool · x');
  assert.equal(model.state, 'running');
});

test('a turn that ends in error folds into a visible failure row (desktop 本轮运行失败 parity)', () => {
  const rows = foldEvents([
    user(1, '看看这个项目吧'),
    ev(2, 'turn/start', { turn: 5 }),
    ev(3, 'turn/end', {
      turn: 5,
      reason: { kind: 'error', error: { message: 'llm-deepseek: no API key for provider route "deepseek-official"', code: 'MISSING_CREDENTIAL' } },
    }),
  ]);
  assert.deepEqual(rows.map((r) => r.role), ['user', 'error']);
  assert.equal(rows[1].title, '本轮运行失败');
  assert.equal(rows[1].code, 'MISSING_CREDENTIAL');
  assert.match(rows[1].text, /no API key/);
  assert.equal(rows[1].turn, 5);
  // The failure row is not "process": grouping leaves it standing on its own.
  assert.deepEqual(groupTurns(rows).map((r) => r.role), ['user', 'error']);
});

test('groupTurns folds a settled turn process before its answer and keeps a running turn inline', () => {
  const settled = groupTurns([
    { id: 'u', role: 'user', text: 'q', turn: null },
    { id: 'r', role: 'reasoning', text: 'think', turn: 1, running: false },
    { id: 't1', role: 'tool', text: 'read', turn: 1, call: { result: {} }, running: false },
    { id: 'a0', role: 'assistant', text: '中间说明', turn: 1, running: false },
    { id: 't2', role: 'tool', text: 'subagent', turn: 1, call: { result: {} }, running: false },
    { id: 'a', role: 'assistant', text: 'final', turn: 1, running: false },
  ]);
  assert.deepEqual(settled.map((r) => r.role), ['user', 'turn-process', 'assistant']);
  assert.equal(settled[1].toolCalls, 1);
  assert.equal(settled[1].subagents, 1);
  assert.equal(settled[1].messages, 1);
  assert.equal(settled[1].rows.length, 4);
  assert.equal(settled[2].text, 'final');

  const live = groupTurns([
    { id: 'u', role: 'user', text: 'q', turn: null },
    { id: 't1', role: 'tool', text: 'read', turn: 1, call: { result: null }, running: true },
    { id: 'a', role: 'assistant', text: 'part', turn: 1, running: true },
  ]);
  assert.deepEqual(live.map((r) => r.role), ['user', 'tool', 'assistant']);
});

test('groupTurns applies a live running flag to the newest turn only', () => {
  const grouped = groupTurns([
    { id: 'u1', role: 'user', text: 'q1', turn: null },
    { id: 't1', role: 'tool', text: 'read', turn: 1, call: { result: {} } },
    { id: 'a1', role: 'assistant', text: 'done', turn: 1 },
    { id: 'u2', role: 'user', text: 'q2', turn: null },
    { id: 't2', role: 'tool', text: 'grep', turn: 2, call: { result: null } },
  ], { running: true });
  assert.deepEqual(grouped.map((r) => r.role), ['user', 'turn-process', 'assistant', 'user', 'tool']);
});

test('groupTurns leaves reasoning-only process inline', () => {
  const grouped = groupTurns([
    { id: 'r', role: 'reasoning', text: 'think', turn: 4, running: false },
    { id: 'a', role: 'assistant', text: 'ans', turn: 4, running: false },
  ]);
  assert.deepEqual(grouped.map((r) => r.role), ['reasoning', 'assistant']);
});

test('intendedDiff and lineDiff describe an edit as removed / added lines', () => {
  const diff = intendedDiff('edit', JSON.stringify({ file_path: 'a.js', old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' }));
  assert.deepEqual(diff, { path: 'a.js', oldText: 'a\nb\nc', newText: 'a\nB\nc\nd' });
  assert.deepEqual(lineDiff(diff.oldText, diff.newText), [
    { kind: 'same', text: 'a' },
    { kind: 'del', text: 'b' },
    { kind: 'add', text: 'B' },
    { kind: 'same', text: 'c' },
    { kind: 'add', text: 'd' },
  ]);
  assert.deepEqual(intendedDiff('write', JSON.stringify({ path: 'n.txt', content: 'x' })), { path: 'n.txt', oldText: null, newText: 'x' });
  assert.equal(intendedDiff('read', '{}'), null);
});
