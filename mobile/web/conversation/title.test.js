import test from 'node:test';
import assert from 'node:assert/strict';
import { isUntitledBlank, sessionTitle } from './title.js';

test('sessionTitle prefers projection title over a leftover blank flag', () => {
  assert.equal(sessionTitle({
    sessionId: 'abcdefghij',
    blank: true,
    projections: { values: { title: '验证连接并生成验证码' } },
  }), '验证连接并生成验证码');
});

test('sessionTitle prefers blank then projection then short id', () => {
  assert.equal(sessionTitle({ sessionId: 'abcdefghij', blank: true }), '新会话');
  assert.equal(sessionTitle({
    sessionId: 'abcdefghij',
    blank: false,
    projections: { values: { title: '修远程' } },
  }), '修远程');
  assert.equal(sessionTitle({ sessionId: 'abcdefghij', blank: false }), 'abcdefg');
});

test('isUntitledBlank is false once the host already has a title', () => {
  assert.equal(isUntitledBlank({ blank: true }), true);
  assert.equal(isUntitledBlank({
    blank: true,
    projections: { values: { title: '验证连接并生成验证码' } },
  }), false);
  assert.equal(isUntitledBlank({ blank: false }), false);
});
