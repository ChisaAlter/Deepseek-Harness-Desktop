import fs from 'node:fs';
import path from 'node:path';

export const evidenceDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
export async function connect(kind = 'harness') {
  const targets = await (await fetch('http://127.0.0.1:9334/json/list')).json();
  const target = targets.find(t => kind === 'harness' ? /^http:\/\/127\.0\.0\.1:3080\//.test(t.url) : t.url.endsWith(`/${kind}.html`));
  if (!target) throw new Error(`Installed ${kind} page unavailable`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id;
    const timer = setTimeout(() => { pending.delete(current); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(current, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: current, method, params }));
  });
  const ev = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result?.value;
  };
  const screenshot = async name => {
    const image = await call('Page.captureScreenshot', { format: 'png' });
    const output = path.join(evidenceDir, name + '.png');
    fs.writeFileSync(output, Buffer.from(image.data, 'base64'));
    return output;
  };
  const key = async (key, code, modifiers = 0) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : undefined });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
  };
  return { ev, call, screenshot, key, close: () => ws.close() };
}

export function record(id, status, detail, evidence = []) {
  const file = path.join(evidenceDir, 'ci-production-results.json');
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const row = report.cases.find(c => c.id === id);
  if (!row) throw new Error(`Unknown acceptance case: ${id}`);
  Object.assign(row, { status, detail, evidence, verifiedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
}
