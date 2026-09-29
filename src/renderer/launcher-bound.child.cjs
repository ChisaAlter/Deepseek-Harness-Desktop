// Electron main for the bound-handler regression: load the REAL launcher.html
// + the REAL preload (which exposes window.shell via contextBridge), register
// fixture shell:* IPC handlers, and drive the page through executeJavaScript.
// A deferred-cancel A->B and a route-save refusal->retry are exercised against
// the real bind() and the real bridge — not pure functions.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const LAUNCHER_HTML = path.join(__dirname, 'launcher.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');

// IPC fixtures the test controls via process.env / argv switches.
const results = { calls: [] };
const pendingCancels = new Map();
let importResolve = null;
let startResolve = null;
let startReject = null;
let stopResolve = null;
let startupState = 'idle';
const startupError = "EEXIST: symlink C:\\fixture\\vendor\\dsh-im -> C:\\fixture\\profile\\dsh-im";
ipcMain.handle('shell:start-desktop', () => {
  results.calls.push({ op: 'start-desktop' });
  return new Promise((resolve, reject) => { startResolve = resolve; startReject = reject; });
});
ipcMain.handle('shell:stop-desktop', () => {
  results.calls.push({ op: 'stop-desktop' });
  return new Promise(resolve => { stopResolve = resolve; });
});

ipcMain.handle('shell:save-launcher-config', (_e, patch) => {
  results.calls.push({ op: 'save-launcher-config', patch });
  const failOnce = process.env.QA_ROUTE_FAIL_ONCE === '1';
  if (failOnce && results.calls.filter((c) => c.op === 'save-launcher-config').length === 1) {
    return { ok: false, error: 'maintenance-in-progress' };
  }
  return { ok: true };
});
ipcMain.handle('shell:cancel-import', (_e, payload) => {
  results.calls.push({ op: 'cancel-import', payload });
  return new Promise((resolve) => pendingCancels.set(payload && payload.opId, resolve));
});
ipcMain.handle('shell:run-import', (_e, opts) => {
  results.calls.push({ op: 'run-import', opts });
  return new Promise((resolve) => { importResolve = resolve; });
});
ipcMain.handle('shell:scan-import', () => ({ ok: true, sessions: [], skills: [], plugins: [], mcp: [], settings: [], presets: [] }));
ipcMain.handle('shell:launcher-status', () => ({
  ok: true,
  ...(process.env.QA_STARTUP_FLOW === '1' ? {
    version: '0.3.3', desktop: { state: startupState },
    lastStart: { ok: startupState === 'ready', error: startupError },
    forensics: { plugins: [], suspects: [] },
  } : {}),
  state: 'idle',
  downloadRoute: 'stable',
  routes: [
    { id: 'stable', label: 'Stable', verified: true, detail: 'stable channel' },
    { id: 'beta', label: 'Beta', verified: true, detail: 'beta channel' },
    { id: 'nightly', label: 'Nightly', verified: false, detail: 'not verified' },
  ],
}));
ipcMain.handle('shell:launcher-check-update', () => ({ status: 'none' }));
ipcMain.handle('shell:check-update', () => ({ status: 'none' }));
ipcMain.handle('shell:list-releases', () => ({ status: 'ok', releases: [], installed: { version: '0' } }));
ipcMain.handle('shell:list-marketplace', () => ({ ok: true, items: [] }));
ipcMain.handle('shell:list-installed-plugins', () => ({ plugins: [], bundles: [] }));
ipcMain.handle('shell:list-wallpapers', () => ({ ok: true, items: [] }));
ipcMain.handle('shell:get-config', () => ({ theme: 'midnight', locale: 'zh' }));
ipcMain.handle('shell:get-launcher-config', () => ({ downloadRoute: 'stable' }));
ipcMain.handle('shell:list-routes', () => ({ ok: true, routes: [{ id: 'stable', label: 'Stable' }, { id: 'beta', label: 'Beta' }] }));

