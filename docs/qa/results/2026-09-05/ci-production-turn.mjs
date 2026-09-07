import fs from 'node:fs';
import path from 'node:path';
import { connect, evidenceDir } from './ci-production-cdp.mjs';

const name = process.argv[2];
const prompt = process.argv[3];
if (!/^[a-z0-9-]+$/.test(name || '') || !prompt) throw new Error('Expected evidence name and prompt');
const c = await connect();
const snapshot = `(() => {
  const nodes = [...document.querySelectorAll('[data-chat-flow-kind]')];
  const assistants = nodes.filter(e => ['assistant', 'assistant-step'].includes(e.getAttribute('data-chat-flow-kind')));
  return {
    assistantCount: assistants.length,
    text: assistants.at(-1)?.innerText || '',
    kinds: nodes.map(e => e.getAttribute('data-chat-flow-kind')),
    busy: !!document.querySelector('button[aria-label="停止生成"], button[aria-label="Stop generating"]'),
    approval: document.querySelector('[data-approval-key]')?.innerText || '',
    errors: [...document.querySelectorAll('[role="alert"]')].map(e => e.innerText),
    failure: document.querySelector('[data-chat-flow-kind="turn-error"]')?.innerText || '',
    composer: document.querySelector('[data-composer-input]')?.innerText || ''
  };
})()`;
try {
  const before = await c.ev(snapshot);
  if (before.busy || before.composer.trim()) throw new Error('Existing generation or draft; refusing to overwrite');
  if (!await c.ev(`(() => { const e = document.querySelector('[data-composer-input]'); if (!e) return false; e.focus(); return true; })()`)) throw new Error('No composer');
  await c.call('Input.insertText', { text: prompt });
  await new Promise(r => setTimeout(r, 250));
  const sent = await c.ev(`(() => { const e = document.querySelector('button[aria-label="发送消息"]'); if (!e || e.disabled) return false; e.click(); return true; })()`);
  if (!sent) throw new Error('Send unavailable');
  const deadline = Date.now() + 300000;
  let result;
  do {
    await new Promise(r => setTimeout(r, 1200));
    result = await c.ev(snapshot);
    if (result.approval || result.errors.length || result.failure || (result.assistantCount > before.assistantCount && result.text && !result.busy && !result.composer)) break;
  } while (Date.now() < deadline);
  const output = { prompt, beforeAssistantCount: before.assistantCount, observedAt: new Date().toISOString(), ...result };
  fs.writeFileSync(path.join(evidenceDir, name + '.json'), JSON.stringify(output, null, 2));
  await c.screenshot(name);
  console.log(JSON.stringify(output));
} finally { c.close(); }
