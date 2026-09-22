import fs from 'node:fs';
import path from 'node:path';
import { connect, evidenceDir } from './ci-production-cdp.mjs';
import { selectNewModel, runPrompt } from './ci-gateway-models.mjs';

export async function attachFixture() {
  const base64 = fs.readFileSync(path.join(evidenceDir, 'vision-fixture.png')).toString('base64');
  const c = await connect();
  try {
    await c.ev(`(() => { const e = document.querySelector('[data-composer-input]'); e.focus(); const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), ch => ch.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'qa-vision.png', {type:'image/png'})); e.dispatchEvent(new ClipboardEvent('paste', {clipboardData:dt,bubbles:true,cancelable:true})); })()`);
    for (let i = 0; i < 40; i++) {
      if (await c.ev(`Boolean(document.querySelector('[data-composer-card] img'))`)) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Image did not attach in installed composer');
  } finally { c.close(); }
}

if (process.argv[2] === 'native') {
  const results = [];
  for (const [index, id] of ['codely-core', 'GLM-5.3-FLASH', 'KIMI-K3'].entries()) {
    console.log('Testing installed native vision: ' + id);
    await selectNewModel(id);
    await attachFixture();
    const name = `gateway-vision-${index + 1}`;
    const result = await runPrompt(name, '描述图片中的两个图形：分别给出左右位置、形状和颜色。不要读取文件或调用工具。');
    const pass = !result.failure && !result.errors.length && /红/.test(result.text) && /蓝/.test(result.text) && /方/.test(result.text) && /圆/.test(result.text) && /左/.test(result.text) && /右/.test(result.text);
    const row = { id, pass, response: result.text, failure: result.failure, evidence: name + '.json' };
    results.push(row);
    fs.writeFileSync(path.join(evidenceDir, 'gateway-vision-summary.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(row));
    if (result.busy || result.approval) throw new Error('Unfinished vision turn; stop before changing sessions');
  }
}
