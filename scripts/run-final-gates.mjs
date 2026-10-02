#!/usr/bin/env node
// Explicit local checks, not a default matrix or a product acceptance certificate.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const VENDOR = resolve(ROOT, 'vendor/deepseek-harness');
const GATES = [
  { name: 'desktop-tests', cwd: ROOT, cmd: 'npm', args: ['test'] },
  { name: 'typecheck', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'typecheck'] },
  { name: 'test-gui', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'test:gui'] },
  { name: 'test-web', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'test:web'] },
  { name: 'cordis-config', cwd: VENDOR, cmd: 'pnpm', args: ['run', 'verify-cordis-config'] },
  { name: 'pack', cwd: ROOT, cmd: 'npm', args: ['run', 'dist'] },
  { name: 'packaged-smoke', cwd: ROOT, cmd: 'npm', args: ['run', 'smoke:packaged'] },
];

const nonempty = value => typeof value === 'string' && value.trim().length > 0;

// Conservatively recognize our ordinary workflow syntax; unfamiliar syntax is
// not evidence that automation is disabled. This is not a general YAML parser.
export function hasAutomaticWorkflow(source) {
  const on = source.match(/^on:[ \t]*([^\r\n]*)$/m);
  if (!on) return true;
  const inline = on[1].replace(/\s+#.*$/, '').trim();
  if (inline) return !['workflow_dispatch', 'workflow_call'].includes(inline);
  const tail = source.slice(on.index + on[0].length).split(/\n(?=[^\s#])/)[0];
  const events = [...tail.matchAll(/^  ([a-z_]+):/gm)].map(match => match[1]);
  return !events.length || events.some(event => !['workflow_dispatch', 'workflow_call'].includes(event));
}

export function validateCiHistory(state) {
  if (!Number.isSafeInteger(state.ciNonpassCount) || state.ciNonpassCount < 0 || !nonempty(state.ciCountEvidence)) {
    throw new Error('Push blocked: verified cumulative CI count/history is required; unknown is not zero');
  }
  if (state.ciNonpassCount >= 4) {
    const prefix = `${state.ciNonpassCount}:`;
    if (!state.ciRecoveryDecision?.startsWith(prefix) || !nonempty(state.ciRecoveryDecision.slice(prefix.length))) {
      throw new Error('Push blocked: CI stopped after four non-passes; require a user corrective decision bound to the unchanged cumulative count');
    }
  }
}

// Reuses the single existing ignored status file. It checks record consistency,
// not the truth of human observations, and is not a permissions boundary.
export function validateLocalQa(state, sha) {
  const qa = state?.localQa;
  if (!/^[a-f0-9]{40}$/.test(sha) || qa?.sourceSha !== sha || qa?.implementationComplete !== true || qa?.status !== 'pass') {
    throw new Error('Push blocked: implementation and local QA must be complete for this exact commit');
  }
  if (!nonempty(qa.environment) || !nonempty(qa.actualResult) || !nonempty(qa.scope)) {
    throw new Error('Push blocked: real environment, observed result and affected scope are required');
  }
  if (!Array.isArray(qa.checks) || !qa.checks.length || qa.checks.some(check => !nonempty(check.name) || check.status !== 'pass' || !nonempty(check.evidence))) {
    throw new Error('Push blocked: every necessary local check needs passing evidence; blocked/skip/not-run cannot pass');
  }
  if (new Set(qa.checks.map(check => check.name.trim())).size !== qa.checks.length) throw new Error('Push blocked: duplicate check names are not additional coverage');
  validateCiHistory(state);
  return qa;
}

export function selectGates(argv) {
  if (argv.length !== 2 || argv[0] !== '--only' || !argv[1]) {
    throw new Error('Choose necessary checks explicitly: --only name,name. No default full matrix; --skip is unsupported');
  }
  const names = argv[1].split(',');
  if (new Set(names).size !== names.length) throw new Error('Duplicate checks are forbidden');
  return names.map(name => {
    const gate = GATES.find(g => g.name === name);
    if (!gate) throw new Error(`Unknown check: ${name}`);
    return gate;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const argv = process.argv.slice(2);
    const git = args => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
    const checkQa = sha => {
      if (git(['rev-parse', 'HEAD']).trim() !== sha) throw new Error('Push blocked: this local record only certifies HEAD, not another ref');
      if (git(['status', '--porcelain']).trim()) throw new Error('Push blocked: uncommitted changes invalidate the recorded commit validation');
      validateLocalQa(JSON.parse(readFileSync(resolve(ROOT, '.tmp/release/current-state.json'), 'utf8')), sha);
      console.log(`Local QA record matches ${sha}; this is not independent certification of observations`);
    };
    if (argv.length === 1 && argv[0] === '--list') {
      console.log(GATES.map(g => g.name).join('\n'));
    } else if (argv.length === 2 && argv[0] === '--check-local-qa') {
      checkQa(argv[1]);
    } else if (argv.length === 3 && argv[0] === '--check-push') {
      const [, sha, remoteSha] = argv;
      if (![sha, remoteSha].every(value => /^[a-f0-9]{40}$/.test(value))) throw new Error('Push blocked: expected full Git object IDs');
      const automatic = revision => {
        try {
          const paths = git(['ls-tree', '-r', '--name-only', revision, '.github/workflows']).trim().split(/\r?\n/).filter(path => /\.ya?ml$/.test(path));
          return paths.some(path => hasAutomaticWorkflow(git(['show', `${revision}:${path}`])));
        } catch { return true; } // An unfetched remote tip cannot establish a manual-only policy.
      };
      if (automatic(sha) || (remoteSha !== '0'.repeat(40) && automatic(remoteSha))) checkQa(sha);
      else console.log('Manual-only workflow policy: push starts no QA or release gate; final CI still requires completed local QA');
    } else {
      const selected = selectGates(argv); // validate all input before starting any command
      mkdirSync(resolve(ROOT, '.final-gates'), { recursive: true });
      for (const gate of selected) {
        const fd = openSync(resolve(ROOT, '.final-gates', `${gate.name}.log`), 'w');
        console.log(`START ${gate.name}`);
        let child;
        try {
          child = spawnSync(gate.cmd, gate.args, {
            cwd: gate.cwd, shell: true, stdio: ['ignore', fd, fd],
            env: { ...process.env, PATH: `${resolve(ROOT, 'node_modules/.bin')}${delimiter}${process.env.PATH}` },
          });
        } finally { closeSync(fd); }
        if (child.status !== 0) throw new Error(`${gate.name} failed (exit=${child.status ?? 'not started'}); stop and diagnose before retrying`);
        console.log(`PASS ${gate.name} (command only; real operations require separate observation)`);
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
