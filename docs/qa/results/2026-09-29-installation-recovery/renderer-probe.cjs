'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../../../..');
app.setPath('userData', path.join(repo, '.tmp', 'installation-renderer-qa'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 780, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  const results = [];
  try {
    await win.loadFile(path.join(repo, 'src/renderer/launcher.html'));
    for (const theme of ['light', 'dark']) {
      for (const width of [1024, 720]) {
        win.setContentSize(width, 780);
        for (const payload of [
          { phase: 'download', received: 134217728, total: 805306368, percent: 17, bytesPerSecond: 1048576 },
          { phase: 'download', received: 134217728, total: 0, percent: null },
          { phase: 'download', retrying: true, attempt: 2, maxAttempts: 3, percent: null },
          { phase: 'install-wait', elapsedMs: 95000 },
          { phase: 'waiting' },
        ]) {
          const result = await win.webContents.executeJavaScript(`(async () => {
            document.documentElement.toggleAttribute('data-ds-dark-theme', ${JSON.stringify(theme)} === 'dark');
            document.getElementById('home-install').hidden = false;
            document.getElementById('hint').hidden = true;
            document.getElementById('install-progress-title').textContent = '正在安装桌面端';
            const payload = ${JSON.stringify(payload)};
            paintProgress('install-progress', payload);
            const line = document.getElementById('install-progress');
            line.textContent = payload.phase === 'waiting' ? '已检测到同版本桌面端，但无法确认本次修复是否完成。请完成安装向导（可能需要系统授权），再刷新状态；不要重复启动安装。' : installPhaseText(payload);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const rect = line.getBoundingClientRect();
            return { text: line.textContent, percent: document.getElementById('install-progress-pct').textContent,
              title: document.getElementById('install-progress-title').textContent,
              barHidden: document.getElementById('install-progress-bar').parentElement.hidden,
              fits: rect.width > 0 && line.scrollWidth <= line.clientWidth && rect.right <= innerWidth,
              phase: payload.phase };
          })()`);
          assert.equal(result.fits, true);
          if (payload.percent === null || payload.phase !== 'download') assert.equal(result.percent, '');
          if (payload.phase === 'waiting') { assert.equal(result.barHidden, true); assert.equal(result.title, '安装结果待确认'); }
          results.push({ theme, width, ...result });
          if (payload.phase === 'waiting' || (payload.phase === 'download' && payload.percent === 17)) {
            const shot = await win.webContents.capturePage();
            fs.writeFileSync(path.join(__dirname, `launcher-${theme}-${width}-${payload.phase}.png`), shot.toPNG());
          }
        }
      }
    }
    fs.writeFileSync(path.join(__dirname, 'renderer-probe.json'), JSON.stringify({ ok: true, cases: results }, null, 2));
    console.log(`PASS ${results.length} renderer scenarios`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
});
