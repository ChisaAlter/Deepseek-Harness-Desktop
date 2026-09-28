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
