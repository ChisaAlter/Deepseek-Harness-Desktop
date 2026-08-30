'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const VENDOR = path.join(ROOT, 'vendor', 'deepseek-harness');

function readRel(base, rel) {
  return fs.readFileSync(path.join(base, ...rel.split('/')), 'utf8');
}

const UI_FEATURES = [
  {
    name: 'four-column AppFrame',
    file: 'packages/client/ui-layout/src/client/AppFrame.tsx',
    includes: ['four-column'],
  },
  {
    name: 'titlebar Git and panel toggles',
    file: 'packages/client/ui-titlebar/src/client/apply.ts',
    includes: ['shell.titlebar.trailing'],
  },
  {
    name: 'surfaces empty five-card grid',
    file: 'packages/client/ui-surfaces/src/client/EmptyState.tsx',
    includes: ['data-surfaces-empty', 'card.browser', 'card.files', 'card.diff', 'card.agents'],
  },
  {
    name: 'surfaces work-loop tabs',
    file: 'packages/client/ui-surfaces/src/client/SurfaceTabs.tsx',
    includes: ['data-surfaces-tabs', "t('tab.close')"],
  },
  {
    name: 'Files search work loop',
    file: 'packages/client/ui-files/src/client/FilesPanel.tsx',
    includes: ['data-files-panel', "t('search')"],
  },
  {
    name: 'Files composer mention MIME',
    file: 'packages/client/ui-files/src/client/composerMention.ts',
    includes: ["'application/x-dshd-composer-mention'"],
  },
  {
    name: 'InputBar has no local $ skill menu',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    excludes: ['listSkillNames', 'skillMenu'],
  },
  {
    name: 'InputBar mention drop',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    includes: ['application/x-dshd-composer-mention'],
  },
  {
    name: 'dshbot composer chrome hide',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    includes: ["agentPreset === 'dshbot-room'", "origin === 'dshbot'"],
  },
  {
    name: 'transparent theme attr',
    file: 'packages/client/ui-theme/src/wallpaper.ts',
    includes: ["export const TRANSPARENT_ATTR = 'data-dsh-transparent'"],
  },
  {
    name: 'transparent wallpaper mask branch',
    file: 'packages/client/ui-theme/src/styles/wallpaper.css',
    includes: ['html[data-dsh-transparent] #dsh-wallpaper::after'],
  },
  {
    name: 'transparent composer seat gate',
    file: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css',
    includes: [':not([data-dsh-transparent])'],
  },
  {
    name: 'composer beam layer',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    includes: ['data-composer-beam'],
  },
  {
    name: 'StatsLine running row state',
    file: 'packages/client/ui-conversation/src/client/chat/StatsLine.tsx',
    includes: ['data-stats-line'],
  },
  {
    name: 'Appearance wallpaper pick/browse row',
    file: 'packages/client/ui-theme/src/client/WallpaperRow.tsx',
    includes: ["t('wallpaper.choose')", "t('wallpaper.browse')"],
    excludes: ["t('wallpaper.catalogUrls')"],
  },
  {
    name: 'gallery sources live in the browse window',
    file: 'packages/client/ui-theme/src/client/WallpaperGalleryModal.tsx',
    includes: ['WallpaperSources', "t('wallpaper.browse')", "t('wallpaper.sources')"],
  },
  {
    name: 'terminal drawer occupant',
    file: 'packages/client/ui-user-terminal/src/client/apply.ts',
    includes: ['shell.terminalDrawer'],
  },
  {
    name: 'rc.8 composer attachment slot',
    file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx',
    includes: ["'conversation.input.attachments'"],
  },
  {
    name: 'Agents surface',
    file: 'packages/client/ui-agents-panel/src/client/AgentsPanel.tsx',
    includes: ['data-agents-panel'],
  },
  {
    name: 'Diff surface',
    file: 'packages/client/ui-diff/src/client/DiffPanel.tsx',
    includes: ['data-diff-panel'],
  },
  {
    name: 'Browser preview surface',
    file: 'packages/client/ui-preview/src/client/PreviewPanel.tsx',
    includes: ['data-preview-panel'],
  },
  {
    name: 'titlebar Git actions',
    file: 'packages/client/ui-git/src/client/locales.ts',
    includes: ["'menu.options': 'Git actions'", "'branch.open': 'Switch branch'"],
  },
  {
    name: 'MCP settings page',
    file: 'packages/client/ui-settings-mcp/src/client/locales.ts',
    includes: ["title: 'MCP servers'"],
  },
  {
    name: 'Skills settings page',
    file: 'packages/client/ui-settings-skills/src/client/locales.ts',
    includes: ["title: 'Skills'"],
  },
  {
    name: 'message edit action',
    file: 'packages/client/ui-message-edit/src/client/MessageEditAction.tsx',
    includes: ['startEdit'],
  },
  {
    name: 'in-app directory picker',
    file: 'packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.tsx',
    includes: ['DirectoryBrowser'],
  },
  {
    name: 'assembled post-merge web e2e',
    file: 'apps/web/tests/post-merge-desktop-ui.e2e.ts',
    includes: ['post-merge assembled desktop UI', 'Mention in composer', 'Browse gallery', 'composerDraft.inputValue()', 'data-source="path"'],
  },
  {
    name: 'Files draft uses ctx.get sessions',
    file: 'packages/client/ui-files/src/client/draft.ts',
    includes: ["ctx.get('sessions')"],
    excludes: ['ctx.sessions'],
  },
  {
    name: 'preview draft uses ctx.get sessions',
    file: 'packages/client/ui-preview/src/client/draft.ts',
    includes: ["ctx.get('sessions')"],
    excludes: ['ctx.sessions'],
  },
  {
    name: 'terminal draft uses ctx.get sessions',
    file: 'packages/client/ui-user-terminal/src/client/draft.ts',
    includes: ["ctx.get('sessions')"],
    excludes: ['ctx.sessions'],
  },
  {
    name: 'ui-files apply has no path trigger registration',
    file: 'packages/client/ui-files/src/client/apply.ts',
    excludes: ['createPathTriggerSource', 'inputTriggers', "name: 'path'"],
  },
  {
    name: 'web-app loads ui-settings-remote',
    file: 'packages/bundle/web-app/cordis.patch.yml',
    includes: ['- id: ui-settings-remote', "'@deepseek-ai/dsh-client-ui-settings-remote'"],
    excludes: ['# - id: ui-settings-remote'],
  },
];

