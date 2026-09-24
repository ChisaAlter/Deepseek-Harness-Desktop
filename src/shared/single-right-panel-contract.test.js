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

test('DSHD registers its classic right-panel shell and work surfaces', () => {
  const text = read('packages/client/ui-surfaces/src/client/apply.ts');
  assert.match(text, /name:\s*'surfaces'/);
  assert.match(text, /createSurfacesStore/);
  assert.match(text, /SurfacesRoot/);
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

test('the classic and native right panels hand off visibility', () => {
  const classic = read('packages/client/ui-surfaces/src/client/apply.ts');
  const native = read('packages/client/ui-sidebar-right/src/client/index.ts');
  const seat = read('packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx');
  assert.match(classic, /native\?\.isExpanded\(\)/);
  assert.match(classic, /native\.toggleExpanded\(\)/);
  assert.match(classic, /ctx\.layout\.openSurfaces\(\)/);
  assert.match(native, /layout\.closeSurfaces\(\)/);
  assert.match(seat, /restoreClassic/);
});

test('titlebar targets the DSHD surfaces track', () => {
  const apply = read('packages/client/ui-titlebar/src/client/apply.ts');
  const toggles = read('packages/client/ui-titlebar/src/client/PanelToggles.tsx');
  assert.match(apply, /layout\.toggleSurfaces\(\)/);
  assert.match(toggles, /surfaces > 0/);
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

test('document preview exposes the generic toolbar action seam', () => {
  const contract = read('packages/client/ui-sidebar-documentpreview/src/client/document/actions.ts');
  const textPreview = read('packages/client/ui-sidebar-documentpreview/src/client/TextPreview.tsx');
  assert.match(contract, /'sidebar\.right\.tab\.document\.actions'/);
  assert.match(textPreview, /renderSlot\('sidebar\.right\.tab\.document\.actions'/);
});
