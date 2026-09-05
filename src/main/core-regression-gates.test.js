'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('CI runs blocking core regression suites after building vendor libraries', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/test.yml'), 'utf8');
  const step = workflow.match(/- name: Core contract regression suites\r?\n\s+run: ([^\r\n]+)/);
  assert.ok(step, 'core behavior gate must be present');
  for (const owner of ['core/agent-loop', 'core/session', 'core/tools', 'llm',
    'api/session-controller', 'api/workspace-controller', 'fs/tool-fs',
    'workspace', 'session/session-projection-cache', 'subagent/subagent']) {
    assert.ok(step[1].includes(`packages/${owner}`), `missing ${owner}`);
  }
  assert.match(step[1], /exec vitest run /);
  assert.match(step[1], /--maxWorkers 2/);
  assert.match(workflow, /--config vitest\.snapshot\.config\.ts[^\r\n]+replays malformed-tool-call-retry/);
  assert.ok(workflow.indexOf('run build:lib') < workflow.indexOf(step[0]));
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});
