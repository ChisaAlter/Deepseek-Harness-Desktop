'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveAnnotationSubmission } = require('./preview-annotation-keyboard.js');

function keyboardEvent(overrides = {}) {
  return {
    key: 'Enter',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  };
}

test('Enter attaches and Ctrl/Meta+Enter sends', () => {
  assert.equal(resolveAnnotationSubmission(keyboardEvent()), 'attach');
  assert.equal(resolveAnnotationSubmission(keyboardEvent({ metaKey: true })), 'send');
  assert.equal(resolveAnnotationSubmission(keyboardEvent({ ctrlKey: true })), 'send');
});

test('Shift+Enter and composing events stay available for editing', () => {
  assert.equal(resolveAnnotationSubmission(keyboardEvent({ shiftKey: true })), null);
  assert.equal(resolveAnnotationSubmission(keyboardEvent({ isComposing: true })), null);
  assert.equal(resolveAnnotationSubmission(keyboardEvent({ key: ' ' })), null);
});
