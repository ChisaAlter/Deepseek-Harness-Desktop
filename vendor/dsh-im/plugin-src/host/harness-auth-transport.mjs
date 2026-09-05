import WebSocket from 'ws';
import { createModernHarnessTransport } from './harness-modern-transport.mjs';

// Use the Host's public token exchange, never its private signing secret.
export function createHarnessAuthTransport(ctx, baseUrl, {
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
} = {}) {
  const origin = new URL(`http://127.0.0.1:${ctx.webServer.port}`).origin;
  if (new URL(baseUrl).origin !== origin
    || typeof ctx.connection?.authenticatedUrl !== 'function'
    || typeof ctx.connection?.authorizeIndex !== 'function') return {};

  function headersFor(target, initial) {
    const url = new URL(target);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.origin !== origin || url.username || url.password) {
      throw new Error('Refusing to send Harness credentials to another origin');
    }
    let cookie;
    ctx.connection.authorizeIndex({
      method: 'GET',
      url: ctx.connection.authenticatedUrl(`${origin}/`),
      headers: { host: new URL(origin).host },
    }, {
      writeHead(status, headers) {
        if (status === 303) cookie = headers?.['set-cookie']?.split(';')[0];
      },
      end() {},
    });
    if (!cookie) throw new Error('Harness did not issue an internal session cookie');
    const headers = new Headers(initial);
    headers.set('cookie', cookie);
    return Object.fromEntries(headers);
  }

  const transport = {
    fetchImpl(url, options = {}) {
      return fetchImpl(url, {
        ...options,
        redirect: 'manual',
        headers: headersFor(url, options.headers),
      });
    },
    createWebSocket(url) {
      return new WebSocketImpl(url, { headers: headersFor(url), followRedirects: false });
    },
  };
  return ctx.typertGateway?.wireStream
    ? createModernHarnessTransport({ baseUrl, ...transport })
    : transport;
}
