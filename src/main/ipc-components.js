'use strict';

// Launcher components lane (refactor plan §5.0/§5.1). Mounts the
// shell:components-* channels through the shared authorized handle and
// contributes the `components` status key; all orchestration lives in
// src/launcher/components/.
const { createComponentsService } = require('../launcher/components');

let service = null;
let serviceDeps = null;
let quitHooked = false;

function ensureService() {
  if (!service) {
    service = createComponentsService(serviceDeps || {});
  }
  return service;
}

// Test seam — swap the deps the singleton service is built with.
function _configureForTest(deps) {
  serviceDeps = deps || {};
  service = null;
  quitHooked = false;
}

function register({ handle, LAUNCHER_ONLY, send, onQuitCommit }) {
  const svc = ensureService();
  const progress = (event, id) => (payload) => send(event, 'shell:components-progress', { id, ...payload });

  handle('shell:components-list', LAUNCHER_ONLY, () => svc.list());

  handle('shell:components-install', LAUNCHER_ONLY, (event, arg) => {
    const id = typeof arg === 'string' ? arg : arg?.id;
    return svc.install(arg, progress(event, id));
  });

  handle('shell:components-start', LAUNCHER_ONLY, (event, id) => svc.start(id, progress(event, id)));

  handle('shell:components-stop', LAUNCHER_ONLY, (event, id) => svc.stop(id, progress(event, id)));

  handle('shell:components-update', LAUNCHER_ONLY, (event, id) => svc.update(id, progress(event, id)));

  handle('shell:components-rollback', LAUNCHER_ONLY, (event, id) => svc.rollback(id, progress(event, id)));

  handle('shell:components-uninstall', LAUNCHER_ONLY, (event, id) => svc.uninstall(id, progress(event, id)));

  // Services supervised by this launcher die with it (feature card:
  // 退出 Launcher 时停止其监管的服务); closing the window alone keeps them.
  // The full package routes the cleanup through the task-protection commit
  // point — `before-quit` fires even when the protection prompt cancels the
  // quit, so a plain listener would shut services down on a cancelled quit.
  if (!quitHooked) {
    quitHooked = true;
    if (typeof onQuitCommit === 'function') {
      onQuitCommit(() => svc.shutdown());
    } else {
      try {
        const { app } = require('electron');
        app.on('before-quit', () => {
          svc.shutdown();
        });
      } catch {
        // outside Electron (unit tests) — shutdown stays reachable directly
      }
    }
  }
}

function contributeStatus() {
  if (!service) {
    return null;
  }
  return { components: service.snapshot() };
}

module.exports = { register, contributeStatus, _configureForTest };
