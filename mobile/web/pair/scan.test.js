import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScan, detectScanSupport, scanUnavailableHint } from './scan.js';

function encodeOffer(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const offerRaw = encodeOffer({
  v: 2,
  serverId: 'server-1',
  daemonPublicKeyB64: 'daemon-key',
  relay: { endpoint: '125.124.85.212:8411', useTls: false },
});

test('classifyScan pairs directly when scanned origin matches the page', () => {
  const result = classifyScan(
    `http://192.168.1.23:3180/#offer=${offerRaw}`,
    'http://192.168.1.23:3180',
  );
  assert.equal(result.kind, 'login');
  assert.match(result.offerUrl, /#offer=/);
});

test('classifyScan pairs for bare #offer= payloads without a URL', () => {
  const result = classifyScan(`#offer=${offerRaw}`, 'http://192.168.1.23:3180');
  assert.equal(result.kind, 'login');
  assert.match(result.offerUrl, /^http:\/\/192\.168\.1\.23:3180\/#offer=/);
});

test('classifyScan navigates for a different origin and keeps offer in hash', () => {
  const url = `http://192.168.1.99:3180/#offer=${offerRaw}`;
  const result = classifyScan(url, 'http://192.168.1.23:3180');
  assert.equal(result.kind, 'navigate');
  assert.equal(result.url, url);
  assert.ok(!result.url.includes('?offer='), 'offer must stay in hash, never query');
});

test('classifyScan marks QR codes without a pairing offer invalid', () => {
  assert.equal(classifyScan('https://example.com/', 'https://example.com').kind, 'invalid');
  assert.equal(classifyScan('hello world', 'https://example.com').kind, 'invalid');
  assert.equal(classifyScan('', 'https://example.com').kind, 'invalid');
  assert.equal(classifyScan('#offer=%%%%', 'https://example.com').kind, 'invalid');
});

test('detectScanSupport requires secure context first (LAN http page)', async () => {
  const result = await detectScanSupport({ isSecureContext: false });
  assert.deepEqual(result, { supported: false, reason: 'insecure-context' });
});

test('detectScanSupport requires getUserMedia then BarcodeDetector qr_code', async () => {
  assert.deepEqual(
    await detectScanSupport({ isSecureContext: true }),
    { supported: false, reason: 'no-camera' },
  );
  const mediaDevices = { getUserMedia: async () => ({}) };
  assert.deepEqual(
    await detectScanSupport({ isSecureContext: true, mediaDevices }),
    { supported: false, reason: 'no-detector' },
  );
  function NoQr() {}
  NoQr.getSupportedFormats = async () => ['ean_13'];
  assert.deepEqual(
    await detectScanSupport({ isSecureContext: true, mediaDevices, BarcodeDetector: NoQr }),
    { supported: false, reason: 'no-detector' },
  );
  function Broken() {}
  Broken.getSupportedFormats = async () => { throw new Error('nope'); };
  assert.deepEqual(
    await detectScanSupport({ isSecureContext: true, mediaDevices, BarcodeDetector: Broken }),
    { supported: false, reason: 'no-detector' },
  );
  function WithQr() {}
  WithQr.getSupportedFormats = async () => ['qr_code'];
  assert.deepEqual(
    await detectScanSupport({ isSecureContext: true, mediaDevices, BarcodeDetector: WithQr }),
    { supported: true, reason: '' },
  );
});

test('scanUnavailableHint tells LAN plaintext apart from unsupported browsers', () => {
  assert.match(scanUnavailableHint('insecure-context'), /局域网明文页/);
  assert.match(scanUnavailableHint('no-camera'), /不支持应用内扫码/);
  assert.match(scanUnavailableHint('no-detector'), /不支持应用内扫码/);
  assert.equal(scanUnavailableHint(''), '');
});
