import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRun, validateJobs } from './check-release-ci.mjs';
const sha = 'a'.repeat(40);
const run = { id: 1, head_sha: sha, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success' };
const jobs = ['Fast checks', 'Desktop unit tests (windows-latest)', 'vendor-gui', 'Desktop unit tests (macos-latest)']
  .map(name => ({ name, status: 'completed', conclusion: 'success' }));
test('only the latest main push run of the exact SHA is eligible', () => {
  assert.equal(selectRun([run, { ...run, id: 2, event: 'pull_request' }], sha).id, 1);
  assert.throws(() => selectRun([{ ...run, head_sha: 'b'.repeat(40) }], sha), /No main/);
  assert.throws(() => selectRun([run, { ...run, id: 2, status: 'in_progress' }], sha), /not complete/);
});
test('Windows release tolerates only the non-shipping macOS job failure', () => {
  const failedMac = jobs.map(j => j.name.includes('macos') ? { ...j, conclusion: 'failure' } : j);
  assert.equal(validateJobs(failedMac, false).length, 3);
  assert.throws(() => validateJobs(failedMac, true), /macos/);
  for (const name of jobs.slice(0, 3).map(j => j.name)) {
    assert.throws(() => validateJobs(jobs.map(j => j.name === name ? { ...j, conclusion: 'failure' } : j), false), /not green/);
  }
});
test('missing, skipped and duplicate required jobs never inherit green', () => {
  assert.throws(() => validateJobs(jobs.slice(1), false), /Fast checks/);
  assert.throws(() => validateJobs([...jobs, jobs[0]], false), /Fast checks/);
  assert.throws(() => validateJobs(jobs.map(j => ({ ...j, conclusion: 'skipped' })), false), /not green/);
});
