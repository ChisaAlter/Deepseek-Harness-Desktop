import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evidenceDir } from './ci-production-cdp.mjs';

const root = path.join(process.env.APPDATA, 'Deepseek-Harness-Desktop');
const parent = path.join(root, 'dsh-home/sessions/--C-Ai-ChisaTerminal--');
const candidates = fs.readdirSync(parent).map(id => ({ id, file: path.join(parent, id, 'session.jsonl.zstd') })).filter(e => fs.existsSync(e.file)).sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
const selected = process.argv[3] ? candidates.find(e => e.id === process.argv[3]) : candidates[0];
if (!selected) throw new Error('QA session missing');
const z = await import(pathToFileURL(path.join(root, 'runtime/0.2.9/packages/session/session-persistence-jsonl/lib/types/zstd.js')));
const bytes = fs.readFileSync(selected.file);
let text = '';
for (const frame of z.scanZstdFrames(bytes).frames) text += (await z.decompressZstdFrame(bytes.subarray(frame.start, frame.end))).toString();
const events = text.trim().split('\n').map(JSON.parse);
const result = {
  id: selected.id,
  cwd: events[0].cwd,
  descriptions: events.filter(e => e.type === 'vision/describe').map(e => ({seq:e.seq, data:e.data})),
  requests: events.filter(e => e.type === 'request/header').map(e => ({seq:e.seq, provider:e.data.provider, model:e.data.model, keys:Object.keys(e.data)})),
  calls: events.filter(e => e.type === 'tool/call').map(e => ({seq:e.seq, name:e.data.name, arguments:e.data.arguments})),
  ended: events.filter(e => e.type === 'turn/end').map(e => ({seq:e.seq, data:e.data})),
};
fs.writeFileSync(path.join(evidenceDir, process.argv[2] || 'gateway-vision-log.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
