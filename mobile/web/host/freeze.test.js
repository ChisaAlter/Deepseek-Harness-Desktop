import test from 'node:test';
import assert from 'node:assert/strict';
import { FILES_DIFF_FREEZE, freezePane } from './freeze.js';

test('freezePane names Files/Diff freeze copy', () => {
  assert.equal(freezePane('files').title, '文件');
  assert.equal(freezePane('diff').body, FILES_DIFF_FREEZE);
  assert.match(freezePane('mcp').body, /电脑端/);
});
