import test from 'node:test';
import assert from 'node:assert/strict';
import { blankGreeting, greetingForHour } from './greeting.js';

test('greeting follows the local hour buckets from the design', () => {
  assert.equal(greetingForHour(0), '晚上好');
  assert.equal(greetingForHour(4), '晚上好');
  assert.equal(greetingForHour(5), '早上好');
  assert.equal(greetingForHour(10), '早上好');
  assert.equal(greetingForHour(11), '中午好');
  assert.equal(greetingForHour(12), '中午好');
  assert.equal(greetingForHour(13), '下午好');
  assert.equal(greetingForHour(17), '下午好');
  assert.equal(greetingForHour(18), '晚上好');
  assert.equal(greetingForHour(23), '晚上好');
});

test('greeting normalizes out-of-range hours and defaults to now', () => {
  assert.equal(greetingForHour(29), '早上好');
  assert.equal(greetingForHour(-1), '晚上好');
  assert.equal(greetingForHour(NaN), greetingForHour(new Date().getHours()));
  assert.equal(greetingForHour(undefined), greetingForHour(new Date().getHours()));
});

test('blank hero greeting carries the fixed suffix', () => {
  assert.equal(blankGreeting(9), '早上好，今天做点什么');
  assert.equal(blankGreeting(20), '晚上好，今天做点什么');
});
