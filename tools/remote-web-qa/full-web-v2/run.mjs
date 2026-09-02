#!/usr/bin/env node
/**
 * Full-web v2 rehearsal runner (T2 rehearsal track, NOT a T1 pass).
 * Runs the hardened module drivers in gate order against the already-running
 * source desktop (3080/3180/6767 + CDP 9229) and writes results.json + REPORT.md.
 *
 *   node tools/remote-web-qa/full-web-v2/run.mjs [--out <dir>] [--modules PAIR,LAY,...] [--continue]
 *
 * Fixtures the drivers expect (see plan §F): C:\Ai\dshd-qa-ws-* with README.md,
 * a bare origin repo, grok-4.6 in session.models. Never bounces the daemon.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = path.resolve(opt('--out', path.join('docs', 'qa', 'results', new Date().toISOString().slice(0, 10), 'full-web-v2')));
const only = opt('--modules', '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const keepGoing = args.includes('--continue');

// Gate order per docs/qa/mobile-remote-full-web-cases.md §16.
const MODULES = [
  { id: 'PAIR', scripts: ['run-pair.mjs'] },
  { id: 'LAY', scripts: ['run-lay.mjs', 'retest-lay-005-010.mjs'] },
  { id: 'LIST', scripts: ['retest-list4.mjs', 'retest-list2.mjs'] },
  { id: 'SRCH', scripts: ['retest-search.mjs'] },
  { id: 'MENU', scripts: ['retest-menu3.mjs', 'retest-sync-reverse.mjs', 'retest-move.mjs'] },
  { id: 'CMP', scripts: ['run-cmp.mjs', 'retest-access-label.mjs', 'probe-attach.mjs'] },
  { id: 'CHAT', scripts: ['run-chat-appr.mjs'] },
  { id: 'GIT', scripts: ['run-git.mjs', 'retest-git2.mjs', 'retest-git4.mjs'] },
  { id: 'FINAL', scripts: ['run-final.mjs'] },
];

mkdirSync(out, { recursive: true });
const resultsPath = path.join(out, 'results.json');
if (!existsSync(resultsPath)) writeFileSync(resultsPath, '{}\n');

function failCount() {
  const all = JSON.parse(readFileSync(resultsPath, 'utf8'));
  return Object.values(all).filter((r) => r.status === 'Fail').length;
}

let previousFails = failCount();
for (const mod of MODULES) {
  if (only.length && !only.includes(mod.id)) continue;
  console.log(`\n=== ${mod.id} ===`);
  for (const script of mod.scripts) {
    const file = path.join(here, script);
    if (!existsSync(file)) { console.log(`skip missing ${script}`); continue; }
    const res = spawnSync(process.execPath, [file], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, DSH_QA_OUT: out },
    });
    if (res.status !== 0) console.log(`(${script} exited ${res.status})`);
  }
  const fails = failCount();
  if (fails > previousFails && !keepGoing) {
    console.log(`\n${mod.id}: ${fails - previousFails} new Fail → stopping (use --continue to run on).`);
    break;
  }
  previousFails = fails;
}

spawnSync(process.execPath, [path.join(here, 'report.mjs')], { stdio: 'inherit', env: { ...process.env, DSH_QA_OUT: out } });
