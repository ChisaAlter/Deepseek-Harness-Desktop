'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertReleaseQaResult,
  QA_REQUIRED_STEPS,
  PAGE_HELPERS,
} = require('./release-ui-walk');

test('assertReleaseQaResult passes when every required step is present and ok', () => {
  const steps = QA_REQUIRED_STEPS.map((name) => ({ name, ok: true, detail: '' }));
  steps.push({ name: 'gallery.items', ok: false, optional: true, detail: 'network' });
  assert.doesNotThrow(() => assertReleaseQaResult({
    qa: { ok: true, failed: [], steps },
  }));
});

test('assertReleaseQaResult fails on a required step miss or omission', () => {
  assert.throws(
    () => assertReleaseQaResult({ qa: { ok: false, failed: ['files.panel'], steps: [] } }),
    /files\.panel/,
  );
  const steps = QA_REQUIRED_STEPS
    .filter((name) => name !== 'plugin.dshbot.tabAbsent')
    .map((name) => ({ name, ok: true, detail: '' }));
  assert.throws(
    () => assertReleaseQaResult({ qa: { ok: true, failed: [], steps } }),
    /plugin\.dshbot\.tabAbsent/,
  );
});

test('release walk helpers stay injectable into the harness page', () => {
  assert.match(PAGE_HELPERS, /function dshShown/);
  assert.match(PAGE_HELPERS, /function dshFind/);
  assert.match(PAGE_HELPERS, /function dshAssignFile/);
  assert.match(PAGE_HELPERS, /function dshQaPngFile/);
  assert.match(PAGE_HELPERS, /send message\|发送消息/);
  assert.match(PAGE_HELPERS, /function dshSetValue/);
  assert.match(PAGE_HELPERS, /function dshField/);
  assert.match(PAGE_HELPERS, /insertText/);
  assert.match(PAGE_HELPERS, /execCommand/);
  assert.match(PAGE_HELPERS, /function dshDialogNamed/);
  assert.ok(QA_REQUIRED_STEPS.includes('workspace.connected'));
  assert.ok(QA_REQUIRED_STEPS.includes('workspace.picker'));
  assert.ok(QA_REQUIRED_STEPS.includes('gallery.sources'));
  assert.ok(QA_REQUIRED_STEPS.includes('market.discover'));
  assert.ok(QA_REQUIRED_STEPS.includes('browser.url'));
  assert.ok(QA_REQUIRED_STEPS.includes('plugin.dshbot.tabAbsent'));
  assert.equal(QA_REQUIRED_STEPS.includes('plugin.dshbot.tab'), false);
  assert.ok(QA_REQUIRED_STEPS.includes('market.installed'));
  assert.ok(QA_REQUIRED_STEPS.includes('usage-stats.section'));
  assert.ok(QA_REQUIRED_STEPS.includes('files.mentionAppended'));
  assert.ok(QA_REQUIRED_STEPS.includes('files.mentionVisible'));
  assert.ok(QA_REQUIRED_STEPS.includes('composer.skillMenuAbsent'));
  assert.ok(QA_REQUIRED_STEPS.includes('composer.pathSourceAbsent'));
  assert.ok(QA_REQUIRED_STEPS.includes('remote.available'));
  assert.ok(QA_REQUIRED_STEPS.includes('remote.notListening'));
  assert.ok(QA_REQUIRED_STEPS.includes('remote.footerPresent'));
  assert.ok(QA_REQUIRED_STEPS.includes('titlebar.windowControls'));
  assert.ok(QA_REQUIRED_STEPS.includes('files.tabCloseRight'));
  assert.ok(QA_REQUIRED_STEPS.includes('git.commit'));
  assert.ok(QA_REQUIRED_STEPS.includes('models.heading'));
  assert.ok(QA_REQUIRED_STEPS.includes('models.customAdd'));
  assert.ok(QA_REQUIRED_STEPS.includes('models.visionPicker'));
  assert.ok(QA_REQUIRED_STEPS.includes('appearance.themeSwitch'));
  assert.ok(QA_REQUIRED_STEPS.includes('appearance.localCrop'));
  assert.ok(QA_REQUIRED_STEPS.includes('appearance.frost'));
  assert.ok(QA_REQUIRED_STEPS.includes('gallery.wallhavenSfw'));
  assert.ok(QA_REQUIRED_STEPS.includes('gallery.confirmSet'));
  assert.ok(QA_REQUIRED_STEPS.includes('composer.thinkingSwitch'));
  assert.ok(QA_REQUIRED_STEPS.includes('models.customForm'));
});

