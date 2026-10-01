#!/usr/bin/env node
// One policy for candidate planning and promotion. No external dependencies.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const CORE_CASES = [
  'TC-INST-001', 'TC-INST-002', 'TC-INST-008', 'TC-INST-009', 'TC-INST-013',
  'TC-MODEL-001', 'TC-MODEL-003', 'TC-WS-006',
  'TC-CHAT-001', 'TC-CHAT-002', 'TC-CHAT-003', 'TC-CHAT-004', 'TC-CHAT-005', 'TC-CHAT-012',
  'TC-SESS-003', 'TC-APPROVE-001', 'TC-APPROVE-002', 'TC-GIT-003',
  'TC-SURF-001', 'TC-SURF-002', 'TC-TERM-001', 'TC-TERM-002',
  'TC-DESK-001', 'TC-DESK-004', 'TC-NEG-001', 'TC-NEG-005',
];

// A match selects every case in that area; an unclassified runtime change
// selects the full catalog. Renames are compared as deletion + addition.
const AREAS = [
  { id: 'install', paths: /(?:^build\/|^electron-builder|^scripts\/(?:after-pack|runtime-|prepare-|setup-harness)|^src\/(?:main|shared)\/(?:harness|runtime|config|product-identity|legacy-notification|window-app-details|system-notifications))/, cases: /^TC-(?:INST|LAUNCH|NEG|DESK)-/ },
  { id: 'update', paths: /(?:^src\/.*(?:update|launcher)|^build\/installer)/, cases: /^TC-(?:INST|LAUNCH|DESK)-/ },
  { id: 'shell', paths: /(?:^src\/.*(?:window|shell|boot|closing|tray|shortcut)|^assets\/|^vendor\/deepseek-harness\/packages\/client\/(?:ui-desktop|ui-boot|ui-titlebar|ui-theme))/, cases: /^TC-(?:WS|LAUNCH|DESK|APP)-/ },
  { id: 'conversation', paths: /(?:^src\/.*(?:session|model|credential|approval)|^vendor\/deepseek-harness\/packages\/client\/(?:ui-chat|ui-composer|ui-session|ui-model|ui-provider|ui-approval))/, cases: /^TC-(?:CHAT|MODEL|SESS|APPROVE)-/ },
  { id: 'workspace', paths: /(?:^src\/.*(?:git|workspace|preview|browser|terminal)|^vendor\/deepseek-harness\/packages\/client\/(?:ui-files|ui-sidebar|ui-browser|ui-git|ui-terminal|ui-workspace|dock))/, cases: /^TC-(?:WS|SURF|TERM|GIT)-/ },
  { id: 'remote', paths: /(?:^mobile\/|^vendor\/(?:dsh-remote|dshd-remote|chisacode-remote)\/|^src\/.*(?:remote|mobile))/, cases: /^TC-(?:REM|RW|NEG)-/ },
  { id: 'extensions', paths: /(?:^vendor\/(?:dshbot|dsh-im)\/|^src\/.*(?:plugin|marketplace|mcp|skill)|^vendor\/deepseek-harness\/packages\/client\/ui-(?:settings|marketplace|skill|mcp))/, cases: /^TC-(?:EXT|INST|NEG)-/ },
  { id: 'appearance', paths: /(?:^src\/.*(?:pet|wallpaper|theme)|^vendor\/deepseek-harness\/packages\/client\/ui-(?:appearance|wallpaper|pet))/, cases: /^TC-(?:APP|DESK)-/ },
];

