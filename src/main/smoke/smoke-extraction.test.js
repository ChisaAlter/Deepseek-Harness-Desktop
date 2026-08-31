'use strict';

// M-5 regression guard: the QA / smoke orchestration must stay out of the
// production entry (src/main/index.js) and live behind the DSH_SMOKE gate as
// a lazy require of this directory. These are static checks because loading
// the modules needs a live Electron runtime.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const indexPath = path.join(__dirname, '..', 'index.js');
const smokePath = path.join(__dirname, 'index.js');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const smokeSource = fs.readFileSync(smokePath, 'utf8');

test('index.js 不再内联 smoke/QA 编排', () => {
  for (const marker of [
    'SMOKE_SURFACES',
    'probeTitlebarHits',
    'probeThemeBackgrounds',
    'dismissFirstRunOnboarding',
    'async function keepRemotePhoneHost',
    'runReleaseUiWalk',
    'runComposerOfficialQa',
  ]) {
    assert.ok(!indexSource.includes(marker), `index.js 不应再包含 ${marker}`);
  }
});

test('index.js 仅在 DSH_SMOKE 门禁内惰性加载 ./smoke', () => {
  const gate = indexSource.indexOf("qaEnv('DSH_SMOKE')");
  const lazyRequire = indexSource.indexOf("require('./smoke')");
  assert.ok(gate >= 0, '应保留 DSH_SMOKE 门禁');
  assert.ok(lazyRequire > gate, "require('./smoke') 必须出现在门禁之后（惰性加载）");
  assert.ok(indexSource.includes('createSmokeRunner'), '应通过 createSmokeRunner 注入依赖');
});

test('smoke 模块导出 createSmokeRunner 且语法有效', () => {
  assert.ok(smokeSource.includes('module.exports = { createSmokeRunner }'));
  // node --check parses without executing, so the electron require is safe.
  execFileSync(process.execPath, ['--check', smokePath]);
  execFileSync(process.execPath, ['--check', indexPath]);
});

test('QA 驱动仅在 smoke 模块内按需 require', () => {
  for (const driver of [
    './release-ui-walk',
    './composer-official-qa',
    './remote-gate-qa',
    './appendix-a-qa',
    './shell-p0-qa',
    './packaged-p0',
  ]) {
    assert.ok(!indexSource.includes(`require('${driver}')`), `index.js 不应 require ${driver}`);
    assert.ok(smokeSource.includes(`require('.${driver}')`), `smoke 模块应惰性 require ..${driver.slice(1)}`);
  }
});

test('packaged smoke widens the window before titlebar hits', () => {
  const helper = smokeSource.indexOf('async function ensureSurfacesViewport');
  const probeCall = smokeSource.indexOf('titlebarHits = await probeTitlebarHits');
  const helperCall = smokeSource.indexOf('await ensureSurfacesViewport(win, wc)');
  assert.ok(helper >= 0, '应定义 ensureSurfacesViewport');
  assert.ok(helperCall >= 0 && helperCall < probeCall, 'widen 必须在 probeTitlebarHits 之前');
  assert.ok(smokeSource.includes('SMOKE_SURFACES_MIN_VIEWPORT = 1280'));
  assert.ok(smokeSource.includes('data-dshd-caption="band"'));
  assert.ok(smokeSource.includes('view.setBounds'));
});
