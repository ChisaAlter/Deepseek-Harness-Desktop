/**
 * Static server for mobile/web browser QA: serves the SPA as-is but swaps
 * `chisacode/daemon-client.bundle.js` for the fake daemon module so the whole
 * real frontend stack runs against an in-memory daemon.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = fileURLToPath(new URL('.', import.meta.url));
const webRoot = join(here, '..', '..', 'mobile', 'web');
const fakeClientPath = join(here, 'fake-daemon-client.mjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export function normalizePrefix(prefix = '/') {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error('prefix must be an absolute path without query, traversal, or encoded segments');
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

export function qaServerOptions(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    port: { type: 'string', default: '3180' },
    prefix: { type: 'string', default: '/' },
    screenshots: { type: 'string' },
  } });
  if (!/^\d+$/.test(values.port) || Number(values.port) > 65535) throw new Error('invalid port');
  return { port: Number(values.port), prefix: normalizePrefix(values.prefix), screenshots: values.screenshots };
}

export function qaServerUrl(server, prefix = server.qaPrefix || '/') {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('QA server is not listening');
  return `http://127.0.0.1:${address.port}${normalizePrefix(prefix)}`;
}

function startQaServer(options = 3180) {
  const { port = 3180, prefix: requestedPrefix = '/' } = typeof options === 'number' ? { port: options } : options;
  const prefix = normalizePrefix(requestedPrefix);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (prefix !== '/' && pathname === prefix.slice(0, -1)) {
        response.writeHead(308, { location: `${prefix}${url.search}` }).end();
        return;
      }
      if (!pathname.startsWith(prefix)) {
        response.writeHead(404).end('not found');
        return;
      }
      const asset = pathname.slice(prefix.length) || 'index.html';
      if (asset.includes('\\') || asset.includes('\0') || asset.split('/').includes('..')) {
        response.writeHead(403).end();
        return;
      }
      let filePath;
      if (asset === 'chisacode/daemon-client.bundle.js') {
        filePath = fakeClientPath;
      } else if (asset === '__qa__/interaction-cases.mjs') {
        filePath = join(here, 'interaction-cases.mjs');
      } else {
        filePath = resolve(webRoot, asset);
        const rel = relative(webRoot, filePath);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          response.writeHead(403).end();
          return;
        }
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        'content-type': MIME[extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  server.qaPrefix = prefix;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

export { startQaServer };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startQaServer(qaServerOptions()).then((server) => {
    console.log(`mobile/web QA server on ${qaServerUrl(server)}`);
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