export function catalogFromMarkdown(markdown) {
  const ids = [...markdown.matchAll(/^### (TC-[A-Z]+-\d+[a-z]?)\b/gm)].map(m => m[1]);
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Invalid or duplicate acceptance catalog');
  for (const id of CORE_CASES) if (!ids.includes(id)) throw new Error(`Catalog missing core case ${id}`);
  return ids;
}

export function metadataOnlyChange(file, before, after) {
  if (!['package.json', 'package-lock.json'].includes(file)) return false;
  const normalize = value => {
    const copy = structuredClone(value);
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return copy;
    delete copy.version;
    if (file === 'package.json' && copy.scripts) {
      for (const key of Object.keys(copy.scripts)) if (/^(?:test(?::|$)|release:|check:|qa:|smoke:|doc-sync$)/.test(key)) delete copy.scripts[key];
      if (!Object.keys(copy.scripts).length) delete copy.scripts;
    }
    if (file === 'package-lock.json' && copy.packages?.['']) delete copy.packages[''].version;
    return copy;
  };
  return isDeepStrictEqual(normalize(before), normalize(after));
}

export function selectCases(changedFiles, catalog, metadataOnlyFiles = []) {
  if (!Array.isArray(changedFiles) || changedFiles.some(p => typeof p !== 'string' || !p || p.startsWith('/') || p.includes('\\') || p.split('/').includes('..'))) {
    throw new Error('Invalid changedFiles');
  }
  if (!Array.isArray(metadataOnlyFiles) || metadataOnlyFiles.some(p => !['package.json', 'package-lock.json'].includes(p) || !changedFiles.includes(p))) throw new Error('Invalid metadata-only manifest classification');
  const areas = new Set();
  let full = false;
  for (const file of changedFiles) {
    if (metadataOnlyFiles.includes(file)) continue;
    if (/^(?:docs\/|\.devin\/|\.cursor\/|AGENTS\.md$|CONTRIBUTING(?:\.en)?\.md$|README(?:\.[a-z-]+)?\.md$)/.test(file)) continue;
    if (/(?:\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$|\.i18n\.yaml$|(?:^|\/)README(?:\.[a-z-]+)?\.md$)/.test(file)) continue;
    if (/^(?:\.github\/|scripts\/(?:release-|check-release-|verify-|run-gates|lib\/gate))/.test(file)) { areas.add('release-tooling'); continue; }
    // Locks, Electron/Node changes, native/core adoption and unknown sources
    // have cross-cutting effects; no optimistic narrow classification.
    if (/(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml)$/.test(file) || file === '.nvmrc' || file === 'vendor/harness-upstream.json') { full = true; continue; }
    const matches = AREAS.filter(area => area.paths.test(file));
    if (!matches.length) full = true;
    for (const area of matches) areas.add(area.id);
  }
  const required = new Set(CORE_CASES);
  for (const id of catalog) if (full || AREAS.some(a => areas.has(a.id) && a.cases.test(id))) required.add(id);
  return { fullSuite: full, areas: [...areas].sort(), requiredCases: [...required].sort() };
}

export function createPlan({ baseSha, candidateSha, runId, version, includeMac, changedFiles, metadataOnlyFiles = [] }, catalog) {
  if (![baseSha, candidateSha].every(s => /^[a-f0-9]{40}$/.test(s))) throw new Error('Expected full base and candidate commit SHAs');
  if (!/^[1-9]\d*$/.test(runId)) throw new Error('Invalid candidate run ID');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected stable package version');
  if (typeof includeMac !== 'boolean') throw new Error('includeMac must be boolean');
  const files = [...new Set(changedFiles)].sort();
  return {
    schemaVersion: 1, baseSha, candidateSha, runId, version,
    platforms: includeMac ? ['windows-x64', 'macos-arm64'] : ['windows-x64'],
    changedFiles: files, metadataOnlyFiles: [...new Set(metadataOnlyFiles)].sort(), ...selectCases(files, catalog, metadataOnlyFiles),
  };
}

export function validatePlan(plan, catalog) {
  const expected = createPlan({ ...plan, includeMac: plan.platforms?.includes('macos-arm64') }, catalog);
  if (!isDeepStrictEqual(plan, expected)) throw new Error('Plan differs from candidate policy; regenerate from CI');
  return plan;
}

export const ROOT = resolve(import.meta.dirname, '..');
export function loadCatalog() {
  return catalogFromMarkdown(readFileSync(resolve(ROOT, 'docs/qa/production-acceptance-test-cases.md'), 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [baseSha, candidateSha, runId, mac, output] = process.argv.slice(2);
    if (!output || !['true', 'false'].includes(mac)) throw new Error('Usage: release-plan.mjs <base-sha> <candidate-sha> <run-id> <true|false:macos> <output.json>');
    if (![baseSha, candidateSha].every(s => /^[a-f0-9]{40}$/.test(s))) throw new Error('Expected full commit SHAs');
    const git = args => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (git(['rev-parse', 'HEAD']).trim() !== candidateSha) throw new Error('Checkout is not the candidate SHA');
    const changedFiles = git(['diff', '--name-only', '--no-renames', '-z', baseSha, candidateSha, '--']).split('\0').filter(Boolean);
    const metadataOnlyFiles = changedFiles.filter(file => {
      if (!['package.json', 'package-lock.json'].includes(file)) return false;
      try {
        return metadataOnlyChange(file, JSON.parse(git(['show', `${baseSha}:${file}`])), JSON.parse(git(['show', `${candidateSha}:${file}`])));
      } catch { return false; } // Added or unreadable manifests remain full-risk.
    });
    const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
    const plan = createPlan({ baseSha, candidateSha, runId, includeMac: mac === 'true', version, changedFiles, metadataOnlyFiles }, loadCatalog());
    writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    console.log(`Release plan: ${plan.requiredCases.length} cases; ${plan.fullSuite ? 'full regression' : plan.areas.join(', ') || 'core only'}; candidate=${candidateSha}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
