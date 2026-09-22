'use strict';

// Token-feeding + growth model for the live2d pet. Pure-ish: the scanner
// reads dsh-home session logs (zstd-framed JSONL) and the tracker folds
// cumulative usage into persistent growth state kept in config.live2dPet.
// No vendor code is touched and no message content is read — only the
// numeric usage buckets on usage-bearing events.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Worker } = require('node:worker_threads');

// 1 fed token = 1 growth point. Thresholds are cumulative points.
// Growth ladder — each tier carries a theme color used across the status
// card (level badge, growth bar fill, feed button) so the player feels the
// progression visually, not just by name. Ten tiers, ~1.7× per step:
// the first promotion costs 1亿 and maxing out takes ~200亿 — a lifetime
// ladder, not a weekend one. Hue marches cool→warm→gold as she grows from
// a tiny calf to the god of the compute sea.
const LEVELS = [
  { at: 0,            name: '幼鲸',     color: '#7fb3e8' }, // pale blue — baby
  { at: 100_000_000,  name: '小鲸',     color: '#4a90d9' }, // ocean blue — 1亿
  { at: 300_000_000,  name: '干饭鲸',   color: '#3aa8c1' }, // teal — 3亿
  { at: 600_000_000,  name: '鲸鱼娘',   color: '#5b8def' }, // indigo — 6亿
  { at: 1_200_000_000, name: '大肥鱼',  color: '#9b6dd9' }, // violet — 12亿
  { at: 2_200_000_000, name: '干饭大王', color: '#e85d75' }, // crimson — 22亿
  { at: 4_000_000_000, name: '米饭女帝', color: '#f0785a' }, // vermilion — 40亿
  { at: 7_000_000_000, name: '鲸吞四海', color: '#f09a4a' }, // amber — 70亿
  { at: 12_000_000_000, name: '星海饭皇', color: '#f5c04d' }, // gold — 120亿
  { at: 20_000_000_000, name: '干饭真神', color: '#ffe98a' }, // bright gold — 200亿
];

function levelFor(points) {
  let level = 1;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (points >= LEVELS[i].at) {
      level = i + 1;
    }
  }
  return level;
}

function nextLevelAt(points) {
  const lv = levelFor(points);
  return lv < LEVELS.length ? LEVELS[lv].at : null;
}

function levelName(points) {
  return LEVELS[levelFor(points) - 1].name;
}

// Sum of a provider usage bucket set. Reasoning is already inside output
// (same convention as the usage panel).
function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') {
    return 0;
  }
  return (usage.inputTokens || 0)
    + (usage.cacheReadTokens || 0)
    + (usage.cacheWriteTokens || 0)
    + (usage.outputTokens || 0);
}

// Pull a usage sample out of one session-log event. Mirrors the panel's
// usageSampleOf: assistant settlements carry data.usage, stream attempts
// carry the last 'usage' chunk.
function usageSampleOf(event) {
  const data = event?.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  if (event.type === 'assistant/message') {
    return data.usage !== undefined
      ? { turn: data.turn, step: data.step, usage: data.usage }
      : undefined;
  }
  if (event.type === 'assistant/attempt' || event.type === 'assistant/chunk') {
    const chunk = data.chunk && data.chunk.type === 'usage' ? data.chunk
      : Array.isArray(data.stream) ? [...data.stream].reverse().find((c) => c?.type === 'usage')
        : undefined;
    return chunk && chunk.usage !== undefined
      ? { turn: data.turn, step: data.step, usage: chunk.usage }
      : undefined;
  }
  if (event.type === 'compaction/summary' && data.usage !== undefined) {
    // Compaction usage is billed separately — still real spend, so she can
    // eat it, keyed to its own slot so it never collides with a step.
    return { turn: -1, step: event.seq ?? 0, usage: data.usage };
  }
  return undefined;
}

// Fold one decoded log body into `lastWins`: last sample wins per
// (turn,step) — a retried attempt's later settlement replaces the earlier
// one, and a streamed usage chunk never outranks the final settlement.
function foldLogInto(text, lastWins) {
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) !== 123) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const sample = usageSampleOf(event);
    if (sample === undefined) {
      continue;
    }
    lastWins.set(`${sample.turn}:${sample.step}`, usageTokens(sample.usage));
  }
}

