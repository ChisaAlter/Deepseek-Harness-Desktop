'use strict';

/**
 * Reload-with-cleanup extracted for testability. The production wiring in
 * index.js supplies the real coordinator, guard, journal reader/predicate,
 * cleanup callback, and live window/runtime/controller accessors through
 * dependency injection; the test supplies fixtures against the SAME
 * implementation. No Electron entry-point exports, no stale runtime snapshot.
 *
 * @param {object} deps
 * @param {() => object|null} deps.getMainWindow — live main-window accessor
 * @param {{ state: string, baseUrl: string }} deps.dsh — live kernel state
 * @param {{ reload: () => Promise<any> }} deps.harness — controller
 * @param {{ coordinate: (op: string, opts: object) => Promise<object> }} deps.taskProtection
 * @param {object} deps.importGuard — shared maintenance slot
 * @param {(dir: string) => object|null} deps.readImportJournal
 * @param {(journal: object|null) => boolean} deps.journalIsBlocked
 * @param {() => Promise<void>} deps.cleanupDesktopResources
 * @param {() => string} deps.getUserDataDir — live userData dir accessor
 */
function createReloadWithCleanup({
  getMainWindow,
  dsh,
  harness,
  taskProtection,
  importGuard,
  readImportJournal,
  journalIsBlocked,
  cleanupDesktopResources,
  getUserDataDir,
}) {
  return function reloadWithCleanup() {
    // The view-vs-start decision must be authoritative AT dispatch, not only
    // at entry: harness.reload() calls this.start() whenever a main window
    // exists but the kernel is not ready, and the kernel's state can change
    // while the prompt and cleanup are in flight. Re-evaluate inside the
    // commit — if the kernel is (or has become) unready, this reload would
    // start the kernel, so it must pass the same persistent blocked-journal
    // admission and OWN the shared slot through settlement; a genuinely
    // ready-runtime reload stays a lock-free view refresh.
    //
    // Entry-time fast path: a kernel already unready will definitely take the
    // start branch, so apply admission and own the slot up front (refusal
    // propagates as {proceeded:false} with zero side effects).
    const winAtEntry = getMainWindow();
    const unreadyAtEntry = Boolean(winAtEntry) && !(dsh.state === 'ready' && dsh.baseUrl);
    if (unreadyAtEntry) {
      if (importGuard.isMaintenanceHeld()) {
        return Promise.resolve({ proceeded: false, code: 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind });
      }
      try {
        const pending = readImportJournal(getUserDataDir());
        if (journalIsBlocked(pending)) {
          return Promise.resolve({ proceeded: false, code: 'import-recovery-blocked', pendingTxns: pending?.pendingTxns || [] });
        }
      } catch {
        return Promise.resolve({ proceeded: false, code: 'import-recovery-blocked' });
      }
      const acquired = importGuard.acquireMaintenance('reload-start');
      if (!acquired) {
        return Promise.resolve({ proceeded: false, code: 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind });
      }
      try {
        return taskProtection.coordinate('reload', {
          hostLock: false,
          commit: async () => {
            await cleanupDesktopResources();
            return harness.reload();
          },
        }).then((result) => (result.proceeded ? undefined : result))
          .finally(() => importGuard.releaseMaintenance(acquired));
      } catch (error) {
        importGuard.releaseMaintenance(acquired);
        throw error;
      }
    }
    // Kernel ready at entry: commit re-evaluates at dispatch — a kernel that
    // became unready during prompt/cleanup is caught and refused rather than
    // silently starting under a view-refresh classification.
    // Dispatch-time refusals cannot ride the coordinator's return contract —
    // it discards commit()'s return value — so capture it locally and surface
    // it in the outer wrapper, else a refused start resolves as completion.
    let dispatchRefusal = null;
    return taskProtection.coordinate('reload', {
      hostLock: false,
      commit: async () => {
        await cleanupDesktopResources();
        const win = getMainWindow();
        const willStartKernel = Boolean(win) && !(dsh.state === 'ready' && dsh.baseUrl);
        if (!willStartKernel) {
          return harness.reload();
        }
        // Dispatch-time re-evaluation: this reload will start the kernel, so
        // it is a mutating lifecycle operation. Apply persistent recovery
        // admission and own the slot for the duration — refusing to run
        // unowned is what keeps a foreign start/install from overlapping.
        if (importGuard.isMaintenanceHeld()) {
          dispatchRefusal = { proceeded: false, code: 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind };
          return;
        }
        try {
          const pending = readImportJournal(getUserDataDir());
          if (journalIsBlocked(pending)) {
            dispatchRefusal = { proceeded: false, code: 'import-recovery-blocked', pendingTxns: pending?.pendingTxns || [] };
            return;
          }
        } catch {
          dispatchRefusal = { proceeded: false, code: 'import-recovery-blocked' };
          return;
        }
        const acquired = importGuard.acquireMaintenance('reload-start');
        if (!acquired) {
          dispatchRefusal = { proceeded: false, code: 'maintenance-in-progress', owner: importGuard.maintenanceOwner()?.kind };
          return;
        }
        try {
          return await harness.reload();
        } finally {
          importGuard.releaseMaintenance(acquired);
        }
      },
    }).then((result) => {
      if (dispatchRefusal) return dispatchRefusal;
      return result.proceeded ? undefined : result;
    });
  };
}

module.exports = { createReloadWithCleanup };
