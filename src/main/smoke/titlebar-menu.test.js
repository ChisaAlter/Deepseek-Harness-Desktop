'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAriaExpanded, titlebarMenuLooksOpen } = require('./titlebar-menu');

test('isAriaExpanded accepts React 18 empty string and React 19 true', () => {
  assert.equal(isAriaExpanded('true'), true);
  assert.equal(isAriaExpanded(''), true);
  assert.equal(isAriaExpanded('false'), false);
  assert.equal(isAriaExpanded(null), false);
  assert.equal(isAriaExpanded(undefined), false);
});

test('titlebarMenuLooksOpen uses expanded attr or a portaled role=menu', () => {
  assert.equal(titlebarMenuLooksOpen({ expanded: 'true', menuCount: 0 }), true);
  assert.equal(titlebarMenuLooksOpen({ expanded: '', menuCount: 0 }), true);
  assert.equal(titlebarMenuLooksOpen({ expanded: 'false', menuCount: 0 }), false);
  assert.equal(titlebarMenuLooksOpen({ expanded: null, menuCount: 1 }), true);
  assert.equal(titlebarMenuLooksOpen({ expanded: null, menuCount: 0, hasOpenPopover: true }), true);
  assert.equal(titlebarMenuLooksOpen({ expanded: null, menuCount: 0 }), false);
});
