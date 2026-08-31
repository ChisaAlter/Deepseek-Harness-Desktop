'use strict';

/**
 * Harness `/api/events.mux` is SSE (`text/event-stream`), not WebSocket.
 * Daemon must parse `data:` frames the same way dsh web `readSse` does.
 */

function consumeSse(buffer) {
  let rest = typeof buffer === 'string' ? buffer : '';
  const envelopes = [];
  let boundary = rest.indexOf('\n\n');
  while (boundary !== -1) {
    const chunk = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .join('');
    if (data) {
      try {
        const full = JSON.parse(data);
        if (full && full.type === 'server-request' && typeof full.rpcId === 'string') {
          envelopes.push(full);
        }
      } catch {
        /* drop malformed frame; keep the stream */
      }
    }
    boundary = rest.indexOf('\n\n');
  }
  return { envelopes, rest };
}

/** Chunks already land in session.history; forwarding them over E2EE starves approval frames. */
const MUX_DROP_EVENT_TYPES = new Set(['assistant/chunk']);

function shouldForwardMuxEnvelope(envelope) {
  const payload = envelope && typeof envelope === 'object' ? envelope.payload : null;
  if (!payload || typeof payload !== 'object') return true;
  if (payload.type !== 'session/event') return true;
  const eventType = payload.event && typeof payload.event === 'object' ? payload.event.type : '';
  return !MUX_DROP_EVENT_TYPES.has(eventType);
}

async function openMuxSse({ origin, onEnvelope, fetchImpl, signal }) {
  const raw = typeof origin === 'string' ? origin.trim() : '';
  if (!raw) throw new Error('桌面端未启动');
  const originUrl = new URL(raw);
  const target = new URL('/api/events.mux', `${originUrl.origin}/`);
  const fetchFn = fetchImpl || globalThis.fetch;
  const response = await fetchFn(target.href, {
    headers: {
      accept: 'text/event-stream',
      'accept-encoding': 'identity',
      host: `${originUrl.hostname}:${originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')}`,
    },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`mux SSE HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const consumed = consumeSse(buffer);
    buffer = consumed.rest;
    for (const envelope of consumed.envelopes) {
      if (shouldForwardMuxEnvelope(envelope)) onEnvelope(envelope);
    }
  }
}

module.exports = { consumeSse, openMuxSse, shouldForwardMuxEnvelope };
