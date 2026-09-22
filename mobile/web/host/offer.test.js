import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeOffer, offerFromHash, offerFromPaste, hashHasOffer } from './offer.js';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

test('decodeOffer reads v1 lan and relay payloads', () => {
  const lan = decodeOffer(b64url({ v: 1, token: 'secret-token', mode: 'lan' }));
  assert.equal(lan.token, 'secret-token');
  assert.equal(lan.mode, 'lan');
  const relay = decodeOffer(b64url({
    v: 1, token: 'secret-token', mode: 'relay', relay: 'https://relay.example',
  }));
  assert.equal(relay.mode, 'relay');
  assert.equal(relay.relay, 'https://relay.example');
});

test('offerFromHash reads #offer= and ignores query', () => {
  const raw = b64url({ v: 1, token: 'abc', mode: 'lan' });
  assert.equal(offerFromHash(`#offer=${raw}`).token, 'abc');
  assert.equal(offerFromHash(`?token=leaked#offer=${raw}`).token, 'abc');
  assert.equal(offerFromHash('#nope=1'), null);
  assert.equal(decodeOffer('%%%'), null);
});

test('hashHasOffer tells a malformed offer apart from no offer at all', () => {
  // 有 offer 参数（无论能否解开）→ true：启动路径必须报「配对链接无效」而不是静默试探。
  assert.equal(hashHasOffer(`#offer=${b64url({ v: 1, token: 'abc', mode: 'lan' })}`), true);
  assert.equal(hashHasOffer('#offer=%%%garbage%%%'), true);
  assert.equal(hashHasOffer(`#offer=${b64url({ v: 1, s: 'wrong-field' })}`), true);
  // 没有 offer 参数 → false：走 C9 静默 Cookie 试探。
  assert.equal(hashHasOffer(''), false);
  assert.equal(hashHasOffer('#'), false);
  assert.equal(hashHasOffer('#nope=1'), false);
  assert.equal(hashHasOffer('#offer='), false);
  // 无效变体解码仍为 null（错字段 s、垃圾 base64、版本不符）。
  assert.equal(offerFromHash(`#offer=${b64url({ v: 1, s: 'wrong-field' })}`), null);
  assert.equal(offerFromHash('#offer=%%%garbage%%%'), null);
  assert.equal(offerFromHash(`#offer=${b64url({ v: 2, token: 'abc' })}`), null);
});

test('offerFromPaste reads a full URL, a hash, or offer= payload', () => {
  const raw = b64url({ v: 1, token: 'paste-token', mode: 'lan' });
  assert.equal(offerFromPaste(`https://relay.example/#offer=${raw}`).token, 'paste-token');
  assert.equal(offerFromPaste(`#offer=${raw}`).token, 'paste-token');
  assert.equal(offerFromPaste(`offer=${raw}`).token, 'paste-token');
  assert.equal(offerFromPaste('https://relay.example/'), null);
});
