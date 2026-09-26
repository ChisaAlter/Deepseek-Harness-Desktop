'use strict';

// launcher-notes v2.0.0 — same local notes service as v1 plus a /stats
// endpoint and an endpoint listing, so an update is observable over HTTP
// (GET / reports version 2.0.0 and /stats answers 200 instead of 404).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ID = 'launcher-notes';
const VERSION = '2.0.0';
const ENDPOINTS = ['GET /', 'GET /state', 'GET /notes', 'POST /notes', 'GET /stats'];
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
    endpoints: ENDPOINTS,
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
      endpoints: ENDPOINTS,
      notes: readNotes(),
    });
  }
  if (req.method === 'GET' && url.pathname === '/notes') {
    return sendJson(res, 200, { notes: readNotes() });
  }
  if (req.method === 'GET' && url.pathname === '/stats') {
    const notes = readNotes();
    return sendJson(res, 200, {
      id: ID,
      version: VERSION,
      notes: notes.length,
      chars: notes.reduce((sum, note) => sum + String(note.text || '').length, 0),
      uptimeSec: Math.floor(process.uptime()),
      since: startedAt,
    });
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
