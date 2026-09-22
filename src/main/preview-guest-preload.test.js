'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  applyAnnotationTheme,
  cssSelector,
  htmlPreview,
  captureElement,
} = require('./preview-pick-helpers.js');

const leftoverBrand = ['t', '3', 'code'].join('');
const leftoverTools = ['t', '3', 'tools'].join('');
const leftoverCss = `--${['t', '3'].join('')}-`;
const leftoverHyphen = ['T', '3', '-'].join('');
const BRAND = new RegExp(
  [leftoverBrand, leftoverTools, leftoverCss, `data-${leftoverBrand}`, leftoverHyphen].join('|'),
  'i',
);

function readSource(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

test('guest preload keeps ipcRenderer in the isolated world and omits leftover brand markers', () => {
  const files = [
    'preview-guest-preload.js',
    'preview-guest-protocol.js',
    'preview-pick-helpers.js',
    'preview-pick-label.js',
    'preview-annotation-keyboard.js',
  ];
  for (const name of files) {
    const source = readSource(name);
    assert.doesNotMatch(source, BRAND, name);
  }
  const preload = readSource('preview-guest-preload.js');
  assert.match(preload, /require\('electron'\)/);
  assert.doesNotMatch(preload, /globalThis\.ipcRenderer/);
  assert.match(preload, /data-dshd-annotation-ui/);
  assert.match(preload, /data-dshd-annotation-tool/);
  assert.match(preload, /--dshd-preview-primary/);
  assert.doesNotMatch(preload, /react-grab/);
});

test('selector helper returns #id when present', () => {
  assert.equal(cssSelector({ id: 'save', tagName: 'BUTTON', parentElement: null }), '#save');
});

test('selector helper returns an nth-of-type path without an id', () => {
  const parent = { id: '', tagName: 'DIV', children: [], parentElement: null };
  const first = { id: '', tagName: 'SPAN', parentElement: parent, children: [] };
  const second = { id: '', tagName: 'SPAN', parentElement: parent, children: [] };
  parent.children = [first, second];
  assert.equal(cssSelector(second), 'div > span:nth-of-type(2)');
});

test('htmlPreview truncates outerHTML around 2000 characters', () => {
  const long = `<p>${'x'.repeat(3000)}</p>`;
  const preview = htmlPreview({ outerHTML: long });
  assert.ok(preview.length <= 2000);
  assert.ok(preview.length > 0);
});

test('captureElement fills tag, selector, htmlPreview and nulls react-grab fields', () => {
  const payload = captureElement({
    id: 'save',
    tagName: 'BUTTON',
    parentElement: null,
    outerHTML: '<button id="save">Save</button>',
  }, {
    href: 'http://127.0.0.1:3000/',
    title: 'App',
  });
  assert.equal(payload.tagName, 'button');
  assert.equal(payload.selector, '#save');
  assert.ok(payload.htmlPreview.includes('button'));
  assert.equal(payload.componentName, null);
  assert.equal(payload.source, null);
  assert.equal(payload.stack, null);
  assert.equal(payload.pageUrl, 'http://127.0.0.1:3000/');
  assert.equal(payload.pageTitle, 'App');
  assert.equal(typeof payload.pickedAt, 'string');
});

test('theme helper writes --dshd-preview-primary and never leftover primary CSS', () => {
  const props = {};
  const host = {
    style: {
      colorScheme: '',
      setProperty(name, value) {
        props[name] = value;
      },
    },
  };
  applyAnnotationTheme(host, {
    colorScheme: 'light',
    primary: 'rgb(1, 2, 3)',
    background: 'white',
    foreground: 'black',
    popover: 'white',
    popoverForeground: 'black',
    primaryForeground: 'white',
    muted: 'gray',
    mutedForeground: 'gray',
    accent: 'gray',
    accentForeground: 'black',
    border: 'gray',
    input: 'gray',
    ring: 'blue',
    radius: '8px',
    fontSans: 'system-ui',
    fontMono: 'monospace',
  });
  assert.equal(props['--dshd-preview-primary'], 'rgb(1, 2, 3)');
  assert.equal(props[`${leftoverCss}primary`], undefined);
  assert.equal(host.style.colorScheme, 'light');
});
