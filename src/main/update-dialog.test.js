const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../renderer/update-dialog.css'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../renderer/update-dialog.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'update-dialog.js'), 'utf8');

test('dialog scrim follows the shell silhouette radius instead of painting square corners', () => {
  // The overlay covers the parent's bounds exactly; a square scrim paints the
  // transparent corner gaps, and over dark wallpaper the rounded edge goes
  // unreadable — the shell looks square on that side.
  assert.match(css, /body::before\s*\{[^}]*border-radius:\s*20px/);
});

test('maximized parents lose the scrim radius entirely', () => {
  assert.match(css, /html\[data-window-maximized\]\s*body::before\s*\{[^}]*border-radius:\s*0/);
});

test('view payload carries the effective maximized state and the renderer applies it', () => {
  assert.match(main, /maximized:\s*isEffectivelyMaximized\(parent\)/);
  assert.match(renderer, /toggleAttribute\('data-window-maximized', Boolean\(state\.maximized\)\)/);
});

test('the maximized flag re-syncs while the dialog stays open on parent geometry changes', () => {
  assert.match(main, /parent\.on\('resize',\s*syncMaximized\)/);
  assert.match(main, /parent\.on\('moved',\s*syncMaximized\)/);
});

test('stale-revision pushes still update the scrim radius', () => {
  assert.match(renderer, /state\.revision <= view\.revision\) \{\s*applyWindowState\(state\); return;/);
});
