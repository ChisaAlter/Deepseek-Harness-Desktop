const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deviceName,
  deviceDetail,
  normalizeDevices,
  publicDevices,
  createDevice,
} = require('./remote-devices');

test('deviceName maps phones, computers, and the 设备 fallback', () => {
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
  assert.equal(deviceName('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), 'iPad');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14)'), 'Android');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), '电脑');
  assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'), '电脑');
  assert.equal(deviceName('Mozilla/5.0 (X11; Linux x86_64)'), '电脑');
  assert.equal(deviceName(''), '设备');
});

test('deviceDetail parses OS, model, and browser and omits empty segments', () => {
  assert.equal(deviceDetail(''), '');
  assert.equal(
    deviceDetail('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'),
    'Android 14 · Pixel 8 · Chrome',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'),
    'Android 14 · Chrome',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'),
    'Android 14 · Chrome',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'),
    'Android 14 · Pixel 8 · Chrome',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    'iPhone · iOS 18.0 · Safari',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'),
    'iPad · iOS 18.1 · Safari',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'),
    'iPhone · iOS 18.0',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'),
    'Windows · x64 · Edge',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'),
    'Windows · ARM64 · Chrome',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'),
    'Windows · Chrome',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'),
    'macOS 14.0 · Safari',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'),
    'Linux x86_64 · Firefox',
  );
  assert.equal(deviceDetail('Mozilla/5.0 (X11; Linux x86_64)'), 'Linux x86_64');
  assert.equal(
    deviceDetail('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15'),
    'iPhone · iOS 17.0 · Firefox',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1'),
    'iPhone · iOS 17.0 · Chrome',
  );
  assert.equal(
    deviceDetail('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/110.0.5481.154 Mobile Safari/537.36'),
    'Android 14 · SM-S918B · Samsung Internet',
  );
  assert.equal(deviceDetail('Mozilla/5.0 (iPhone)'), 'iPhone');
  assert.equal(deviceDetail('Mozilla/5.0 (iPad)'), 'iPad');
  assert.equal(deviceDetail('Mozilla/5.0 (Linux; Android)'), 'Android');
  assert.equal(deviceDetail('Mozilla/5.0 (X11; Linux)'), 'Linux');
  assert.equal(deviceDetail('Mozilla/5.0 (Macintosh)'), 'macOS');
  assert.equal(deviceDetail('Mozilla/5.0 (compatible; Unknown)'), '');
});

test('normalizeDevices drops junk and duplicate ids, publicDevices strips tokens and UA', () => {
  const devices = normalizeDevices([
    null,
    { id: 'deadbeefcafebabe', token: 'secret-a', name: 'iPhone', createdAt: 't1', lastSeenAt: 't2' },
    { id: 'deadbeefcafebabe', token: 'dup', name: 'ignored' },
    { id: 'b', token: 'secret-b' },
    { name: 'no-id' },
  ]);
  assert.equal(devices.length, 2);
  assert.equal(devices[1].name, '设备');
  const pub = publicDevices(devices, ['b']);
  assert.equal(pub[0].online, false);
  assert.equal(pub[1].online, true);
  assert.equal(pub[0].shortId, 'babe');
  assert.equal(pub[1].shortId, 'b');
  assert.equal('token' in pub[0], false);
  assert.equal('userAgent' in pub[0], false);
  assert.equal('detail' in pub[0], false);
});

test('publicDevices labels computers 电脑 from the stored UA', () => {
  const pub = publicDevices([{
    id: 'c824c824c824c824',
    token: 'secret',
    name: 'Linux',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    createdAt: 't1',
    lastSeenAt: 't2',
  }], []);
  assert.equal(pub[0].name, '电脑');
  assert.equal(pub[0].detail, 'Linux x86_64 · Chrome');
  assert.equal(pub[0].shortId, 'c824');
  assert.equal('token' in pub[0], false);
  assert.equal('userAgent' in pub[0], false);
});

test('publicDevices adds a parsed detail line without the raw user-agent', () => {
  const pub = publicDevices([{
    id: 'aabbccdd11223344',
    token: 'secret',
    name: 'Android',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    createdAt: 't1',
    lastSeenAt: 't2',
  }], []);
  assert.equal(pub[0].detail, 'Android 14 · Pixel 8 · Chrome');
  assert.equal(pub[0].shortId, '3344');
  assert.equal('token' in pub[0], false);
  assert.equal('userAgent' in pub[0], false);
});

test('createDevice mints an id and names from the user agent', () => {
  const device = createDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', 'tok');
  assert.match(device.id, /^[0-9a-f]{16}$/);
  assert.equal(device.token, 'tok');
  assert.equal(device.name, 'iPhone');
  assert.equal(device.createdAt, device.lastSeenAt);
});
