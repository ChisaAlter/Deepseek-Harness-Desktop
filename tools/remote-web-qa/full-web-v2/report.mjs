#!/usr/bin/env node
/** Build REPORT.md (module tally + verdict) from results.json in DSH_QA_OUT. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.env.DSH_QA_OUT || '.');
const all = JSON.parse(readFileSync(path.join(out, 'results.json'), 'utf8'));
const moduleOf = (id) => (id.match(/^([A-Z]+)/) || [])[1] || 'MISC';
const tally = {};
for (const [id, r] of Object.entries(all)) {
  const m = moduleOf(id);
  tally[m] = tally[m] || { Pass: 0, Fail: 0, Blocked: 0, 'NA-track': 0, 'NA-pre': 0, Deferred: 0, fails: [], blocked: [] };
  const s = r.status in tally[m] ? r.status : (String(r.status).startsWith('NA') ? 'NA-pre' : r.status);
  tally[m][s] = (tally[m][s] || 0) + 1;
  if (s === 'Fail') tally[m].fails.push(id);
  if (s === 'Blocked') tally[m].blocked.push(id);
}
const totals = Object.values(tally).reduce((acc, t) => {
  for (const k of ['Pass', 'Fail', 'Blocked']) acc[k] += t[k] || 0;
  return acc;
}, { Pass: 0, Fail: 0, Blocked: 0 });

const lines = [];
lines.push('# 手机远程 Web 全功能 v2 · T2 Rehearsal 报告');
lines.push('');
lines.push(`生成：${new Date().toISOString()} · 轨：**T2 rehearsal**（Puppeteer + 源码 Electron CDP 双端）。**不是 T1**。用例表：docs/qa/mobile-remote-full-web-cases.md`);
lines.push('');
lines.push('| 模块 | Pass | Fail | Blocked | NA(轨) | NA(前置) | Deferred |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const [m, t] of Object.entries(tally).sort()) {
  lines.push(`| ${m} | ${t.Pass || 0} | ${t.Fail || 0} | ${t.Blocked || 0} | ${t['NA-track'] || 0} | ${t['NA-pre'] || 0} | ${t.Deferred || 0} |`);
}
lines.push(`| **合计** | **${totals.Pass}** | **${totals.Fail}** | **${totals.Blocked}** | | | |`);
lines.push('');
lines.push('## Fail');
lines.push('');
for (const [m, t] of Object.entries(tally).sort()) {
  for (const id of t.fails) lines.push(`- **${id}** — ${all[id].note}`);
}
if (!totals.Fail) lines.push('（无）');
lines.push('');
lines.push('## Blocked（需原因 + 豁免栏）');
lines.push('');
for (const [m, t] of Object.entries(tally).sort()) {
  for (const id of t.blocked) lines.push(`- ${id} — ${all[id].note}`);
}
lines.push('');
lines.push('## 判定');
lines.push('');
lines.push(totals.Fail > 0
  ? `Fail=${totals.Fail} → **不可交付**。`
  : (totals.Blocked > 0
    ? `Fail=0，Blocked=${totals.Blocked}（需逐条豁免或补测）→ 本轨 rehearsal 无 Fail，但**不得**写「实机全量通过」；T1 真机+公网另签。`
    : 'Fail=0，Blocked=0 → 本轨 rehearsal 全绿；T1 真机+公网另签。'));
writeFileSync(path.join(out, 'REPORT.md'), `${lines.join('\n')}\n`);
console.log(`REPORT.md written to ${out}: Pass=${totals.Pass} Fail=${totals.Fail} Blocked=${totals.Blocked}`);
