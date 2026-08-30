'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DESKTOP_PACKAGES,
  COMPOSITION_ROWS,
  FORK_FILE_MARKERS,
  assertDesktopForks,
} = require('./harness-desktop-forks');

function writeFile(root, rel, content) {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function makeFixture(t, npmVersion = '0.1.0-rc.5') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-forks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deps = {};
  const clientRefs = [];
  for (const pkg of DESKTOP_PACKAGES) {
    writeFile(root, `${pkg.dir}/package.json`, `${JSON.stringify({ name: pkg.name, version: npmVersion }, null, 2)}\n`);
    deps[pkg.name] = 'workspace:^';
    if (pkg.dir.startsWith('packages/client/')) {
      clientRefs.push(`    { "path": "./${pkg.dir}" }`);
    }
  }
  writeFile(root, 'packages/bundle/web-app/package.json', `${JSON.stringify({ dependencies: deps }, null, 2)}\n`);
  writeFile(root, 'packages/bundle/base/package.json', `${JSON.stringify({ dependencies: deps }, null, 2)}\n`);
  writeFile(root, 'tsconfig.client.json', `{\n  "references": [\n${clientRefs.join(',\n')}\n  ]\n}\n`);
  writeFile(root, 'packages/bundle/base/cordis.patch.yml', [
    '- insert:',
    '    - id: llm-vision-fallback',
    "      name: '@deepseek-ai/dsh-llm-vision-fallback'",
    '      config:',
    '        maxOutputTokens: 2048',
    '        timeoutMs: 120000',
    '    - id: mcp-servers-file',
    "      name: '@deepseek-ai/dsh-mcp-servers-file'",
    '',
  ].join('\n'));
  const webRows = COMPOSITION_ROWS
    .filter((row) => row.file === 'packages/bundle/web-app/cordis.patch.yml')
    .map((row) => `    - id: ${row.id}\n      name: '${row.name}'`)
    .join('\n');
  writeFile(root, 'packages/bundle/web-app/cordis.patch.yml', `- insert:\n${webRows}\n`);
  writeFile(root, 'packages/client/ui-layout/src/client/index.ts', [
    "    'surfaces': { kind: 'single', scope: 'session-maybe' },",
    "    'shell.titlebar.trailing': { kind: 'list', scope: 'root' },",
    "    'shell.terminalDrawer': { kind: 'single', scope: 'session-maybe' },",
    '',
  ].join('\n'));
  writeFile(root, 'packages/client/ui-renderer/src/client/scoped-slots.tsx', [
    "  const store = host.storeOf(entry, scope === 'session-maybe' && scopeKey === undefined ? '' : scopeKey)",
    '',
  ].join('\n'));
  for (const marker of FORK_FILE_MARKERS) {
    const content = {
      'packages/client/ui-primitives/src/index.ts': "export { SettingsSelect } from './SettingsSelect.tsx'\n",
      'packages/client/ui-settings-mcp/src/client/McpSection.tsx': 'export const editor = () => <SettingsSelect variant="block" />\n',
      'packages/client/ui-settings-skills/src/client/SkillsSection.tsx': 'export const filter = () => <SettingsSelect aria-label="source" />\n',
      'packages/client/ui-settings-general/src/client/CloseBehaviorRow.tsx': 'export const close = () => <SettingsSelect aria-label="close" />\n',
      'packages/client/ui-settings-general/src/client/AutoStartDesktopRow.tsx': 'export const autoStart = () => <SettingsSelect aria-label="auto-start" />\n',
      'packages/client/ui-settings-general/src/client/HarnessRestartRow.tsx': 'export const restart = () => <SettingsSelect aria-label="restart" />\n',
      'packages/client/ui-settings-general/src/client/AboutSection.tsx': 'export function AboutSection() { return shell.openDshHome() }\n',
      'packages/client/locale/src/client/LanguageRow.tsx': 'export const language = () => <SettingsSelect aria-label="language" />\n',
      'packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx': 'export const enter = () => <SettingsSelect aria-label="enter" />\n',
      'packages/client/ui-permission-presets/src/client/PermissionRow.tsx': 'export const permission = () => <SettingsSelect aria-label="permission" />\n',
      'packages/client/ui-settings-models/src/client/models-dev-metadata.ts': 'export const MODELS_DEV_URL = "https://models.dev/api.json"\n',
      'packages/client/ui-settings-models/scripts/live-fetch-enrich-probe.ts': '// live probe\n',
      'packages/client/ui-theme/src/client/WallpaperGalleryModal.tsx': 'export const gallery = () => null\n',
      'packages/client/ui-theme/src/client/WallpaperRow.tsx': 'export const row = () => null\n',
      'packages/client/ui-theme/src/wallpaper.ts': "export const TRANSPARENT_ATTR = 'data-dsh-transparent'\n",
      'packages/client/ui-theme/src/styles/wallpaper.css': 'html[data-dsh-transparent] #dsh-wallpaper::after { background: transparent }\n',
      'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css': ':global(html[data-dsh-wallpaper]:not([data-dsh-transparent])) .composerSeat {}\n',
      'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx': '<div data-composer-beam="" />\n',
      'packages/client/ui-conversation/src/client/chat/StatsLine.tsx': '<div data-stats-line={rowState} />\n',
      'apps/cli/src/args.ts': "program.option('--skip-user-plugins', 'boot the shipped bundle template')\n",
      'apps/cli/tests/web-agent-presets.e2e.ts': "    { insert: [\n      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },\n    ] },\n",
      'apps/web/tests/settings-chrome.e2e.ts': "const loading = page.getByText(/正在加载插件/)\n",
      'apps/web/tests/models-settings.e2e.ts': "await page.route('**/api/llm.discoverModels', async (route) => {\n",
      'apps/web/tests/snapshots/agent-preset-selection/header.expected.md': '- navigation "Session hierarchy"\n',
      'package.json': '"build:lib:client": "node packages/client/ui-user-terminal/scripts/copy-ghostty-assets.mjs"\n',
    };
    writeFile(root, marker.file, content[marker.file] ?? 'export {}\n');
  }
  return root;
}

