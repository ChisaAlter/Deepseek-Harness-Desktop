// Run with Node against the explicitly debug-enabled local source app.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const targets = await fetch('http://127.0.0.1:9335/json/list').then(r => r.json());
  const target = targets.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:3080/'));
  assert.ok(target, 'live Harness target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  try {
    const read = () => evaluate(`(async()=>({state:await window.shell.getWindowState(),radius:getComputedStyle(document.body).borderTopLeftRadius,ring:getComputedStyle(document.getElementById('dshd-frame-ring')).display,hairline:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-window-hairline'))*devicePixelRatio,dpi:devicePixelRatio}))()`);
    const before = await read();
    assert.equal(before.state.maximized, false, 'inspect normal window; do not alter an already maximized user session');
    assert.equal(before.radius, '20px');
    assert.ok(Math.abs(before.hairline - 1) < 0.002);
    assert.notEqual(before.ring, 'none');
    await evaluate("window.shell.windowAction('maximize')"); await wait(650);
    const maximized = await read();
    assert.equal(maximized.state.maximized, true);
    assert.equal(maximized.radius, '0px');
    await evaluate("window.shell.windowAction('maximize')"); await wait(650);
    const restored = await read();
    assert.equal(restored.state.maximized, false);
    assert.equal(restored.radius, '20px');
    assert.ok(Math.abs(restored.hairline - 1) < 0.002);
    assert.notEqual(restored.ring, 'none');
    const shot = await call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 120, height: 100, scale: 1 } });
    fs.writeFileSync(path.join(__dirname, 'harness-corner.png'), Buffer.from(shot.data, 'base64'));
    const result = { before, maximized, restored };
    fs.writeFileSync(path.join(__dirname, 'harness-check.json'), JSON.stringify(result, null, 2) + '\n');
    console.log('PASS live Harness radius/ring + maximize/restore', JSON.stringify(result));
  } finally { ws.close(); }
})().catch(e => { console.error(e); process.exit(1); });
