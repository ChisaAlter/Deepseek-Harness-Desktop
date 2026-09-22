'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const vendorRoot = path.join(repoRoot, 'vendor', 'deepseek-harness');
const clientRoot = path.join(vendorRoot, 'packages', 'client');

/** Desktop fork packages that own the single visible right panel. */
const DESKTOP_CLIENT_PACKAGES = [
  'ui-agents-panel',
  'ui-diff',
  'ui-files',
  'ui-preview',
  'ui-surfaces',
  'ui-titlebar',
  'ui-user-terminal',
];

function sourceFiles(packageName) {
  const root = path.join(clientRoot, packageName, 'src');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.(ts|tsx)$/.test(entry.name)) found.push(next);
    }
  };
  walk(root);
  return found;
}

function read(relative) {
  return fs.readFileSync(path.join(vendorRoot, relative), 'utf8');
}

test('no desktop package registers a legacy surfaces occupant', () => {
  for (const packageName of DESKTOP_CLIENT_PACKAGES) {
    for (const file of sourceFiles(packageName)) {
      const text = fs.readFileSync(file, 'utf8');
      const relative = path.relative(vendorRoot, file).split(path.sep).join('/');
      assert.equal(
        /slots\.register\(\s*\{\s*name:\s*'surfaces(?:\.|')/.test(text),
        false,
        `${relative} must not register a legacy surfaces occupant`,
      );
      assert.equal(
        /slots\.inject\(\s*'surfaces(?:\.|')/.test(text),
        false,
        `${relative} must not inject into the legacy surfaces track`,
      );
    }
  }
});

test('no desktop package reopens the legacy surfaces track', () => {
  for (const packageName of DESKTOP_CLIENT_PACKAGES) {
    for (const file of sourceFiles(packageName)) {
      const text = fs.readFileSync(file, 'utf8');
      const relative = path.relative(vendorRoot, file).split(path.sep).join('/');
      for (const call of ['openSurfaces(', 'toggleSurfaces(']) {
        // The retired visual shell is kept on disk as dormant upstream code.
        if (relative.includes('/src/client/SurfacesRoot.tsx')) continue;
        if (relative.includes('/src/client/SurfaceTabs.tsx')) continue;
        assert.equal(
          text.includes(call),
          false,
          `${relative} must not call ${call}`,
        );
      }
    }
  }
});

test('ui-surfaces normalizes the legacy width and registers no shell', () => {
  const text = read('packages/client/ui-surfaces/src/client/apply.ts');
  assert.match(text, /ctx\.layout\.closeSurfaces\(\)/);
  assert.doesNotMatch(text, /name:\s*'surfaces'/);
  assert.doesNotMatch(text, /openSurfaces\(\)/);
});

test('titlebar targets the native right Sidebar', () => {
  const apply = read('packages/client/ui-titlebar/src/client/apply.ts');
  const toggles = read('packages/client/ui-titlebar/src/client/PanelToggles.tsx');
  assert.match(apply, /toggleExpanded\(\)/);
  assert.doesNotMatch(apply, /layout\.toggleSurfaces/);
  assert.match(toggles, /rightbarShown/);
});

test('ui-layout forwards rightbarShown to the titlebar owner contract', () => {
  const contract = read('packages/client/ui-layout/src/client/index.ts');
  const frame = read('packages/client/ui-layout/src/client/AppFrame.tsx');
  assert.match(contract, /rightbarShown: boolean/);
  assert.match(frame, /rightbarShown: layoutInfo\.rightbarShown/);
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
