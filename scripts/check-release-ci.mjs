#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function selectRun(runs, sha) {
  const matches = runs.filter(r => r.display_title === `Final validation ${sha}` && r.event === 'workflow_dispatch' && r.head_branch === 'main')
    .sort((a, b) => Number(b.id) - Number(a.id));
  if (!matches.length) throw new Error('No manual final Desktop tests run for candidate SHA');
  const run = matches[0];
  if (run.status !== 'completed') throw new Error(`Desktop tests ${run.id} is not complete; wait before building`);
  if (run.conclusion !== 'success') throw new Error(`Latest final Desktop tests ${run.id} did not pass`);
  return run;
}

export function validateJobs(jobs, includeMac) {
  const required = ['Fast checks', 'Desktop unit tests (windows-latest)', 'vendor-gui'];
  if (includeMac) required.push('Desktop unit tests (macos-latest)');
  for (const name of required) {
    const matches = jobs.filter(j => j.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
      throw new Error(`Required CI job not green: ${name}`);
    }
  }
  return required;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [repo, sha, mac] = process.argv.slice(2);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(sha) || !['true', 'false'].includes(mac)) {
      throw new Error('Usage: check-release-ci.mjs <owner/repo> <candidate-sha> <true|false:macos>');
    }
    const api = endpoint => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    const runs = api(`repos/${repo}/actions/workflows/test.yml/runs?event=workflow_dispatch&per_page=100`).flatMap(p => p.workflow_runs);
    const run = selectRun(runs, sha);
    // filter=latest includes only the latest attempt; never revive an old green attempt.
    const jobs = api(`repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`).flatMap(p => p.jobs);
    validateJobs(jobs, mac === 'true');
    const macJob = jobs.find(j => j.name === 'Desktop unit tests (macos-latest)');
    console.log(`Eligible CI: ${run.html_url}; macOS=${macJob?.conclusion ?? 'missing'}${mac === 'false' ? ' (not shipping)' : ''}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
