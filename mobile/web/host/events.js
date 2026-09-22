function toWs(origin, path) {
  const url = new URL(path, `${String(origin || '').replace(/\/$/, '')}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
}

function listen(socket, type, fn) {
  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener(type, fn);
    return;
  }
  socket.on(type, fn);
}

function parseEnvelope(event) {
  const data = typeof event === 'string' ? event : event?.data;
  if (typeof data !== 'string') return null;
  try {
    const full = JSON.parse(data);
    if (full?.type !== 'server-request') return null;
    return full;
  } catch {
    return null;
  }
}

function openEventSockets({ origin, WebSocketImpl, onMux, onHost, signal }) {
  const Socket = WebSocketImpl || globalThis.WebSocket;
  const mux = new Socket(toWs(origin, '/api/events.mux'));
  const host = new Socket(toWs(origin, '/api/events.host'));
  listen(mux, 'message', (event) => {
    const full = parseEnvelope(event);
    if (full) onMux?.(full);
  });
  listen(host, 'message', (event) => {
    const full = parseEnvelope(event);
    if (full) onHost?.(full);
  });
  const close = () => {
    mux.close?.();
    host.close?.();
  };
  if (signal) {
    if (signal.aborted) close();
    else signal.addEventListener('abort', close, { once: true });
  }
  return { mux, host, close };
}

export { openEventSockets };
