'use strict';
// Synthetic 747-target / 3602-link layout on the local disk, not a CI Setup.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const links = require('../../../../src/shared/runtime-links');

async function measure(operation) {
  let ticks = 0;
  let maxTickGapMs = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxTickGapMs = Math.max(maxTickGapMs, now - last);
    last = now; ticks++;
  }, 10);
  try {
    await delay(25);
    const start = performance.now();
    await operation();
    const elapsedMs = performance.now() - start;
    await delay(25);
    return { elapsedMs: Math.round(elapsedMs), maxTickGapMs: Math.round(maxTickGapMs), ticks };
  } finally { clearInterval(timer); }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-async-links-probe-'));
  try {
    for (let i = 0; i < 747; i++) fs.mkdirSync(path.join(root, 'physical', `p${i}`), { recursive: true });
    const manifest = Array.from({ length: 3602 }, (_, i) => ({ path: `node_modules/p${i}`, target: `physical/p${i % 747}` }));
    fs.writeFileSync(path.join(root, links.RUNTIME_LINKS), JSON.stringify({ version: 1, links: manifest }));
    const syncCold = await measure(() => links.materializeRuntimeLinks(root));
    const syncWarm = await measure(() => links.materializeRuntimeLinks(root));
    const asyncWarm = await measure(() => links.materializeRuntimeLinksAsync(root));
    const asyncRemove = await measure(() => links.removeRuntimeLinksAsync(root));
    const asyncCold = await measure(() => links.materializeRuntimeLinksAsync(root));
    const result = { kind: 'synthetic local filesystem, not affected user reproduction or CI Setup acceptance', targets: 747,
      links: manifest.length, timerMs: 10, syncCold, syncWarm, asyncWarm, asyncRemove, asyncCold };
    fs.writeFileSync(path.join(__dirname, 'async-links-probe.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (!root.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe temporary root');
    await fs.promises.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
