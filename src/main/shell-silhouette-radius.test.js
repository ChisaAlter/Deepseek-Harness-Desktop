const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const inject = read('main/harness-chrome-inject.js');
const boot = read('renderer/boot.css');
const launcher = read('renderer/launcher.css');
const scrim = read('renderer/update-dialog.css');
const themeTokens = read('../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css');
const frameRadius = themeTokens.match(/--dsw-radius-xl:\s*([^;]+);/)?.[1];
assert.equal(frameRadius, '20px');
const resolveFrameRadius = (css) => css.replaceAll('var(--dsw-radius-xl)', frameRadius);
const frameModule = resolveFrameRadius(read('../vendor/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.module.css'));
const chrome = read('main/chrome.js');
const updateOverlay = read('main/update-overlay.js');
const live2d = read('main/desktop-live2d.js');

// The transparent windows draw their own rounded silhouette; every layer that
// paints the outer edge must share the one radius (design-language 外框圆角 20)
// or the windows drift apart again. Maximized windows drop the radius to 0.
// The layers inside the harness page also pin corner-shape: round — the
// client-wide superellipse(1.5) would otherwise pull the shell corner tight.
test('the injected chrome exposes one shared silhouette radius', () => {
  assert.match(inject, /const FRAME_RADIUS = 20;/);
  const rules = {
    body: /(?:^|[,{\n]\s*)body\s*\{([\s\S]*?position:\s*relative[\s\S]*?)\n\s*\}/,
    canvas: /#\$\{FRAME_CANVAS_ID\}\s*\{([\s\S]*?)\n\s*\}/,
    wallpaper: /#dsh-wallpaper\s*\{([\s\S]*?)\n\s*\}/,
    ring: /#\$\{FRAME_RING_ID\}\s*\{([\s\S]*?)\n\s*\}/,
  };
  for (const [layer, re] of Object.entries(rules)) {
    const block = inject.match(re);
    assert.ok(block, `${layer} rule`);
    assert.match(block[1], /border-radius:\s*\$\{FRAME_RADIUS\}px/, `${layer} radius`);
    assert.match(block[1], /corner-shape:\s*round/, `${layer} corner-shape`);
  }
});

test('boot page silhouette layers use the shared radius and zero out maximized', () => {
  assert.match(boot, /body\s*\{[^}]*border-radius:\s*20px/);
  assert.match(boot, /\.scene\s*\{[^}]*border-radius:\s*20px/);
  assert.match(boot, /html\[data-window-maximized\][^}]*\.scene[^}]*border-radius:\s*0/);
});

test('launcher shell uses the shared radius, the l2 edge ring, and zeroes out maximized', () => {
  assert.match(launcher, /\.shell\s*\{[^}]*border-radius:\s*20px/);
  assert.match(launcher, /\.shell\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--dsw-alias-border-l2\)/);
  assert.match(launcher, /html\[data-window-maximized\]\s*\.shell\s*\{[^}]*border-radius:\s*0/);
});

// Windows 11's DWM corner mask (roundedCorners default) cuts a ~8px arc over
// the page-painted silhouette — the two curves meeting reads as a stair-stepped
// edge, and the mask is not alpha-blended on transparent windows. Every
// transparent window that draws its own silhouette or must reach the window
// edge opts out; welcome keeps OS rounding (it paints no silhouette).
test('transparent silhouette windows opt out of the OS corner mask', () => {
  assert.match(chrome, /roundedCorners:\s*!overrides\.transparent/);
  assert.match(updateOverlay, /roundedCorners:\s*false/);
  assert.match(live2d, /roundedCorners:\s*false/);
});

test('dialog scrim and AppFrame carry the shared radius into their own planes', () => {
  assert.match(scrim, /body::before\s*\{[^}]*border-radius:\s*20px/);
  assert.match(frameModule, /border-radius:\s*20px/);
  assert.match(frameModule, /corner-shape:\s*round/);
  assert.match(frameModule, /--dsh-windows-content-radius:\s*20px/);
});

test('native Windows edges opt out of page silhouette without changing inner content corners', () => {
  assert.match(boot, /html\[data-native-window-frame\] \.scene\s*\{\s*border-radius: 0/);
  assert.match(launcher, /html\[data-native-window-frame\] \.shell\s*\{\s*border-radius: 0;\s*box-shadow: none/);
  assert.match(inject, /html\[data-native-window-frame\] \[data-titlebar-density\]\s*\{\s*border-radius: 0 !important/);
  assert.match(inject, /html\[data-native-window-frame\] #\$\{FRAME_RING_ID\}\s*\{\s*display: none/);
});
