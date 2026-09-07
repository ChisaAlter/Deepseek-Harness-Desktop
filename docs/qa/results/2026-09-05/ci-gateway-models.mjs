import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect, evidenceDir } from './ci-production-cdp.mjs';

export const modelIds = ['deepseek-v4-flash-0731-oc', 'glm-5.3-0731-oc', 'deepseek-v4-pro-0813-oc', 'codely-core', 'GLM-5.3-FLASH', 'KIMI-K3', 'moonshotai/kimi-k3'];
export async function selectNewModel(id) {
  const c = await connect();
  try {
    if (await c.ev(`Boolean(document.querySelector('[data-approval-key]'))`)) throw new Error('Outstanding approval');
    await c.ev(`[...document.querySelectorAll('button')].find(e => e.getAttribute('aria-label') === '新建会话').click()`);
    for (let i = 0; i < 50; i++) {
      if (await c.ev(`Boolean(document.querySelector('[data-composer-card] button[aria-label="选择模型"]'))`)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    await c.ev(`document.querySelector('[data-composer-card] button[aria-label="选择模型"]').click()`);
    await new Promise(r => setTimeout(r, 250));
    await c.ev(`[...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.trim().startsWith('模型')).click()`);
    await new Promise(r => setTimeout(r, 250));
    const picked = await c.ev(`(() => { const e = [...document.querySelectorAll('[role="menuitemradio"]')].find(e => e.textContent.trim() === ${JSON.stringify('QA ' + id)}); if (!e) return false; e.click(); return true; })()`);
    if (!picked) throw new Error(`QA model not found in installed picker: ${id}`);
  } finally { c.close(); }
}

export async function runPrompt(name, prompt) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(evidenceDir, 'ci-production-turn.mjs'), name, prompt], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', b => { errors += b; });
    child.stdout.on('data', () => {});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(errors.slice(-700))));
  });
  return JSON.parse(fs.readFileSync(path.join(evidenceDir, name + '.json'), 'utf8'));
}

if (process.argv[2] === 'text') {
  const results = [];
  for (const [index, id] of modelIds.entries()) {
    console.log('Testing installed desktop model: ' + id);
    await selectNewModel(id);
    const began = Date.now();
    const name = `gateway-text-${index + 1}`;
    const result = await runPrompt(name, '这是桌面模型连通性验收。不要调用工具，不要解释。请只回复：DSHD_QA_OK_33942243475');
    const row = { id, elapsedMs: Date.now() - began, pass: !result.failure && !result.errors.length && result.text.trim() === 'DSHD_QA_OK_33942243475', response: result.text, failure: result.failure, evidence: name + '.json' };
    results.push(row);
    fs.writeFileSync(path.join(evidenceDir, 'gateway-text-summary.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(row));
    if (result.busy || result.approval) throw new Error('Model left an unfinished turn; stop before changing sessions');
  }
}