function tokensInLog(text) {
  const lastWins = new Map();
  foldLogInto(text, lastWins);
  let total = 0;
  for (const n of lastWins.values()) {
    total += n;
  }
  return total;
}

// Session logs are appended one zstd frame per event batch — a single-frame
// decode only sees the session header. Walk frame boundaries (magic +
// header + blocks + optional checksum) and decompress each frame.
function zstdFrameSize(buf, off) {
  let pos = off + 4; // caller already matched the magic
  if (pos >= buf.length) {
    return 0;
  }
  const fhd = buf[pos];
  pos += 1;
  const fcsFlag = fhd >> 6;
  const singleSeg = (fhd >> 5) & 1;
  const checksum = (fhd >> 2) & 1;
  if (!singleSeg) {
    pos += 1; // window descriptor
  }
  pos += [0, 1, 2, 4][fhd & 3]; // dictionary id
  pos += fcsFlag === 0 ? (singleSeg ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
  for (;;) {
    if (pos + 3 > buf.length) {
      return 0;
    }
    const bh = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16);
    pos += 3;
    const last = bh & 1;
    const type = (bh >> 1) & 3;
    // RLE blocks store a single byte; raw/compressed/treeless store `size`.
    pos += type === 1 ? 1 : (bh >> 3);
    if (last) {
      break;
    }
  }
  if (checksum) {
    pos += 4;
  }
  return pos <= buf.length ? pos - off : 0;
}

function zstdDecompressAll(buf) {
  const parts = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const magic = buf.readUInt32LE(off);
    if (magic === 0xFD2FB528) {
      const size = zstdFrameSize(buf, off);
      if (!size) {
        break;
      }
      parts.push(zlib.zstdDecompressSync(buf.subarray(off, off + size)));
      off += size;
    } else if ((magic & 0xFFFFFFF0) === 0x184D2A50) {
      off += 8 + buf.readUInt32LE(off + 4); // skippable frame
    } else {
      break; // trailing garbage — keep what decoded cleanly
    }
  }
  return Buffer.concat(parts);
}

// Cumulative tokens across every session under `sessionsDir`
// (<workspace>/<session-id>/session*.jsonl.zstd). A migrated session leaves
// both a v1 and a v2 log of the SAME events, so dedup keys are per session
// directory — summing files naively double-counts migrated sessions.
// Unreadable or empty files count as zero — the bowl never breaks on a
// half-written log.
//
// `cache` (optional) is a Map<filePath, {size, mtimeMs, usage:Map}> owned by
// the caller across scans: a file whose size+mtime are unchanged replays its
// folded usage map without re-reading or re-decompressing — the steady-state
// 60s rescan costs one stat per log instead of a full corpus decode.
function scanSessionTokens(sessionsDir, cache) {
  const fileCache = cache instanceof Map ? cache : null;
  const seen = fileCache ? new Set() : null;
  let total = 0;
  let sessions = 0;
  const stack = [sessionsDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const lastWins = new Map();
    let files = 0;
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!ent.isFile() || !/^session(?:\.v\d+)?\.jsonl\.zstd$/.test(ent.name)) {
        continue;
      }
      let usageMap = null;
      if (fileCache) {
        seen.add(p);
        let st = null;
        try {
          st = fs.statSync(p);
        } catch {
          continue; // vanished between readdir and stat
        }
        const hit = fileCache.get(p);
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
          usageMap = hit.usage;
          files += 1;
        } else {
          let text;
          try {
            text = zstdDecompressAll(fs.readFileSync(p)).toString('utf8');
          } catch {
            continue;
          }
          usageMap = new Map();
          foldLogInto(text, usageMap);
          fileCache.set(p, { size: st.size, mtimeMs: st.mtimeMs, usage: usageMap });
          files += 1;
        }
      } else {
        let text;
        try {
          text = zstdDecompressAll(fs.readFileSync(p)).toString('utf8');
        } catch {
          continue;
        }
        usageMap = new Map();
        foldLogInto(text, usageMap);
        files += 1;
      }
      // Merge per-file maps in directory order — a later log's sample wins
      // on a shared (turn,step) key, same as folding raw text did.
      for (const [k, v] of usageMap) {
        lastWins.set(k, v);
      }
    }
    if (files > 0) {
      sessions += 1;
      for (const n of lastWins.values()) {
        total += n;
      }
    }
  }
  if (fileCache) {
    for (const key of fileCache.keys()) {
      if (!seen.has(key)) {
        fileCache.delete(key);
      }
    }
  }
  return { total, sessions };
}

