import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown } from './markdown.js';

test('parseInline splits code, bold, italic, and safe links', () => {
  assert.deepEqual(parseInline('run `ls` and **read** *this* [doc](https://a.example/x)'), [
    { kind: 'text', text: 'run ' },
    { kind: 'code', text: 'ls' },
    { kind: 'text', text: ' and ' },
    { kind: 'strong', text: 'read' },
    { kind: 'text', text: ' ' },
    { kind: 'em', text: 'this' },
    { kind: 'text', text: ' ' },
    { kind: 'link', text: 'doc', href: 'https://a.example/x' },
  ]);
});

test('parseInline keeps unsafe link schemes as literal text (never a link span)', () => {
  for (const input of ['[x](javascript:alert(1))', '[x](data:text/html,hi)']) {
    const spans = parseInline(input);
    assert.ok(spans.every((span) => span.kind === 'text'), input);
    assert.equal(spans.map((span) => span.text).join(''), input);
  }
});

test('parseMarkdown keeps raw HTML as plain text (injection-safe by structure)', () => {
  const blocks = parseMarkdown('<img src=x onerror=alert(1)>');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'paragraph');
  assert.deepEqual(blocks[0].spans, [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
});

test('parseMarkdown handles fences, headings, lists, and quotes', () => {
  const blocks = parseMarkdown([
    '# 标题',
    '',
    '第一段',
    '',
    '- 甲',
    '- 乙',
    '',
    '1. 一',
    '',
    '> 引用一',
    '> 引用二',
    '',
    '```js',
    'const x = 1;',
    '```',
  ].join('\n'));
  assert.deepEqual(blocks.map((block) => block.kind), [
    'heading', 'paragraph', 'list', 'list', 'quote', 'code',
  ]);
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[5].lang, 'js');
  assert.equal(blocks[5].text, 'const x = 1;');
});

test('parseMarkdown does not close a fence on ```lang and keeps unterminated fences', () => {
  const blocks = parseMarkdown('```sh\necho hi\n```js\nstill code');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'code');
  assert.equal(blocks[0].text, 'echo hi\n```js\nstill code');
});

test('parseMarkdown treats empty input as no blocks', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(undefined), []);
});