test('assertDesktopForks accepts a complete fixture', (t) => {
  const root = makeFixture(t);
  assert.doesNotThrow(() => assertDesktopForks(root, '0.1.0-rc.5'));
});

test('assertDesktopForks throws when ui-titlebar is missing', (t) => {
  const root = makeFixture(t);
  fs.rmSync(path.join(root, 'packages', 'client', 'ui-titlebar'), { recursive: true, force: true });
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /ui-titlebar/);
});

test('assertDesktopForks throws when a parked fork marker regresses', (t) => {
  const root = makeFixture(t);
  const indexPath = path.join(root, ...'packages/client/ui-primitives/src/index.ts'.split('/'));
  fs.writeFileSync(indexPath, "export { Button } from './Button.tsx'\n");
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /SettingsSelect/);
});

test('assertDesktopForks throws when the header golden regains Session log', (t) => {
  const root = makeFixture(t);
  const goldenPath = path.join(root, ...'apps/web/tests/snapshots/agent-preset-selection/header.expected.md'.split('/'));
  fs.writeFileSync(goldenPath, '- button "Session log"\n');
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /Session log/);
});

test('assertDesktopForks throws when transparent theme markers drop', (t) => {
  const root = makeFixture(t);
  const wallpaperPath = path.join(root, ...'packages/client/ui-theme/src/wallpaper.ts'.split('/'));
  fs.writeFileSync(wallpaperPath, 'export const WALLPAPER_ATTR = "data-dsh-wallpaper"\n');
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /TRANSPARENT_ATTR|data-dsh-transparent/);
});

test('assertDesktopForks throws when copy-ghostty-assets drops out of package.json', (t) => {
  const root = makeFixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  assert.throws(() => assertDesktopForks(root, '0.1.0-rc.5'), /copy-ghostty-assets/);
});

test('assertDesktopForks accepts the current vendor tree at rc.1', () => {
  const vendor = path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness');
  assertDesktopForks(vendor, '0.1.1-rc.1');
});
