import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_SLASH_COMMANDS, hostSlashCommands } from './slash.js';

test('hostSlashCommands is a copy of the static fallback, not the live host catalog', () => {
  const listed = hostSlashCommands();
  assert.ok(listed.some((row) => row.name === 'permission'));
  listed.push({ name: 'mutated' });
  assert.equal(HOST_SLASH_COMMANDS.some((row) => row.name === 'mutated'), false);
});
