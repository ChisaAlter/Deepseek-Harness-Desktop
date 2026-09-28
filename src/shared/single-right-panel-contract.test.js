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

test('DSHD renders one right-panel host and no legacy column', () => {
  const frame = read('packages/client/ui-layout/src/client/AppFrame.tsx');
  const adapter = read('packages/client/ui-surfaces/src/client/apply.ts');
  assert.ok(frame.includes("renderSlot('rightbar'"));
  assert.ok(!frame.includes("renderSlot('surfaces'"));
  assert.ok(!adapter.includes("name: 'surfaces'"));
  assert.ok(adapter.includes('openWorkspaceSurface'));
  assert.ok(adapter.includes('openResourceIn'));
  assert.ok(adapter.includes('openTabIn'));
});

test('opening content never switches right-panel containers', () => {
  const adapter = read('packages/client/ui-surfaces/src/client/apply.ts');
  const native = read('packages/client/ui-sidebar-right/src/client/index.ts');
  const seat = read('packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx');
  assert.ok(!adapter.includes('collapseRightPanel'));
  assert.ok(!native.includes('layout.closeSurfaces()'));
  assert.ok(!seat.includes('restoreClassic'));
});

test('titlebar reads and toggles the sole panel owner', () => {
  const apply = read('packages/client/ui-titlebar/src/client/apply.ts');
  const toggles = read('packages/client/ui-titlebar/src/client/PanelToggles.tsx');
  assert.ok(apply.includes('toggleExpanded()'));
  assert.ok(!apply.includes('layout.toggleSurfaces()'));
  assert.ok(toggles.includes('const surfacesOpen = rightbarShown'));
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

test('the guide opens content inside its own tab owner', () => {
  const guide = read('packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx');
  assert.ok(guide.includes('useGuideEntries'));
  assert.ok(guide.includes('tab.actions.openTab(selected.kind, { replaceTab: true })'));
});

test('document preview exposes the generic toolbar action seam', () => {
  const contract = read('packages/client/ui-sidebar-documentpreview/src/client/document/actions.ts');
  const textPreview = read('packages/client/ui-sidebar-documentpreview/src/client/TextPreview.tsx');
  assert.match(contract, /'sidebar\.right\.tab\.document\.actions'/);
  assert.match(textPreview, /renderSlot\('sidebar\.right\.tab\.document\.actions'/);
});
