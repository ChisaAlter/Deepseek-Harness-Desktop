const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createTrace2Monitor, parseTrace2Line, trace2ChildKey } = require('./git-trace2.js');

test('trace2ChildKey prefers child_id then hook_name', () => {
  assert.equal(trace2ChildKey({ child_id: 3 }), '3');
  assert.equal(trace2ChildKey({ hook_name: 'pre-commit' }), 'pre-commit');
  assert.equal(trace2ChildKey({}), null);
});

test('parseTrace2Line ignores non-JSON', () => {
  assert.equal(parseTrace2Line('not json'), null);
  assert.deepEqual(parseTrace2Line('{"event":"child_start"}'), { event: 'child_start' });
});

test('createTrace2Monitor emits hook start and finish from the event file', async () => {
  const events = [];
  const monitor = createTrace2Monitor((event) => { events.push(event); });
  const file = monitor.env.GIT_TRACE2_EVENT;
  fs.appendFileSync(file, `${JSON.stringify({
    event: 'child_start',
    child_class: 'hook',
    child_id: 1,
    hook_name: 'pre-commit',
  })}\n`);
  monitor.poll();
  fs.appendFileSync(file, `${JSON.stringify({
    event: 'child_exit',
    child_class: 'hook',
    child_id: 1,
    hook_name: 'pre-commit',
    code: 0,
  })}\n`);
  monitor.flush();
  monitor.close();
  assert.equal(events[0]?.kind, 'started');
  assert.equal(events[0]?.hookName, 'pre-commit');
  assert.equal(events[1]?.kind, 'finished');
  assert.equal(events[1]?.hookName, 'pre-commit');
  assert.equal(events[1]?.exitCode, 0);
});

test('createTrace2Monitor reads git TRACE2 exitCode aliases', async () => {
  const events = [];
  const monitor = createTrace2Monitor((event) => { events.push(event); });
  const file = monitor.env.GIT_TRACE2_EVENT;
  fs.appendFileSync(file, `${JSON.stringify({
    event: 'child_start',
    child_class: 'hook',
    child_id: 2,
    hook_name: 'pre-push',
  })}\n${JSON.stringify({
    event: 'child_exit',
    child_class: 'hook',
    child_id: 2,
    hook_name: 'pre-push',
    exitCode: 1,
  })}\n`);
  monitor.flush();
  monitor.close();
  assert.equal(events[1]?.kind, 'finished');
  assert.equal(events[1]?.exitCode, 1);
});

test('createTrace2Monitor reads production TRACE2 exit_code', async () => {
  const events = [];
  const monitor = createTrace2Monitor((event) => { events.push(event); });
  const file = monitor.env.GIT_TRACE2_EVENT;
  fs.appendFileSync(file, `${JSON.stringify({
    event: 'child_start',
    child_class: 'hook',
    child_id: 3,
    hook_name: 'pre-commit',
  })}\n${JSON.stringify({
    event: 'child_exit',
    child_class: 'hook',
    child_id: 3,
    hook_name: 'pre-commit',
    exit_code: 128,
  })}\n`);
  monitor.flush();
  monitor.close();
  assert.equal(events[1]?.kind, 'finished');
  assert.equal(events[1]?.exitCode, 128);
});