function emitProgress(win, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('shell:import-progress', payload);
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      // The preload builds window.shell only for a declared shell role.
      additionalArguments: ['--dshd-shell-role=launcher'],
    },
  });
  try {
    await win.loadFile(LAUNCHER_HTML);
    const ready = await win.webContents.executeJavaScript(`new Promise((r) => {
      if (document.readyState === 'complete') return r('ready');
      document.addEventListener('DOMContentLoaded', () => r('ready'));
      setTimeout(() => r('timeout'), 4000);
    })`);
    const scan = await win.webContents.executeJavaScript(`({
      hasShell: typeof window.shell === 'object' && window.shell !== null,
      hasCancel: typeof (window.shell && window.shell.cancelImport) === 'function',
      hasProgress: typeof (window.shell && window.shell.onImportProgress) === 'function',
      importBtn: Boolean(document.getElementById('btn-import')),
      cancelBtn: Boolean(document.getElementById('btn-import-cancel')),
      routePicker: Boolean(document.getElementById('route-picker')),
      readyState: document.readyState,
    })`);

    if (process.env.QA_STARTUP_FLOW === '1') {
      const captureHome = async name => {
        if (!process.env.QA_HOME_ARTIFACTS) return;
        await new Promise(r => setTimeout(r, 180));
        const fs = require('fs');
        fs.mkdirSync(process.env.QA_HOME_ARTIFACTS, { recursive: true });
        const screenshot = await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.env.QA_HOME_ARTIFACTS, name), screenshot.toPNG());
      };
      const readHome = () => win.webContents.executeJavaScript(`(() => {
        const get = id => document.getElementById(id);
        return {
          duplicateRetry: Boolean(get('btn-recovery-retry')),
          startText: get('btn-start').textContent, startDisabled: get('btn-start').disabled,
          startHidden: get('btn-start').hidden, stopHidden: get('btn-stop').hidden,
          stopDisabled: get('btn-stop').disabled, stopText: get('btn-stop').textContent,
          skipDisabled: get('btn-skip').disabled, fullDisabled: get('btn-retry-full').disabled,
          diagnosticsHidden: get('home-recovery').hidden, diagnosticsOpen: get('home-recovery').open === true,
          visibleText: document.body.innerText,
          status: get('home-status').textContent,
          progress: get('home-start-progress')?.textContent || '',
          detail: get('home-recovery-verdict').textContent,
        };
      })()`);
      await new Promise(r => setTimeout(r, 100));
      const initial = await readHome();
      await captureHome('home-collapsed.png');
      await win.webContents.executeJavaScript(`document.getElementById('btn-start').click(); document.getElementById('btn-start').click();`);
      await new Promise(r => setTimeout(r, 1100));
      const pending = await readHome();
      await captureHome('home-starting.png');
      const startsWhilePending = results.calls.filter(c => c.op === 'start-desktop').length;
      startupState = 'error';
      startResolve({ ok: false, error: startupError });
      await new Promise(r => setTimeout(r, 120));
      const failed = await readHome();
      const layouts = [];
      for (const zoom of [1, 2]) {
        win.setSize(860, 560);
        win.webContents.setZoomFactor(zoom);
        await new Promise(r => setTimeout(r, 180));
        await win.webContents.executeJavaScript(`document.getElementById('home-recovery').open = true`);
        const layout = await win.webContents.executeJavaScript(`(() => {
          const button = document.getElementById('btn-start');
          button.scrollIntoView();
          const r = button.getBoundingClientRect();
          return { width: innerWidth, reachable: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
            rawErrorCount: document.body.innerText.split('EEXIST').length - 1 };
        })()`);
        layouts.push({ zoom, ...layout });
        await captureHome(`home-failed-${zoom}x.png`);
      }
      win.webContents.setZoomFactor(1);
      await new Promise(r => setTimeout(r, 180));
      await win.webContents.executeJavaScript(`document.getElementById('btn-start').click()`);
      await new Promise(r => setTimeout(r, 80));
      startReject(new Error('fixture transport failure'));
      await new Promise(r => setTimeout(r, 120));
      const rejected = await readHome();
      await win.webContents.executeJavaScript(`document.getElementById('btn-start').click()`);
      await new Promise(r => setTimeout(r, 80));
      startupState = 'ready';
      startResolve({ ok: true });
      await new Promise(r => setTimeout(r, 120));
      const readyHome = await readHome();
      await win.webContents.executeJavaScript(`document.getElementById('btn-stop').click(); document.getElementById('btn-stop').click()`);
      await new Promise(r => setTimeout(r, 80));
      const stopping = await readHome();
      startupState = 'stopped';
      stopResolve({ ok: true });
      await new Promise(r => setTimeout(r, 120));
      const stopped = await readHome();
      process.stdout.write('BOUND_RESULT:' + JSON.stringify({ initial, pending, failed, rejected, readyHome,
        stopping, stopped, layouts, startsWhilePending, stops: results.calls.filter(c => c.op === 'stop-desktop').length }));
      app.exit(0);
      return;
    }

    // ---- Delayed cancel A -> B ----
    // Start import A (runs forever until we resolve). While A is in flight,
    // click cancel — the handler captures A's opId and awaits. Then start B
    // (activeImportOpId=B). When A's cancel reply finally arrives, the stale
    // write must be refused (stillOwns is false), leaving B's progress intact.
    const importBtnExists = scan.importBtn;
    let delayedCancel = { skipped: !importBtnExists };
    if (importBtnExists) {
      await win.webContents.executeJavaScript(`document.getElementById('btn-import').click()`);
      await new Promise((r) => setTimeout(r, 60));
      const opA = results.calls.find((c) => c.op === 'run-import')?.opts?.opId;
      // Click cancel for A (handler captures opA and awaits cancel reply).
      await win.webContents.executeJavaScript(`document.getElementById('btn-import-cancel').click()`);
      // Start B: mark a new active op by clicking import again after A's
      // handler finishes? A is still pending — instead simulate B by forcing
      // the shared state: dispatch progress for opB and a stale progress for opA.
      // Resolve A's run-import so its finally clears activeImportOpId, then
      // start B fresh.
      if (importResolve) importResolve({ ok: true, sessions: [], skills: [] });
      await new Promise((r) => setTimeout(r, 30));
      await win.webContents.executeJavaScript(`document.getElementById('btn-import').click()`);
      await new Promise((r) => setTimeout(r, 60));
      const runs = results.calls.filter((c) => c.op === 'run-import');
      const opB = runs.length > 1 ? runs[runs.length - 1].opts.opId : null;
      // Deliver the DELAYED cancel reply for A now (after B started).
      if (pendingCancels.has(opA)) pendingCancels.get(opA)({ ok: false, error: 'not-current-operation' });
      await new Promise((r) => setTimeout(r, 60));
      const dom = await win.webContents.executeJavaScript(`({
        importResult: document.getElementById('import-result').textContent,
        cancelHidden: document.getElementById('btn-import-cancel').hidden,
      })`);
      delayedCancel = {
        opA, opB, dom,
        staleWriteRefused: !/取消被拒绝|取消请求被拒绝/.test(dom.importResult),
      };
    }

    // ---- Route save refusal -> retry (bound radio handler) ----
    // First pick: env QA_ROUTE_FAIL_ONCE makes the first saveLauncherConfig
    // resolve {ok:false} — the bound handler must treat the resolved refusal
    // as a failure and let a retry of the SAME route actually issue.
    let routeRetry = { skipped: true };
    try {
      const radios = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('#route-picker [data-route-pick]'))
          .map((el) => ({ route: el.dataset.routePick, checked: el.getAttribute('aria-checked'), disabled: el.disabled }))
      `);
      const beta = radios.find((r) => r.route === 'beta' && !r.disabled);
      if (beta) {
        const savesBefore = results.calls.filter((c) => c.op === 'save-launcher-config').length;
        // First pick — will resolve {ok:false} under QA_ROUTE_FAIL_ONCE.
        await win.webContents.executeJavaScript(`
          document.querySelector('#route-picker [data-route-pick="beta"]').click()
        `);
        await new Promise((r) => setTimeout(r, 60));
        const savesAfterFirst = results.calls.filter((c) => c.op === 'save-launcher-config').length;
        // Retry the SAME route — the refusal must not have deduped it away.
        await win.webContents.executeJavaScript(`
          document.querySelector('#route-picker [data-route-pick="beta"]').click()
        `);
        await new Promise((r) => setTimeout(r, 60));
        const savesAfterRetry = results.calls.filter((c) => c.op === 'save-launcher-config').length;
        routeRetry = {
          radios,
          picked: 'beta',
          savesBefore,
          savesAfterFirst,
          savesAfterRetry,
          firstIssued: savesAfterFirst > savesBefore,
          retryIssued: savesAfterRetry > savesAfterFirst,
        };
      } else {
        routeRetry = { radios, reason: 'no-enabled-beta' };
      }
    } catch (error) {
      routeRetry = { error: String(error) };
    }

    const report = { scan, delayedCancel, routeRetry, calls: results.calls.map((c) => ({ op: c.op, hasOp: Boolean(c.opts && c.opts.opId) })) };
    process.stdout.write('BOUND_RESULT:' + JSON.stringify(report));
    app.exit(0);
  } catch (error) {
    process.stdout.write('BOUND_ERROR:' + JSON.stringify({ message: String(error), stack: error && error.stack }));
    app.exit(1);
  }
});
