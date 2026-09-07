import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionOwner } from './session-owner.js';

test('late results cannot cross a session, device, or reopened session generation', () => {
  const state = { sessionId: 'a', sessionEpoch: 1, chisacode: { client: {} } };
  const task = sessionOwner(state);
  assert.equal(task.owns(), true);
  state.sessionId = 'b'; assert.equal(task.owns(), false);
  state.sessionId = 'a'; state.sessionEpoch++; assert.equal(task.owns(), false);
  const newer = sessionOwner(state);
  state.chisacode = { client: {} }; assert.equal(newer.owns(), false);
});
