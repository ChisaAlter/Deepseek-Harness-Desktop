'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const vendorRoot = path.join(repoRoot, 'vendor', 'deepseek-harness');

function read(relative) {
  return fs.readFileSync(path.join(vendorRoot, relative), 'utf8');
}

test('DSHD mounts the classic surfaces track under a real host', () => {
  const text = read('packages/client/ui-surfaces/src/client/apply.ts');
  // Classic track: the seat tree is declared and the host is the real
  // SurfacesRoot shell (tab strip + EmptyState picker + occupants), never a
  // null host.
  assert.match(text, /name:\s*'surfaces'/);
  assert.match(text, /createSurfacesStore/);
  assert.match(text, /SurfacesRoot/);
  assert.doesNotMatch(text, /SurfacesGone/);
  for (const [pkg, slot] of [
    ['ui-files', 'files'],
    ['ui-preview', 'browser'],
    ['ui-user-terminal', 'terminal'],
    ['ui-diff', 'diff'],
    ['ui-agents-panel', 'agents'],
  ]) {
    assert.match(read(`packages/client/${pkg}/src/client/apply.ts`), new RegExp(`surfaces\\.${slot}`));
  }
});

test('every open path routes into the classic surfaces track', () => {
  const classic = read('packages/client/ui-surfaces/src/client/apply.ts');
  const native = read('packages/client/ui-sidebar-right/src/client/index.ts');
  const seat = read('packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx');
  // Open-path surfaces mount inside the classic column via the store verbs
  // captured from the host's inject callback, and always expand the classic
  // track through ctx.layout.openSurfaces().
  assert.match(classic, /openClassicSurfaces/);
  assert.match(classic, /ctx\.layout\.openSurfaces\(\)/);
  assert.doesNotMatch(classic, /expandRightPanel/);
  // Office documents keep their native document-preview exemption
  // (openOfficeDocument → sidebar.openResourceIn); that seam is asserted
  // separately below by the office markers.
  // Opening the classic track collapses the native dock, and the native dock
  // still sweeps the classic track when it expands — only one right column is
  // visible at a time.
  assert.match(classic, /collapseRightPanel/);
  assert.match(native, /layout\.closeSurfaces\(\)/);
  assert.match(seat, /restoreClassic/);
  // Seat writers are captured per binding key (inject is memoized per
  // binding object, so a single live slot stales on session revisit), and
  // ownership is judged against the main-view session — a foreign-session
  // request never writes through the mounted seat's bucket.
  assert.match(classic, /actionsBySeat/);
  assert.match(classic, /currentSessionId/);
});

test('titlebar toggles the classic surfaces track', () => {
  const apply = read('packages/client/ui-titlebar/src/client/apply.ts');
  const toggles = read('packages/client/ui-titlebar/src/client/PanelToggles.tsx');
  assert.match(apply, /layout\.toggleSurfaces\(\)/);
  assert.match(toggles, /isSurfacesShortcut/);
  assert.match(toggles, /surfaces\s*>\s*0/);
  assert.doesNotMatch(toggles, /rightbarShown/);
});

test('ui-layout forwards surfaces width to the titlebar owner contract', () => {
  const contract = read('packages/client/ui-layout/src/client/index.ts');
  const frame = read('packages/client/ui-layout/src/client/AppFrame.tsx');
  assert.match(contract, /surfaces: number/);
  assert.match(frame, /surfaces: layoutInfo\.surfaces/);
});

test('desktop providers register native right Sidebar types', () => {
  for (const [file, kindConstant] of [
    ['packages/client/ui-preview/src/client/apply.ts', 'BROWSER_KIND'],
    ['packages/client/ui-diff/src/client/apply.ts', 'DIFF_KIND'],
    ['packages/client/ui-agents-panel/src/client/apply.ts', 'AGENTS_KIND'],
  ]) {
    const text = read(file);
    assert.match(text, /sidebarRightTabs\.register|tabs\.register/, `${file} must register a Sidebar type`);
    assert.match(text, new RegExp(`kind:\\s*${kindConstant}`), `${file} must register kind ${kindConstant}`);
  }
  assert.match(read('packages/client/ui-files/src/client/apply.ts'), /sidebar\.right\.tab\.document\.actions/);
});

test('preview delivery is tagged by the originating session', () => {
  const panel = read('packages/client/ui-preview/src/client/PreviewPanel.tsx');
  // The panel's identity is its own seat session, not the derived main view.
  assert.match(panel, /sessionId\?:\s*string \| undefined/);
  assert.match(panel, /detail\?\.sessionId !== undefined && detail\.sessionId !== sessionId/);
  assert.match(panel, /PENDING_PREVIEW_SESSION_KEY/);
  // Every pending-preview writer stamps the session tag next to the URL.
  for (const file of [
    'packages/client/ui-surfaces/src/client/apply.ts',
    'packages/client/ui-user-terminal/src/client/apply.ts',
    'packages/client/ui-chat/src/client/apply.ts',
  ]) {
    assert.match(read(file), /dshd-pending-preview-session/, `${file} must tag the pending preview session`);
  }
});

test('the surfaces empty state mirrors the native dock guide registry', () => {
  const classic = read('packages/client/ui-surfaces/src/client/apply.ts');
  const empty = read('packages/client/ui-surfaces/src/client/EmptyState.tsx');
  const root = read('packages/client/ui-surfaces/src/client/SurfacesRoot.tsx');
  // The entry inventory has one source of truth: the grid lists the
  // sidebarRightTabs registry's guide() entries and opens them through
  // sidebarRight.openTabIn into the native dock — never a second hard-coded
  // card list.
  assert.match(classic, /sidebarRightTabs/);
  assert.match(classic, /registry\.guide\(\)/);
  assert.match(classic, /openTabIn/);
  assert.match(empty, /SidebarRightGuideBox/);
  assert.match(root, /useSyncExternalStore/);
});

test('document preview exposes the generic toolbar action seam', () => {
  const contract = read('packages/client/ui-sidebar-documentpreview/src/client/document/actions.ts');
  const textPreview = read('packages/client/ui-sidebar-documentpreview/src/client/TextPreview.tsx');
  assert.match(contract, /'sidebar\.right\.tab\.document\.actions'/);
  assert.match(textPreview, /renderSlot\('sidebar\.right\.tab\.document\.actions'/);
});
