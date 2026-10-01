import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReleaseVersion } from './check-release-version.mjs';
test('release version matches candidate and advances latest semantically', () => {
  assert.doesNotThrow(() => assertReleaseVersion('v0.3.3', '0.3.3', 'v0.3.2'));
  assert.doesNotThrow(() => assertReleaseVersion('v0.3.10', '0.3.10', 'v0.3.9'));
  assert.throws(() => assertReleaseVersion('v0.3.3', '0.3.3', 'v0.3.3'), /newer/);
  assert.throws(() => assertReleaseVersion('v0.3.3', '0.3.3', 'v0.3.4'), /newer/);
  assert.throws(() => assertReleaseVersion('v0.3.3', '0.3.4'), /match/);
  assert.throws(() => assertReleaseVersion('v0.3.3-beta', '0.3.3-beta'), /stable/);
});
