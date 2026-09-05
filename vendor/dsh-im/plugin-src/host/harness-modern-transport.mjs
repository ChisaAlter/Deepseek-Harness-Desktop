import { randomUUID } from 'node:crypto';

const ERROR_CODES = { 'session/not-found': 'session-not-found', 'session/agent-busy': 'agent-busy' };

function legacyError(error) {
  return { ...error, code: ERROR_CODES[error?.code] ?? error?.code ?? 'harness-response-invalid', message: error?.message ?? 'Harness stream failed' };
}

function response(rpcId, result) {
  return Response.json({ type: 'server-response', rpcId, result });
}

/** Translate the IM package's older carrier onto the pinned Typert Remote API. */
export function createModernHarnessTransport({ baseUrl, fetchImpl, createWebSocket }) {
  const origin = new URL(baseUrl).origin;
  const muxUrl = new URL('/api/remote.mux', origin);
  muxUrl.protocol = 'ws:';
  const pending = new Map();

  function assertOrigin(input) {
    const url = new URL(input);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.origin !== origin || url.username || url.password) throw new Error('Unexpected Harness origin');
    return url;
  }

  async function unary(endpoint, args, rpcId, options = {}) {
    return fetchImpl(new URL(`/api/${endpoint}`, origin), {
      ...options,
      method: 'POST',
      headers: { ...options.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
    });
  }

  function firstItem(endpoint, args, signal) {
    const lifetime = signal ?? AbortSignal.timeout(30_000);
    lifetime.throwIfAborted();
    return new Promise((resolve, reject) => {
      const socket = createWebSocket(muxUrl.href);
      const streamId = randomUUID();
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        lifetime.removeEventListener('abort', abort);
        try {
          if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'cancel', streamId }));
          socket.close();
        } catch { /* The original stream result owns the outcome. */ }
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(lifetime.reason);
      lifetime.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', () => {
        if (!settled) socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
      });
      socket.addEventListener('message', ({ data }) => {
        try {
          const frame = JSON.parse(String(data));
          if (frame.streamId !== streamId) return;
          if (frame.type === 'item') finish(null, frame.value);
          else if (frame.type === 'error') finish(Object.assign(new Error(frame.error.message), legacyError(frame.error)));
          else if (frame.type === 'end') finish(new Error('Harness stream ended without a baseline'));
        } catch (error) { finish(error); }
      });
      socket.addEventListener('error', () => finish(new Error('Harness stream connection failed')));
      socket.addEventListener('close', () => finish(new Error('Harness stream closed before its baseline')));
      if (lifetime.aborted) abort();
    });
  }

  async function snapshot(payload, signal) {
    const value = await firstItem('session/follow', {
      request: { address: { kind: 'session', sessionId: payload.sessionId }, maxMessages: payload.maxMessages ?? 50 },
    }, signal);
    if (value?.type !== 'snapshot' || !Array.isArray(value.records)) throw new Error('Invalid Harness Session snapshot');
    return value;
  }

  async function fetchModern(input, options = {}) {
    const url = assertOrigin(input);
    if (options.method !== 'POST' || typeof options.body !== 'string') return fetchImpl(input, options);
    const request = JSON.parse(options.body);
    const { rpcId, method, payload = {} } = request;
    if (url.pathname === '/api/respond') {
      const deliveries = pending.get(rpcId);
      const delivery = deliveries?.values().next().value;
      if (!delivery) return Response.json({ accepted: false, reason: 'not-pending' });
      const result = request.result;
      const value = delivery.kind === 'approval' ? result?.value?.outcome : result?.value?.answer;
      const outcome = result?.ok === true ? { kind: 'result', value }
        : { kind: 'rejected', error: { name: 'Error', message: result?.error?.message ?? 'IM response rejected' } };
      const reply = await unary('$events/result', { clientId: delivery.clientId, eventId: rpcId, outcome }, randomUUID(), options);
      if (!reply.ok) return reply;
      const body = await reply.json();
      if (body.result?.ok !== true) return Response.json({ accepted: false, reason: 'not-pending' });
      pending.delete(rpcId);
      return Response.json({ accepted: true });
    }
    if (request.type !== 'client-request' || url.pathname !== `/api/${method}`) return fetchImpl(input, options);
    try {
      if (method === 'host.describe') {
        const frame = await firstItem('$events', {}, options.signal);
        if (frame?.type !== 'ready' || !frame.host) throw new Error('Harness event source is not ready');
        return response(rpcId, { ok: true, value: frame.host });
      }
      if (method === 'workspace.list') {
        const frame = await firstItem('workspace/follow', {}, options.signal);
        if (frame?.type !== 'baseline' || !Array.isArray(frame.value?.items)) throw new Error('Invalid Harness Workspace baseline');
        return response(rpcId, { ok: true, value: frame.value });
      }
      if (method === 'session.history') {
        const frame = await snapshot(payload, options.signal);
        return response(rpcId, { ok: true, value: { events: frame.records, hasMore: frame.hasMore, projections: frame.projections } });
      }
      if (method === 'session.models') {
        const reply = await unary('session/modelCatalog', {}, rpcId, options);
        if (!reply.ok) return reply;
        const body = await reply.json();
        if (!body.result?.ok) return response(rpcId, body.result);
        const frame = await snapshot({ sessionId: payload.sessionId, maxMessages: 1 }, options.signal);
        const catalog = body.result.value;
        const current = frame.projections?.values?.modelSelection?.next ?? catalog.default;
        return response(rpcId, { ok: true, value: { ...catalog, current, routable: catalog.routableProviders?.includes(current?.provider) === true } });
      }
      const endpoint = method === 'llm.models' ? 'session/modelCatalog' : method.replaceAll('.', '/');
      let args;
      if (method === 'host.describe' || method === 'session.list') args = { _request: payload };
      else if (method === 'llm.models') args = {};
      else if (method === 'session.prompt') args = { request: { ...payload, requestId: rpcId } };
      else if (method === 'session.cancel') args = { request: { sessionId: payload.sessionId } };
      else args = { request: payload };
      const reply = await unary(endpoint, args, rpcId, options);
      if (!reply.ok) return reply;
      const body = await reply.json();
      if (body.result?.ok === false) body.result.error = legacyError(body.result.error);
      return Response.json(body);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      return response(rpcId, { ok: false, error: legacyError(error) });
    }
  }

  class EventSocket extends EventTarget {
    readyState = 0;
    #socket;
    #streams = new Map();
    #clientId;
    #sessionId;
    #watched = new Set();

    constructor(sessionId) {
      super();
      this.#sessionId = sessionId;
      this.#socket = createWebSocket(muxUrl.href);
      this.#socket.addEventListener('open', () => {
        this.#open('$events', {});
        if (sessionId) this.#follow(sessionId);
        else this.#open('session/control', {});
      });
      this.#socket.addEventListener('message', ({ data }) => {
        try { this.#receive(JSON.parse(String(data))); }
        catch { this.dispatchEvent(new Event('error')); this.close(); }
      });
      this.#socket.addEventListener('error', () => this.dispatchEvent(new Event('error')));
      this.#socket.addEventListener('close', () => {
        this.readyState = 3;
        for (const [id, deliveries] of pending) {
          deliveries.delete(this);
          if (!deliveries.size) pending.delete(id);
        }
        this.dispatchEvent(new Event('close'));
      });
    }

    #open(endpoint, args, sessionId) {
      const streamId = randomUUID();
      this.#streams.set(streamId, { endpoint, sessionId });
      this.#socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
    }

    #follow(sessionId) {
      if (!sessionId || this.#watched.has(sessionId)) return;
      this.#watched.add(sessionId);
      this.#open('session/follow', { request: { address: { kind: 'session', sessionId }, maxMessages: 1 } }, sessionId);
    }

    #emit(payload, rpcId = randomUUID()) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'server-request', rpcId, method: payload.type, payload }) }));
    }

    #receive(frame) {
      const stream = this.#streams.get(frame.streamId);
      if (!stream) return;
      if (frame.type === 'error') {
        // A deleted session must not tear down the global Office event feed.
        if (!this.#sessionId && stream.endpoint === 'session/follow') { this.#streams.delete(frame.streamId); return; }
        throw new Error('Harness event stream rejected');
      }
      if (frame.type !== 'item') return;
      const item = frame.value;
      if (stream.endpoint === 'session/follow') {
        if (item.type === 'event') this.#emit({ type: 'session/event', sessionId: stream.sessionId, event: item.event });
        return;
      }
      if (stream.endpoint === 'session/control') {
        if (item.type === 'baseline') for (const id of Object.keys(item.value.projections ?? {})) this.#follow(id);
        else if (item.sessionId) this.#follow(item.sessionId);
        return;
      }
      if (item.type === 'ready') {
        this.#clientId = item.clientId;
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      } else if (item.type === 'emit' && item.event === 'api-session/added' && !this.#sessionId) {
        if (item.args?.[0]?.origin !== 'subagent') this.#follow(item.args?.[0]?.sessionId);
      } else if (item.type === 'waterfall') {
        const kind = item.event === 'approval/request' ? 'approval' : item.event === 'user-questions/request' ? 'question' : null;
        if (!kind || !this.#sessionId || item.agentId !== this.#sessionId) {
          void unary('$events/result', { clientId: this.#clientId, eventId: item.eventId, outcome: { kind: 'next' } }, randomUUID(), { signal: AbortSignal.timeout(5_000) }).catch(() => {});
          return;
        }
        let deliveries = pending.get(item.eventId);
        if (!deliveries) pending.set(item.eventId, deliveries = new Map());
        deliveries.set(this, { clientId: this.#clientId, kind, sessionId: item.agentId });
        this.#emit({ ...item.request, type: `${kind}/requested`, sessionId: item.agentId,
          ...(kind === 'approval' ? { approvalId: item.eventId } : {}),
        }, item.eventId);
      } else if (item.type === 'cancel') {
        const delivery = pending.get(item.eventId)?.get(this);
        if (!delivery) return;
        this.#emit({ type: `${delivery.kind}/resolved`, sessionId: delivery.sessionId,
          approvalId: item.eventId, questionRpcId: item.eventId, outcome: 'cancelled' }, item.eventId);
        pending.get(item.eventId)?.delete(this);
        if (!pending.get(item.eventId)?.size) pending.delete(item.eventId);
      }
    }

    close() {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      if (this.#socket.readyState === 1) {
        for (const streamId of this.#streams.keys()) this.#socket.send(JSON.stringify({ type: 'cancel', streamId }));
      }
      this.#socket.close();
    }
  }

  return {
    fetchImpl: fetchModern,
    createWebSocket(input, options = {}) {
      const url = assertOrigin(input);
      return url.pathname === '/api/events.mux' ? new EventSocket(options.sessionId) : createWebSocket(input);
    },
  };
}
