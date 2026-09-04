'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DESKTOP_PACKAGES = [
  { dir: 'packages/client/ui-agents-panel', name: '@deepseek-ai/dsh-client-ui-agents-panel' },
  { dir: 'packages/client/ui-diff', name: '@deepseek-ai/dsh-client-ui-diff' },
  { dir: 'packages/client/ui-files', name: '@deepseek-ai/dsh-client-ui-files' },
  { dir: 'packages/client/ui-git', name: '@deepseek-ai/dsh-client-ui-git' },
  { dir: 'packages/client/ui-message-edit', name: '@deepseek-ai/dsh-client-ui-message-edit' },
  { dir: 'packages/client/ui-preview', name: '@deepseek-ai/dsh-client-ui-preview' },
  { dir: 'packages/client/ui-settings-mcp', name: '@deepseek-ai/dsh-client-ui-settings-mcp' },
  { dir: 'packages/client/ui-settings-remote', name: '@deepseek-ai/dsh-client-ui-settings-remote' },
  { dir: 'packages/client/ui-settings-market', name: '@deepseek-ai/dsh-client-ui-settings-market' },
  { dir: 'packages/client/ui-settings-skills', name: '@deepseek-ai/dsh-client-ui-settings-skills' },
  { dir: 'packages/client/ui-surfaces', name: '@deepseek-ai/dsh-client-ui-surfaces' },
  { dir: 'packages/client/ui-titlebar', name: '@deepseek-ai/dsh-client-ui-titlebar' },
  { dir: 'packages/client/ui-user-terminal', name: '@deepseek-ai/dsh-client-ui-user-terminal' },
  { dir: 'packages/host/mcp-servers', name: '@deepseek-ai/dsh-host-mcp-servers' },
  { dir: 'packages/host/skill-inventory', name: '@deepseek-ai/dsh-host-skill-inventory' },
  { dir: 'packages/llm/llm-vision-fallback', name: '@deepseek-ai/dsh-llm-vision-fallback' },
  { dir: 'packages/mcp/mcp-servers-file', name: '@deepseek-ai/dsh-mcp-servers-file' },
  { dir: 'packages/client/ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
  { dir: 'packages/host/directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
];

const COMPOSITION_ROWS = [
  { file: 'packages/bundle/base/cordis.patch.yml', id: 'llm-vision-fallback', name: '@deepseek-ai/dsh-llm-vision-fallback', configIncludes: ['maxOutputTokens: 2048', 'timeoutMs: 120000'] },
  { file: 'packages/bundle/base/cordis.patch.yml', id: 'mcp-servers-file', name: '@deepseek-ai/dsh-mcp-servers-file' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'directory-picker', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'mcp-servers', name: '@deepseek-ai/dsh-host-mcp-servers' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'skill-inventory', name: '@deepseek-ai/dsh-host-skill-inventory' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-titlebar', name: '@deepseek-ai/dsh-client-ui-titlebar' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-git', name: '@deepseek-ai/dsh-client-ui-git' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-user-terminal', name: '@deepseek-ai/dsh-client-ui-user-terminal' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-surfaces', name: '@deepseek-ai/dsh-client-ui-surfaces' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-files', name: '@deepseek-ai/dsh-client-ui-files' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-diff', name: '@deepseek-ai/dsh-client-ui-diff' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-preview', name: '@deepseek-ai/dsh-client-ui-preview' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-agents-panel', name: '@deepseek-ai/dsh-client-ui-agents-panel' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-settings-remote', name: '@deepseek-ai/dsh-client-ui-settings-remote' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-settings-mcp', name: '@deepseek-ai/dsh-client-ui-settings-mcp' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-settings-skills', name: '@deepseek-ai/dsh-client-ui-settings-skills' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-message-edit', name: '@deepseek-ai/dsh-client-ui-message-edit' },
  { file: 'packages/bundle/web-app/cordis.patch.yml', id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
];

const LAYOUT_MARKERS = ['surfaces', 'shell.titlebar.trailing', 'shell.terminalDrawer'];

// Desktop content inside upstream-owned files. The whole-package registry above
// cannot see these: sync:harness keeps them only via git merge, so a conflict
// resolved towards upstream would drop them without failing any other assert.
const FORK_FILE_MARKERS = [
  // SettingsSelect: official Menu pill for every settings value dropdown.
  { file: 'packages/client/ui-primitives/src/index.ts', includes: ['export { SettingsSelect }'] },
  { file: 'packages/client/ui-settings-mcp/src/client/McpSection.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-skills/src/client/SkillsSection.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-general/src/client/CloseBehaviorRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-general/src/client/AutoStartDesktopRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-general/src/client/HarnessRestartRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-general/src/client/AboutSection.tsx', includes: ['openDshHome'] },
  { file: 'packages/client/locale/src/client/LanguageRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-conversation/src/client/settings/EnterBehaviorRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-permission-presets/src/client/PermissionRow.tsx', includes: ['SettingsSelect'] },
  { file: 'packages/client/ui-settings-models/src/client/models-dev-metadata.ts', includes: ['models.dev'] },
  { file: 'packages/client/ui-settings-models/scripts/live-fetch-enrich-probe.ts', includes: [] },
  // Standing wallpaper fork on the upstream ui-theme package.
  { file: 'packages/client/ui-theme/src/client/WallpaperGalleryModal.tsx', includes: [] },
  { file: 'packages/client/ui-theme/src/client/WallpaperRow.tsx', includes: [] },
  // Composer family width linkage: the drag-resized input card publishes
  // --dsh-composer-resized-width on the seat AND the conversation column (so
  // the transcript sees it); the session stats line, the chat flow column,
  // and the dock cards (queue / todo / goal) consume it so they follow.
  { file: 'packages/client/ui-chat/src/client/chat/StatsLine.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-chat/src/client/chat/ChatView.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/ComposerResizeHandles.tsx', includes: ['data-conversation-scroll'] },
  { file: 'packages/client/ui-conversation/src/client/queue/QueueDock.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-goal/src/client/GoalBar.module.css', includes: ['dsh-composer-resized-width'] },
  { file: 'packages/client/ui-theme/src/wallpaper.ts', includes: ['TRANSPARENT_ATTR', 'data-dsh-transparent'] },
  { file: 'packages/client/ui-theme/src/styles/wallpaper.css', includes: ['html[data-dsh-transparent]'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css', includes: [':not([data-dsh-transparent])'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx', includes: ['data-composer-beam'] },
  { file: 'packages/client/ui-chat/src/client/chat/StatsLine.tsx', includes: ['data-stats-line'] },
  // No-directory sessions (docs/features/no-directory-sessions.md): the Host
  // advertises the scratch cwd on the Workspace baseline, registering a
  // directory re-adopts its sessions, the hero picker offers "No workspace
  // folder", and the sidebar lists only Workspace members plus scratch tasks.
  { file: 'packages/api/workspace-controller/src/types.ts', includes: ['scratchCwd'] },
  { file: 'packages/api/workspace-controller/src/index.ts', includes: ['scratchWorkspaceCwd', "'no-workspace'"] },
  { file: 'packages/api/workspace-controller/src/client/model.ts', includes: ['scratchCwd'] },
  { file: 'packages/workspace/workspace/src/index.ts', includes: ['readoptableSessionIds'] },
  { file: 'packages/client/ui-workspace/src/client/navigation.ts', includes: ['connectNoDirectory', 'deleteWorkspace', 'scratchCwd'] },
  { file: 'packages/client/ui-workspace/src/client/tree.ts', includes: ['isNoDirectorySession', 'currentGroupKey'] },
  { file: 'packages/client/ui-workspace/src/client/WorkspacePicker.tsx', includes: ['NO_DIRECTORY', 'onPickNoDirectory'] },
  { file: 'packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx', includes: ['TasksSectionHeader', 'connectNoDirectory', 'GroupSessionRun'] },
  { file: 'packages/client/ui-workspace/src/client/locales.ts', includes: ['menu.noDirectory'], excludes: ['Ungrouped'] },
  { file: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx', includes: ['selectNoDirectory', 'noDirectorySession'] },
  { file: 'packages/client/ui-conversation/src/client/apply.ts', includes: ['selectNoDirectory', 'connectNoDirectory'] },
  { file: 'packages/client/ui-conversation/src/client/locales.ts', includes: ['hero.noDirectory'] },
  // Desktop launcher recovery flag on the upstream CLI args parser.
  { file: 'apps/cli/src/args.ts', includes: ['skip-user-plugins'] },
  { file: 'apps/cli/src/dump-config.ts', includes: ['skipUserPlugins'] },
  { file: 'tsconfig.host.json', includes: ['packages/host/mcp-servers', 'packages/host/skill-inventory', 'packages/llm/llm-vision-fallback', 'packages/mcp/mcp-servers-file'] },
  { file: 'packages/api/workspace-controller/tsconfig.host.json', includes: ['../../util/home-paths'] },
  { file: 'packages/api/workspace-controller/package.json', includes: ['@deepseek-ai/dsh-home-paths'] },
  { file: 'tsconfig.base.json', includes: ['dsh-host-mcp-servers', 'dsh-host-skill-inventory', 'dsh-llm-vision-fallback', 'dsh-mcp-servers-file'] },
  // Desktop composition carries the browse rows in the shipped base, so the
  // upstream preset e2e must re-insert only the host row.
  { file: 'apps/cli/tests/web-agent-presets.e2e.ts', includes: ["{ id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' }"] },
  // Desktop-forked settings e2e drivers (SettingsSelect menus, section
  // navigation, zh boot copy, RPC interception).
  { file: 'apps/web/tests/settings-chrome.e2e.ts', includes: ['正在加载插件'] },
  // Desktop fork: the shipped web-app composition carries the browse rows, so
  // the scaffold's upstream -auto disable+insert pair must stay removed (it
  // duplicates the shipped client browse row and fails every boot sweep).
  // Right-column empty-state picker: square tiles (docs/design-language.md,
  // Layout paragraph). Upstream ships horizontal strips; keep the tile
  // geometry so a sync resolved towards upstream cannot silently revert it.
  { file: 'packages/client/ui-surfaces/src/client/EmptyState.module.css', includes: ['max-width: 320px', 'aspect-ratio: 1 / 1'] },
  { file: 'apps/web/tests/scaffold.ts', excludes: ['directory-picker-browse'] },
  { file: 'apps/web/tests/models-settings.e2e.ts', includes: ['llm.discoverModels'] },
  // Desktop fork: input.dock panels follow the drag-resized composer card.
  { file: 'apps/web/tests/composer-resize-dock.e2e.ts', includes: ['input.dock panels follow the composer drag width'] },
  // The composer-width e2e driver is host-plane; keep it out of the
  // client-registered apps/web tsc program so the phantom rootDir chain
  // (scaffold → dsh-session-snapshot → loader-smoke) cannot break build:lib.
  { file: 'apps/web/tsconfig.json', includes: ['composer-resize-dock.e2e.ts'] },
  // Session log download lives in the desktop titlebar capsule, never in the conversation header.
  { file: 'apps/web/tests/snapshots/agent-preset-selection/header.expected.md', excludes: ['button "Session log"'] },
  { file: 'package.json', includes: ['copy-ghostty-assets.mjs'] },
];

function readRel(vendorRoot, rel) {
  return fs.readFileSync(path.join(vendorRoot, ...rel.split('/')), 'utf8');
}

function rowBlock(text, id) {
  const pattern = new RegExp(`^\\s*- id: ${id}\\s*$`, 'm');
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }
  const start = match.index;
  const after = text.slice(start + match[0].length);
  const next = after.search(/^\s*- id:/m);
  return text.slice(start, start + match[0].length + (next === -1 ? after.length : next));
}

/**
 * @param {string} vendorRoot
 * @param {string} npmVersion
 */
function assertDesktopForks(vendorRoot, npmVersion) {
  const missing = [];
  const webApp = JSON.parse(readRel(vendorRoot, 'packages/bundle/web-app/package.json'));
  const baseApp = JSON.parse(readRel(vendorRoot, 'packages/bundle/base/package.json'));
  const deps = {
    ...baseApp.dependencies,
    ...baseApp.devDependencies,
    ...webApp.dependencies,
    ...webApp.devDependencies,
  };
  const clientTsconfig = readRel(vendorRoot, 'tsconfig.client.json');
  const layout = readRel(vendorRoot, 'packages/client/ui-layout/src/client/index.ts');
  const scoped = readRel(vendorRoot, 'packages/client/ui-renderer/src/client/scoped-slots.tsx');

  for (const pkg of DESKTOP_PACKAGES) {
    const manifestPath = path.join(vendorRoot, ...pkg.dir.split('/'), 'package.json');
    if (!fs.existsSync(manifestPath)) {
      missing.push(pkg.dir);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== pkg.name) {
      throw new Error(`${pkg.dir} name is ${manifest.name}, expected ${pkg.name}`);
    }
    if (manifest.version !== npmVersion) {
      throw new Error(`${pkg.dir} version is ${manifest.version}, expected ${npmVersion}`);
    }
    if (!deps[pkg.name]) {
      throw new Error(`bundle package.json is missing ${pkg.name}`);
    }
    if (pkg.dir.startsWith('packages/client/') && !clientTsconfig.includes(`./${pkg.dir}`)) {
      throw new Error(`tsconfig.client.json is missing ${pkg.dir}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`missing desktop packages: ${missing.join(', ')}`);
  }

  const files = new Map();
  for (const row of COMPOSITION_ROWS) {
    if (!files.has(row.file)) {
      files.set(row.file, readRel(vendorRoot, row.file));
    }
    const block = rowBlock(files.get(row.file), row.id);
    if (!block) {
      throw new Error(`${row.file} is missing composition id ${row.id}`);
    }
    if (!block.includes(row.name)) {
      throw new Error(`${row.file} id ${row.id} does not name ${row.name}`);
    }
    for (const snippet of row.configIncludes || []) {
      if (!block.includes(snippet)) {
        throw new Error(`${row.file} id ${row.id} is missing ${snippet}`);
      }
    }
  }

  for (const marker of LAYOUT_MARKERS) {
    if (!layout.includes(marker)) {
      throw new Error(`ui-layout is missing ${marker}`);
    }
  }
  if (!scoped.includes('session-maybe') || !scoped.includes("{ key: '' }")) {
    throw new Error('scoped-slots.tsx no longer binds session-maybe to an empty string');
  }

  for (const marker of FORK_FILE_MARKERS) {
    const text = readRel(vendorRoot, marker.file);
    for (const snippet of marker.includes || []) {
      if (!text.includes(snippet)) {
        throw new Error(`${marker.file} no longer contains ${JSON.stringify(snippet)}`);
      }
    }
    for (const snippet of marker.excludes || []) {
      if (text.includes(snippet)) {
        throw new Error(`${marker.file} must not contain ${JSON.stringify(snippet)}`);
      }
    }
  }
}

module.exports = {
  DESKTOP_PACKAGES,
  COMPOSITION_ROWS,
  FORK_FILE_MARKERS,
  assertDesktopForks,
};
