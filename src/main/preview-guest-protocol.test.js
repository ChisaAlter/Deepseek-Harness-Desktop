'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const protocol = require('./preview-guest-protocol.js');

const CHANNELS = [
  'dshd-preview-start-pick',
  'dshd-preview-cancel-pick',
  'dshd-preview-element-picked',
  'dshd-preview-annotation-captured',
  'dshd-preview-annotation-theme',
  'dshd-preview-human-input',
];

test('guest protocol exports the six dshd-preview channels and no leftover brand names', () => {
  const values = [
    protocol.START_PICK_CHANNEL,
    protocol.CANCEL_PICK_CHANNEL,
    protocol.ELEMENT_PICKED_CHANNEL,
    protocol.ANNOTATION_CAPTURED_CHANNEL,
    protocol.ANNOTATION_THEME_CHANNEL,
    protocol.HUMAN_INPUT_CHANNEL,
  ];
  assert.deepEqual(values, CHANNELS);
  for (const name of values) {
    assert.equal(name.includes(['t', '3'].join('')), false, name);
    assert.match(name, /^dshd-preview-/);
  }
});
