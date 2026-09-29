'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const repo = path.resolve(__dirname, '../../../..');
const resources = path.join(repo, 'dist', 'win-unpacked', 'resources');
const archive = path.join(resources, 'vendor', 'deepseek-harness.tar');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-installation-qa-'));
const load = Module._load;
Module._load = function (request, ...args) {
  return request === 'electron' ? { app: { isPackaged: true, getVersion: () => 'qa', getPath: () => root } } : load.call(this, request, ...args);
};
Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
const extractor = require(path.join(repo, 'src/main/harness-extract'));
Module._load = load;
const result = { kind: 'local archive rehearsal, not CI Setup acceptance', archive, archiveBytes: fs.statSync(archive).size, events: [] };
(async () => {
  try {
    let lastTick = Date.now(); let maxTickGapMs = 0;
    const ticker = setInterval(() => { const now = Date.now(); maxTickGapMs = Math.max(maxTickGapMs, now - lastTick); lastTick = now; }, 100);
    const started = Date.now();
    let dest;
    try {
      dest = await extractor.ensurePackagedHarness((line) => {
        result.events.push({ elapsedMs: Date.now() - started, line });
        console.log(line);
      });
    } finally { clearInterval(ticker); }
    result.coldMs = Date.now() - started;
    result.maxTickGapMs = maxTickGapMs;
    assert.equal(extractor.hasBuiltHarness(dest), true);
    const warm = Date.now();
    assert.equal(await extractor.ensurePackagedHarness(), dest);
    result.warmMs = Date.now() - warm;
    result.ok = true;
  } catch (error) { result.error = error.stack; process.exitCode = 1; }
  finally {
    await extractor.settleBackgroundWork();
    // Only delete the exact disposable directory created by this script.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('dsh-installation-qa-'));
    fs.rmSync(root, { recursive: true, force: true });
    fs.writeFileSync(path.join(__dirname, 'extraction-probe.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, events: result.events.length }));
  }
})();
