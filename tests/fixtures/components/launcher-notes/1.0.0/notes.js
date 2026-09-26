'use strict';

// launcher-notes v1.0.0 — sample service component for the launcher
// components platform. Contract with the launcher supervisor:
//   LAUNCHER_COMPONENT_DATA_DIR  — persistent per-component data dir
//   state.json inside it          — {pid, version, port, url, heartbeatAt}
//                                   refreshed as heartbeat so the panel can
//                                   observe liveness beyond the pid.
// The process binds 127.0.0.1 on an ephemeral port and serves a tiny notes
// API; it is supposed to die when the launcher kills its pid (taskkill /T /F).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ID = 'launcher-notes';
const VERSION = '1.0.0';
const dataDir = process.env.LAUNCHER_COMPONENT_DATA_DIR || path.join(__dirname, 'data');
const stateFile = path.join(dataDir, 'state.json');
const notesFile = path.join(dataDir, 'notes.json');
const startedAt = new Date().toISOString();

function readNotes() {
  try {
    const parsed = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function heartbeat(port) {
  writeJson(stateFile, {
    id: ID,
    pid: process.pid,
    version: VERSION,
    port,
    url: `http://127.0.0.1:${port}/`,
    startedAt,
    heartbeatAt: new Date().toISOString(),
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req, cb) {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 64 * 1024) {
      req.destroy();
    }
  });
  req.on('end', () => cb(raw));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/state')) {
    return sendJson(res, 200, {
      id: ID,
      name: 'launcher-notes',
      version: VERSION,
      pid: process.pid,
      startedAt,
      uptimeSec: Math.floor(process.uptime()),
      notes: readNotes(),
    });
  }
  if (req.method === 'GET' && url.pathname === '/notes') {
    return sendJson(res, 200, { notes: readNotes() });
  }
  if (req.method === 'POST' && url.pathname === '/notes') {
    return readBody(req, (raw) => {
      let text = '';
      try {
        const parsed = JSON.parse(raw || '{}');
        text = typeof parsed.text === 'string' ? parsed.text : '';
      } catch {
        text = String(raw || '');
      }
      text = text.trim().slice(0, 2000);
      if (!text) {
        return sendJson(res, 400, { error: 'empty-note' });
      }
      const notes = readNotes();
      const note = { text, at: new Date().toISOString() };
      notes.push(note);
      writeJson(notesFile, notes);
      return sendJson(res, 201, { ok: true, note, total: notes.length });
    });
  }
  return sendJson(res, 404, { error: 'not-found', id: ID, version: VERSION });
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  heartbeat(port);
  setInterval(() => heartbeat(port), 2000);
  process.stdout.write(`${ID} ${VERSION} listening on http://127.0.0.1:${port}/\n`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
