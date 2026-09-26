/**
 * Admission guards installed on Host services. webServer route registration is
 * wrapped so every plugin route — including rows registered before this plugin
 * loaded — passes through the admission check; the task-admission chokepoints
 * (`sessionController.resolveAgent`, `jobs.start`) reject while locked so
 * Schedule/Bot/IM timer producers cannot sneak work past an HTTP-only lock.
 */

import { admit } from './state.js';
import { CONTROL_PREFIX } from './http.js';

const WRAPPED = Symbol.for('dsh-task-control.wrapped');
const GATE_TYPES = new Set(['agent', 'job', 'schedule-task', 'socket', 'request', 'resume']);

/** Error returned/raised when admission is refused while locked. */
export class AdmissionLockedError extends Error {
  constructor(detail) {
    super(`desktop task admission locked${detail ? `: ${detail}` : ''}`);
    this.name = 'AdmissionLockedError';
    this.code = 'session/agent-busy';
    this.admissionCode = 'dshd/admission-locked';
  }
}

function exempt(path) {
  return path === CONTROL_PREFIX || path.startsWith(`${CONTROL_PREFIX}/`);
}

function gateHttpHandler(state, path, handler) {
  return async function gatedRoute(req, res) {
    const admission = admit(state);
    if (!admission.accepted) {
      if (!res.headersSent) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: { code: admission.code } }));
      return;
    }
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      admission.done();
    };
    res.once('close', done);
    try {
      return await handler(req, res);
    } finally {
      done();
    }
  };
}

function gateUpgradeHandler(state, path, handler) {
  return function gatedUpgrade(req, socket, head) {
    const admission = admit(state);
    if (!admission.accepted) {
      try {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      } catch {
        // A half-open socket still gets destroyed below.
      }
      socket.destroy();
      return undefined;
    }
    socket.once('close', () => admission.done());
    return handler(req, socket, head);
  };
}

function isReadMethod(req) {
  return req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
}

function wrapRouteEntry(state, table, path) {
  const route = table.get(path);
  if (route === undefined || route[WRAPPED] || exempt(route.path)) return;
  route.handler = gateHttpHandler(state, route.path, route.handler);
  route[WRAPPED] = true;
}

/**
 * Wrap one WebServer instance: gate already-registered routes in place and
 * intercept future register/registerUpgrade/registerFallback calls.
 * @returns true when the wrap was applied.
 */
export function wrapWebServer(state, webServer) {
  if (webServer === undefined || webServer === null || webServer[WRAPPED]) return false;
  if (typeof webServer.register !== 'function') return false;
  webServer[WRAPPED] = true;

  const originalRegister = webServer.register.bind(webServer);
  webServer.register = (route) => {
    if (route && !route[WRAPPED] && !exempt(route.path)) {
      route.handler = gateHttpHandler(state, route.path, route.handler);
      route[WRAPPED] = true;
    }
    return originalRegister(route);
  };
  const originalRegisterUpgrade = typeof webServer.registerUpgrade === 'function'
    ? webServer.registerUpgrade.bind(webServer) : null;
  if (originalRegisterUpgrade) {
    webServer.registerUpgrade = (route) => {
      if (route && !route[WRAPPED]) {
        route.handler = gateUpgradeHandler(state, route.path, route.handler);
        route[WRAPPED] = true;
      }
      return originalRegisterUpgrade(route);
    };
  }
  const originalRegisterFallback = typeof webServer.registerFallback === 'function'
    ? webServer.registerFallback.bind(webServer) : null;
  if (originalRegisterFallback) {
    webServer.registerFallback = (handler) => originalRegisterFallback(gateFallback(state, handler));
  }

  // Routes registered before this plugin loaded (e.g. the connection `/api`
  // prefix and the gateway upgrade row) escape the wrapped register calls;
  // rewrite their handler slots in place.
  if (webServer.prefixes instanceof Map) {
    for (const path of [...webServer.prefixes.keys()]) wrapRouteEntry(state, webServer.prefixes, path);
  }
  if (webServer.exact instanceof Map) {
    for (const path of [...webServer.exact.keys()]) wrapRouteEntry(state, webServer.exact, path);
  }
  if (webServer.upgrades instanceof Map) {
    for (const [path, route] of [...webServer.upgrades.entries()]) {
      if (route[WRAPPED]) continue;
      route.handler = gateUpgradeHandler(state, path, route.handler);
      route[WRAPPED] = true;
    }
  }
  if (typeof webServer.fallback === 'function' && !webServer.fallback[WRAPPED]) {
    webServer.fallback = gateFallback(state, webServer.fallback);
  }
  return true;
}

function gateFallback(state, handler) {
  const gated = async function gatedFallback(req, res) {
    // The fallback serves SPA assets; locking it would white-out a visible
    // window during the confirmation wait. Mutating methods on unmatched
    // paths are still gated — they are not reads.
    if (isReadMethod(req)) return handler(req, res);
    const admission = admit(state);
    if (!admission.accepted) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: admission.code } }));
      return undefined;
    }
    return Promise.resolve(handler(req, res)).finally(() => admission.done());
  };
  gated[WRAPPED] = true;
  return gated;
}

/**
 * Wrap the Agent-resolution chokepoint shared by Schedule delivery, dshbot
 * routines, IM channels, and Typert lookups. Locked calls fail with the
 * stable `session/agent-busy` result shape so producers keep their armed
 * state instead of crashing.
 */
export function wrapSessionController(state, sessionController) {
  if (sessionController === undefined || sessionController === null
    || sessionController[WRAPPED]) return false;
  const original = sessionController.resolveAgent;
  if (typeof original !== 'function') return false;
  sessionController.resolveAgent = async function resolveAgentGuarded(...args) {
    const admission = admit(state);
    if (!admission.accepted) {
      return { error: new AdmissionLockedError('session resolution refused while locked') };
    }
    try {
      return await original.apply(this, args);
    } finally {
      admission.done();
    }
  };
  sessionController[WRAPPED] = true;
  return true;
}

/** Wrap `jobs.start` so background-job producers cannot start during a lock. */
export function wrapJobs(state, jobs) {
  if (jobs === undefined || jobs === null || jobs[WRAPPED]) return false;
  const original = jobs.start;
  if (typeof original !== 'function') return false;
  jobs.start = function jobsStartGuarded(...args) {
    const admission = admit(state);
    if (!admission.accepted) {
      return Promise.reject(new AdmissionLockedError('job start refused while locked'));
    }
    try {
      return Promise.resolve(original.apply(this, args)).finally(() => admission.done());
    } finally {
      // Sync throws settle through the promise wrapper above.
    }
  };
  jobs[WRAPPED] = true;
  return true;
}

export const internals = { WRAPPED, GATE_TYPES };