test('release walk source clicks Mention and asserts the composer markdown link', () => {
  const walk = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'release-ui-walk.js'),
    'utf8',
  );
  assert.match(walk, /files\.mentionAppended/);
  assert.match(walk, /mention in composer\|引用到输入框/);
  assert.match(walk, /typeIntoComposer\(wc, ''\)/);
  assert.match(walk, /\\\[note\\\.md\\\]\\\(note\\\.md\\\)/);
  assert.match(walk, /mention click missed/);
  assert.match(walk, /composer\.skillMenuAbsent/);
  assert.match(walk, /composer\.pathSourceAbsent/);
  assert.match(walk, /data-source="path"/);
  assert.match(walk, /probeRemote/);
  assert.match(walk, /remote\.available/);
  assert.match(walk, /remoteSnap\.available === false/);
  assert.match(walk, /remote\.footerPresent/);
  assert.match(walk, /parked hidden/);
  assert.match(walk, /titlebar\.windowControls/);
  assert.match(walk, /files\.tabCloseRight/);
  assert.match(walk, /git\.commitDialog/);
  assert.match(walk, /gitHeadSubject/);
  assert.match(walk, /dirtyQaNote/);
  assert.match(walk, /qa: commit note\.md \$\{Date\.now\(\)\}/);
  assert.match(walk, /git actions\|git 操作/);
  assert.match(walk, /\^commit\$/);
  assert.match(walk, /note\\.md/);
  assert.match(walk, /models\.visionPicker/);
  assert.match(walk, /appearance\.themeSwitch/);
  assert.match(walk, /appearance\.localCrop/);
  assert.match(walk, /gallery\.confirmSet/);
  assert.match(walk, /\^必应\$\|\^bing\$/);
  assert.match(walk, /Bing thumbnails did not load/);
  assert.match(walk, /models\.customForm/);
  assert.match(walk, /usage-stats\.section/);
  assert.match(walk, /data-dsh-settings-section="usage-stats"/);
  assert.match(walk, /dshCustomProviderCard/);
  assert.match(walk, /\^显示名称\$\|\^display name\$/);
  assert.match(walk, /typeIntoAriaField/);
  assert.match(walk, /Input\.insertText/);
  assert.doesNotMatch(walk, /未选择\|api 协议\|protocol/);
  assert.match(walk, /summarizeRemoteQaDetail/);
  assert.doesNotMatch(walk, /JSON\.stringify\(remoteSnap\)/);
  assert.match(walk, /composer\.thinkingSwitch/);
  assert.match(walk, /推理等级\|\^effort/);
  assert.match(walk, /gateway did not expose reasoning efforts/);
  assert.match(walk, /\$fo/);
});

test('release walk types into Lexical composer and matches 0.1.2 chrome copy', () => {
  const walk = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'release-ui-walk.js'),
    'utf8',
  );
  assert.match(PAGE_HELPERS, /function dshComposerInput/);
  assert.match(PAGE_HELPERS, /function dshComposerReady/);
  assert.match(PAGE_HELPERS, /function dshComposerText/);
  assert.match(PAGE_HELPERS, /function dshSetComposerText/);
  assert.match(PAGE_HELPERS, /data-composer-input/);
  assert.match(walk, /dshComposerReady/);
  assert.match(walk, /dshSetComposerText/);
  assert.match(walk, /dshComposerText/);
  assert.match(walk, /typeIntoComposer/);
  assert.match(walk, /clickNewSession/);
  assert.match(walk, /sendInputEvent/);
  assert.match(walk, /insertText/);
  assert.match(walk, /Input\.insertText/);
  assert.match(walk, /dshSelectComposerAll/);
  assert.match(walk, /insertReplacementText/);
  assert.match(walk, /stop generating\|停止生成/);
  assert.match(walk, /no 发送消息 \(likely 停止生成 leftover\)/);
  assert.match(walk, /Session 日志/);
  assert.match(walk, /\^\(discover\|发现\)\$/);
  assert.match(walk, /识图模型/);
  assert.match(walk, /\^指令\$/);
  assert.match(PAGE_HELPERS, /function composerModelTrigger/);
  assert.match(PAGE_HELPERS, /选择模型\|select model/);
  assert.match(PAGE_HELPERS, /selectNodeContents/);
});