// Local calendar day key — "今日" means the user's own midnight boundary,
// not UTC.
function dayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    + `-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeGrowthState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const todaySrc = source.today && typeof source.today === 'object' ? source.today : null;
  return {
    points: num(source.points),
    tokensFed: num(source.tokensFed),
    tokensSeen: num(source.tokensSeen),
    // null = watermark not yet planted (first refresh sets it).
    baseline: Number.isFinite(source.baseline) && source.baseline >= 0
      ? Math.floor(source.baseline) : null,
    // {day, used} — tokens burned on the current local day. null until the
    // first refresh plants it (the historical corpus is NOT today's burn).
    today: todaySrc && typeof todaySrc.day === 'string' && todaySrc.day
      ? { day: todaySrc.day, used: num(todaySrc.used) } : null,
  };
}

// Plain-node worker threads cannot read inside app.asar; the scan worker
// entry and this module ship via asarUnpack, same convention as
// dshd-daemon-runner.
function unpackedPath(file) {
  return file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

// Main-thread handle to pet-growth-scan-worker.js. The worker owns the
// per-file decode cache; requests are serialized by the worker's message
// loop. A crashed worker is respawned on the next scan; close() is terminal.
function createScanWorker({ workerFile } = {}) {
  const file = workerFile || unpackedPath(path.join(__dirname, 'pet-growth-scan-worker.js'));
  let worker = null;
  let closed = false;
  let seq = 0;
  const pending = new Map();

  function drop(err) {
    for (const p of pending.values()) {
      p.reject(err);
    }
    pending.clear();
    worker = null;
  }

  function ensure() {
    if (worker) {
      return worker;
    }
    const w = new Worker(file);
    // Idle worker must not keep the app alive; dispose() terminates it.
    w.unref?.();
    w.on('message', (msg) => {
      const p = pending.get(msg && msg.id);
      if (!p) {
        return;
      }
      pending.delete(msg.id);
      if (msg.ok) {
        p.resolve({ total: msg.total, sessions: msg.sessions });
      } else {
        p.reject(new Error(msg.error || 'session scan failed'));
      }
    });
    w.on('error', (err) => drop(err));
    w.on('exit', (code) => {
      if (code === 0) {
        worker = null;
      } else {
        drop(new Error(`pet scan worker exited with code ${code}`));
      }
    });
    worker = w;
    return w;
  }

  return {
    scan(sessionsDir) {
      if (closed) {
        return Promise.reject(new Error('pet scan worker closed'));
      }
      return new Promise((resolve, reject) => {
        let w;
        try {
          w = ensure();
        } catch (err) {
          reject(err);
          return;
        }
        const id = ++seq;
        pending.set(id, { resolve, reject });
        try {
          w.postMessage({ type: 'scan', id, sessionsDir: sessionsDir || '' });
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    },
    async close() {
      closed = true;
      const w = worker;
      drop(new Error('pet scan worker closed'));
      if (w) {
        try {
          await w.terminate();
        } catch {}
      }
    },
  };
}

// Owns growth bookkeeping: `tokensSeen` tracks the scan's cumulative total,
// `baseline` the food watermark planted at first scan, and `tokensFed` how
// much above that watermark she has already eaten. Only tokens burned AFTER
// the feature first scanned are food — the historical backlog is not feed
// stock. Idempotent across restarts and rescan-safe.
//
// `scanTokens` (optional) injects the corpus scan — sync or Promise of
// {total, sessions}. Production default is the worker-backed scanner so the
// Electron main thread never pays the decode; tests inject the in-process
// scan for determinism.
function createGrowthTracker({ sessionsDir, getGrowth, saveGrowth, scanTokens }) {
  const scanner = scanTokens
    ? { scan: (dir) => scanTokens(dir) }
    : createScanWorker();
  function read() {
    return normalizeGrowthState(getGrowth?.());
  }

  function write(next) {
    saveGrowth?.(normalizeGrowthState(next));
  }

  // refresh() is async now that the scan lives off-thread; concurrent
  // callers (60s tick vs feed/status IPCs) share one in-flight scan instead
  // of queueing duplicate corpus reads.
  let inFlight = null;
  function refresh() {
    if (!inFlight) {
      inFlight = (async () => {
        const { total } = await scanner.scan(sessionsDir);
        const g = read();
        // First scan plants the watermark at corpus-minus-eaten so already-fed
        // credit survives the upgrade; later the watermark only follows the
        // corpus DOWN (logs deleted → that ceiling is gone for good).
        const baseline = g.baseline === null
          ? Math.max(0, total - g.tokensFed)
          : Math.min(g.baseline, total);
        // tokensFed deliberately stays put when the corpus shrinks: feedable
        // clamps at zero below, and keeping the fed credit prevents re-feeding
        // the same tokens if the logs ever come back.
        const delta = Math.max(0, total - g.tokensSeen);
        const day = dayKey();
        const today = g.baseline === null
          ? { day, used: 0 }
          : { day, used: (g.today && g.today.day === day ? g.today.used : 0) + delta };
        const next = { ...g, tokensSeen: total, baseline, today };
        if (next.tokensSeen !== g.tokensSeen || next.baseline !== g.baseline
            || !g.today || next.today.used !== g.today.used || next.today.day !== g.today.day) {
          write(next);
        }
        return next;
      })().finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  function close() {
    return scanner.close?.();
  }

  function feedable(state) {
    const g = state || read();
    const pool = g.baseline === null ? 0 : Math.max(0, g.tokensSeen - g.baseline);
    return Math.max(0, pool - g.tokensFed);
  }

  // How much she can eat in one meal: a small whale can't swallow a whole
  // backlog at once, so a single feed fills at most the current level —
  // each 投喂 is one level-up celebration, not an instant max-out.
  function mealSize(g) {
    const next = nextLevelAt(g.points);
    return next === null ? Infinity : Math.max(0, next - g.points);
  }

  function snapshot(state) {
    const g = state || read();
    const can = feedable(g);
    const lv = levelFor(g.points);
    const next = nextLevelAt(g.points);
    return {
      points: g.points,
      level: lv,
      levelName: LEVELS[lv - 1].name,
      levelColor: LEVELS[lv - 1].color,
      nextAt: next,
      nextName: next === null ? null : LEVELS[lv].name,
      nextColor: next === null ? null : LEVELS[lv].color,
      // Full ladder for the renderer's tier-dot bar — no main-process
      // require in the pet renderer (it's a standalone script).
      levels: LEVELS.map((l) => ({ at: l.at, name: l.name })),
      tokensFed: g.tokensFed,
      tokensSeen: g.tokensSeen,
      feedable: can,
      nextFeed: Math.min(can, mealSize(g)),
      // Tokens burned on the current local day — the live "how much did
      // the harness actually consume today" meter on the status card.
      todayUsed: g.today && g.today.day === dayKey() ? g.today.used : 0,
    };
  }

  // Feed `amount` tokens (default: a full meal). Returns the post-feed
  // snapshot plus {fed, leveledUp}.
  function feed(amount) {
    const before = read();
    const available = feedable(before);
    const fed = Math.max(0, Math.min(
      Number.isFinite(amount) ? Math.floor(amount) : available,
      available,
      mealSize(before),
    ));
    const was = levelFor(before.points);
    const next = {
      ...before,
      points: before.points + fed,
      tokensFed: before.tokensFed + fed,
      tokensSeen: before.tokensSeen,
    };
    write(next);
    const snap = snapshot(next);
    return { ...snap, fed, leveledUp: snap.level > was };
  }

  return { refresh, feedable, snapshot, feed, close };
}

module.exports = {
  LEVELS,
  levelFor,
  nextLevelAt,
  levelName,
  usageTokens,
  usageSampleOf,
  tokensInLog,
  scanSessionTokens,
  normalizeGrowthState,
  createGrowthTracker,
  createScanWorker,
  dayKey,
  zstdDecompressAll,
  zstdFrameSize,
};
