'use strict';

// Composer family width linkage. The composer seat publishes
// --dsh-composer-resized-width while the Interface Settings composerResize
// drag is live; the rows that share the input card's width axis — the session
// stats line, the queue/todo/goal dock cards above the card, and the desktop
// usage-panel cost strip under it — must read that variable so they follow the
// drag instead of keeping the resting card cap. The follow is a CSS variable
// reference with the resting cap as fallback (rest state never changes), so
// the contract is pinned as source markers: a sync:harness merge or a manual
// "restore to upstream" must not silently drop the references (the fork
// markers in harness-desktop-forks.js catch the same regression on the
// manifest level; this test pins the CSS text itself).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VENDOR = path.join(__dirname, '..', '..', 'vendor');

function readRel(base, rel) {
  return fs.readFileSync(path.join(base, ...rel.split('/')), 'utf8');
}

/** Whitespace-normalized CSS rule body so multi-line calc() compares as one string. */
function normalize(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
}

/** Resized-width follow marker: the max-width cap reads the seat variable
 *  with the resting card cap as its fallback. */
const FOLLOW = /max-width:\s*calc\(\s*var\(--dsh-composer-resized-width,\s*var\(--dsh-composer-card-max-width\)\)/;

const UI_CONVERSATION = path.join(VENDOR, 'deepseek-harness', 'packages', 'client', 'ui-conversation', 'src', 'client');
const UI_GOAL = path.join(VENDOR, 'deepseek-harness', 'packages', 'client', 'ui-goal', 'src', 'client');

function ruleOf(css, selector) {
  const rule = css.match(new RegExp(`${selector} \\{[^}]*\\}`))?.[0];
  assert.ok(rule, `${selector} rule present`);
  return rule;
}

test('stats line follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_CONVERSATION, 'chat/StatsLine.module.css'));
  const rule = ruleOf(css, '\\.root');
  assert.match(rule, FOLLOW);
  assert.match(rule, /var\(--dsh-composer-side-clearance\)/);
});

test('queue dock follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_CONVERSATION, 'queue/QueueDock.module.css'));
  assert.match(ruleOf(css, '\\.dock'), FOLLOW);
});

test('chat flow column follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_CONVERSATION, 'chat/ChatView.module.css'));
  const rule = ruleOf(css, '\\.column');
  assert.match(rule, FOLLOW);
  assert.match(rule, /var\(--dsh-composer-side-clearance\)/);
});

test('width is published on the conversation scroll host so the transcript sees it', () => {
  const source = readRel(UI_CONVERSATION, 'skeleton/ComposerResizeHandles.tsx');
  assert.match(source, /const SCROLL_SELECTOR = '\[data-conversation-scroll\]'/);
  assert.match(source, /scrollOf\(seat\)\?\.style\.setProperty\(WIDTH_VAR, value\)/);
  assert.match(source, /host\?\.style\.removeProperty\(WIDTH_VAR\)/);
});

test('todo panel follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_CONVERSATION, 'skeleton/TodoPanel.module.css'));
  assert.match(ruleOf(css, '\\.root'), FOLLOW);
});

test('goal bar follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_GOAL, 'GoalBar.module.css'));
  assert.match(ruleOf(css, '\\.bar'), FOLLOW);
});

test('usage-panel cost strip follows the drag-resized composer card', () => {
  const styles = readRel(path.join(VENDOR, 'dsh-usage-panel', 'src', 'client'), 'styles.ts');
  assert.match(
    styles,
    /\.dsw-ust-strip\{[^}]*max-width:calc\(\s*var\(--dsh-composer-resized-width,\s*var\(--dsh-composer-card-max-width\)\)/,
  );
});
