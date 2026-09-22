import test from 'node:test';
import assert from 'node:assert/strict';
import { draftHeight } from './composer-behavior.js';

test('draft grows within a keyboard-aware height cap without a zero-height state', () => {
  assert.equal(draftHeight(0, 0), 48);
  assert.equal(draftHeight(800, 844), 240);
  assert.equal(draftHeight(800, 300), 90);
  assert.equal(draftHeight(100, 800), 100);
  assert.equal(draftHeight(NaN, NaN), 48);
});
