// Desktop-side catalog changes (workspace rename/order/unlist, archive set,
// session add/remove) arrive on the mux as host/* frames. The drawer refetches
// session.list + workspace.list once per burst instead of trusting partial
// frame payloads (DEF-SYNC-REVERSE).

const WORKSPACE_TYPES = new Set([
  'host/workspace-changed',
  'host/workspace-order-changed',
  'host/workspace-removed',
]);
const SESSION_TYPES = new Set(['host/session-added', 'host/session-removed']);

function catalogRefreshReason(payload) {
  const type = payload && typeof payload === 'object' ? payload.type : '';
  if (WORKSPACE_TYPES.has(type)) return 'workspace';
  if (type === 'host/archived-sessions-changed') return 'archived';
  if (SESSION_TYPES.has(type)) return 'session';
  return null;
}

function createCatalogRefreshScheduler(refresh, { delayMs = 400 } = {}) {
  let timer = null;
  let inflight = false;
  let again = false;

  async function run() {
    timer = null;
    if (inflight) {
      again = true;
      return;
    }
    inflight = true;
    try {
      await refresh();
    } catch {
      // The caller's own RPC paths surface host errors; a failed background
      // refresh must not break the mux listener.
    }
    inflight = false;
    if (again) {
      again = false;
      schedule('coalesced');
    }
  }

  function schedule() {
    if (timer) return;
    if (inflight) {
      again = true;
      return;
    }
    timer = setTimeout(run, delayMs);
  }

  return schedule;
}

export { catalogRefreshReason, createCatalogRefreshScheduler };