test('post-merge UI features remain in the vendor tree', () => {
  const missing = [];
  for (const feature of UI_FEATURES) {
    const source = readRel(VENDOR, feature.file);
    for (const snippet of feature.includes || []) {
      if (!source.includes(snippet)) {
        missing.push(`${feature.name}: missing ${snippet} in ${feature.file}`);
      }
    }
    for (const snippet of feature.excludes || []) {
      if (source.includes(snippet)) {
        missing.push(`${feature.name}: unexpected ${snippet} in ${feature.file}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('desktop path and local $ trigger modules stay deleted', () => {
  const gone = [
    'packages/client/ui-files/src/client/pathTrigger.ts',
    'packages/client/ui-files/tests/path-trigger.client.spec.ts',
    'packages/client/ui-conversation/src/client/composerTrigger.ts',
    'packages/client/ui-conversation/tests/composer-trigger.spec.ts',
  ];
  for (const rel of gone) {
    assert.equal(
      fs.existsSync(path.join(VENDOR, ...rel.split('/'))),
      false,
      `expected deleted: ${rel}`,
    );
  }
});

test('main process boots the ChisaCode remote face (RemoteGateway retired)', () => {
  const index = readRel(ROOT, 'src/main/index.js');
  assert.match(index, /new ChisaCodeRemote/);
  assert.doesNotMatch(index, /new RemoteGateway/);
  assert.doesNotMatch(index, /createDisabledRemote/);
});

test('dshbot plugin remains outside the vendor prefix', () => {
  const manifest = JSON.parse(readRel(ROOT, 'vendor/dshbot/package.json'));
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length > 0);
});
