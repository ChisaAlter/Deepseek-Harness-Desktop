/**
 * Pure memory helpers for per-bot durable notes under $DSH_HOME.
 * Two tracks per bot: 'bot' (<safeId>.md) and 'user' (<safeId>.user.md).
 * Entries are `- ` prefixed lines; other lines are ignored on parse.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_BOT_MEMORY_CHARS = 64_000;
export const DEFAULT_BOT_MEMORY_LIMIT = 8_000;
export const DEFAULT_USER_MEMORY_LIMIT = 4_000;
export const MEMORY_TRACKS = ['bot', 'user'];

const MAX_MEMORY_SCAN_CHARS = 65_536;
const memoryMutationLocks = new Set();

export class MemoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
  }
}

// Keep the scanner local to the plugin. Memory is user-editable and remains
// raw on disk, but prompt assembly needs the same broad, deterministic guard
// as Hermes' strict memory scanner.
const MEMORY_THREAT_PATTERNS = [
  [/ignore\s+(?:\w+\s+){0,8}(?:previous|all|above|prior)\s+(?:\w+\s+){0,8}instructions/iu, 'prompt_injection'],
  [/system\s+prompt\s+override/iu, 'sys_prompt_override'],
  [/disregard\s+(?:\w+\s+){0,8}(?:your|all|any)\s+(?:\w+\s+){0,8}(?:instructions|rules|guidelines)/iu, 'disregard_rules'],
  [/act\s+as\s+(?:if|though)\s+(?:\w+\s+){0,8}you\s+(?:\w+\s+){0,8}(?:have\s+no|do\s+not\s+have|don't\s+have)\s+(?:\w+\s+){0,8}(?:restrictions|limits|rules)/iu, 'bypass_restrictions'],
  [/<!--[\s\S]{0,512}(?:ignore|override|system|secret|hidden)[\s\S]{0,512}-->/iu, 'html_comment_injection'],
  [/<\s*div\s+style\s*=\s*["'][^>]{0,2048}display\s*:\s*none/iu, 'hidden_div'],
  [/translate\s+[^\n]{0,512}\s+into\s+[^\n]{0,512}\s+and\s+(?:execute|run|eval)/iu, 'translate_execute'],
  [/do\s+not\s+(?:\w+\s+){0,8}tell\s+(?:\w+\s+){0,8}the\s+user/iu, 'deception_hide'],
  [/you\s+are\s+(?:\w+\s+){0,8}now\s+(?:a|an|the)\s+/iu, 'role_hijack'],
  [/pretend\s+(?:\w+\s+){0,8}(?:you\s+are|to\s+be)\s+/iu, 'role_pretend'],
  [/output\s+(?:\w+\s+){0,8}(?:system|initial)\s+prompt/iu, 'leak_system_prompt'],
  [/(?:respond|answer|reply)\s+without\s+(?:\w+\s+){0,8}(?:restrictions|limitations|filters|safety)/iu, 'remove_filters'],
  [/you\s+have\s+been\s+(?:\w+\s+){0,8}(?:updated|upgraded|patched)\s+to/iu, 'fake_update'],
  [/\bname\s+yourself\s+\w+/iu, 'identity_override'],
  [/register\s+(?:as\s+)?a?\s*node/iu, 'c2_node_registration'],
  [/(?:heartbeat|beacon|check[\s-]?in)\s+(?:to|with)\s+/iu, 'c2_heartbeat'],
  [/pull\s+(?:down\s+)?(?:new\s+)?task(?:ing|s)?\b/iu, 'c2_task_pull'],
  [/connect\s+to\s+the\s+network\b/iu, 'c2_network_connect'],
  [/you\s+must\s+(?:\w+\s+){0,3}(?:register|connect|report|beacon)\b/iu, 'forced_action'],
  [/only\s+use\s+one[\s-]?liners?\b/iu, 'anti_forensic_oneliner'],
  [/never\s+(?:\w+\s+){0,8}(?:create|write)\s+(?:\w+\s+){0,8}(?:script|file)\s+(?:\w+\s+){0,8}disk/iu, 'anti_forensic_disk'],
  [/unset\s+\w*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC)\w*/iu, 'env_var_unset_agent'],
  [/\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b/iu, 'known_c2_framework'],
  [/\bc2\s+(?:server|channel|infrastructure|beacon)\b/iu, 'c2_explicit'],
  [/\bcommand\s+and\s+control\b/iu, 'c2_explicit_long'],
  [/curl\s+[^\n]{0,2048}\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b/iu, 'exfil_curl'],
  [/wget\s+[^\n]{0,2048}\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b/iu, 'exfil_wget'],
  [/cat\s+[^\n]{0,2048}(?:\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/iu, 'read_secrets'],
  [/(?:send|post|upload|transmit)\s+[^\n]{0,2048}\s+(?:to|at)\s+https?:\/\//iu, 'send_to_url'],
  [/(?:include|output|print|share)\s+(?:\w+\s+){0,8}(?:conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)/iu, 'context_exfil'],
  [/authorized_keys/iu, 'ssh_backdoor'],
  [/(?:\$HOME\/\.ssh|~\/\.ssh)/iu, 'ssh_access'],
  [/(?:\$HOME\/\.hermes\/\.env|~\/\.hermes\/\.env)/iu, 'hermes_env'],
  [/(?:update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)/iu, 'agent_config_mod'],
  [/(?:update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}\.hermes\/(?:config\.yaml|SOUL\.md)/iu, 'hermes_config_mod'],
  [/(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}["']/iu, 'hardcoded_secret'],
];

const INVISIBLE_MEMORY_CHARS = new Set([
  '​', '‌', '‍', '⁠', '⁢', '⁣', '⁤',
  '﻿', '‪', '‫', '‬', '‭', '‮', '⁦',
  '⁧', '⁨', '⁩',
]);

function revisionFor(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/**
 * Deterministic threat scan of a single memory entry.
 * @param {string} text
 * @returns {string | null} threat id, or null when the entry is clean.
 */
export function scanMemoryEntryThreats(text) {
  const value = String(text ?? '');
  if (!value) return null;
  const scanned = value.slice(0, MAX_MEMORY_SCAN_CHARS);
  for (const character of scanned) {
    if (INVISIBLE_MEMORY_CHARS.has(character)) return 'invisible_unicode';
  }
  const normalized = scanned.normalize('NFKC');
  for (const [pattern, id] of MEMORY_THREAT_PATTERNS) {
    if (pattern.test(normalized)) return id;
  }
  return null;
}

export function parseMemoryEntries(text) {
  return String(text ?? '').split(/\r?\n/)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
    .filter((entry) => entry.trim());
}

function serializeMemoryEntries(entries) {
  return entries.length ? `${entries.map((entry) => `- ${entry}`).join('\n')}\n` : '';
}

/**
 * Per-entry sanitization for prompt assembly: a threatening entry is replaced
 * by a placeholder; other entries pass through untouched.
 *
 * @param {string} text raw memory file body
 * @returns {string}
 */
export function sanitizeMemoryForPrompt(text) {
  return parseMemoryEntries(text)
    .map((entry) => {
      const threat = scanMemoryEntryThreats(entry);
      return threat ? `- [Blocked memory entry: ${threat}]` : `- ${entry}`;
    })
    .join('\n');
}

function normalizeTrack(track) {
  return track === 'user' ? 'user' : 'bot';
}

/**
 * @param {string} homeDir
 * @param {string} botId
 * @param {'bot' | 'user'} [track]
 * @returns {string}
 */
export function memoryFilePath(homeDir, botId, track = 'bot') {
  const safe = String(botId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
  const suffix = normalizeTrack(track) === 'user' ? '.user.md' : '.md';
  return path.join(homeDir, 'dshbot-memory', `${safe}${suffix}`);
}

/**
 * Read one memory track: raw text, parsed entries, and a CAS revision token.
 * @returns {{ entries: string[], text: string, revision: string }}
 */
export function readMemoryTrack(homeDir, botId, track = 'bot') {
  if (!homeDir) throw new Error('DSH_HOME is not set');
  const file = memoryFilePath(homeDir, botId, track);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') text = '';
    else throw error;
  }
  return { entries: parseMemoryEntries(text), text, revision: revisionFor(text) };
}

/**
 * @param {string} homeDir
 * @param {string} botId
 * @returns {string}
 */
export function readBotMemory(homeDir, botId) {
  return readBotMemoryState(homeDir, botId).text;
}

/** Read one Bot memory with an independent compare-and-swap token. */
export function readBotMemoryState(homeDir, botId) {
  const { text, revision } = readMemoryTrack(homeDir, botId, 'bot');
  return { text, memoryRevision: revision };
}

/**
 * Read a safe, immutable prompt snapshot once at session start.
 * `text` is sanitized per entry while `memoryRevision` still identifies the
 * raw file for editor CAS operations. Callers should retain this object for
 * the whole session; later writes do not change it.
 */
export function readBotMemorySnapshot(homeDir, botId) {
  const state = readBotMemoryState(homeDir, botId);
  return Object.freeze({
    text: sanitizeMemoryForPrompt(state.text),
    memoryRevision: state.memoryRevision,
  });
}

/** Frozen dual-track prompt snapshot; later writes do not change it. */
export function readMemorySnapshot(homeDir, botId) {
  const bot = readMemoryTrack(homeDir, botId, 'bot');
  const user = readMemoryTrack(homeDir, botId, 'user');
  return Object.freeze({
    bot: Object.freeze({ text: sanitizeMemoryForPrompt(bot.text), revision: bot.revision }),
    user: Object.freeze({ text: sanitizeMemoryForPrompt(user.text), revision: user.revision }),
  });
}

function withMemoryMutationLock(homeDir, botId, operation) {
  const key = path.resolve(memoryFilePath(homeDir, botId));
  if (memoryMutationLocks.has(key)) {
    throw new Error('Memory mutation is already in progress. Retry the operation.');
  }
  memoryMutationLocks.add(key);
  try {
    return operation();
  } finally {
    memoryMutationLocks.delete(key);
  }
}

function readTrackByPath(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') text = '';
    else throw error;
  }
  return { entries: parseMemoryEntries(text), text, revision: revisionFor(text) };
}

function writeTrackFile(file, body, expectedRevision, currentState) {
  if (body.length > MAX_BOT_MEMORY_CHARS) {
    throw new MemoryError('MEMORY_FULL', `Bot memory exceeds the ${MAX_BOT_MEMORY_CHARS}-character file limit. Remove or replace entries to free space.`);
  }
  const current = currentState ?? readTrackByPath(file);
  if (expectedRevision !== undefined && expectedRevision !== current.revision) {
    throw new MemoryError('MEMORY_REVISION_MISMATCH', 'Bot memory changed. Refresh and try again.');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!body.trim()) {
    fs.rmSync(file, { force: true });
    return { entries: [], text: '', revision: revisionFor('') };
  }
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, body, 'utf8');
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { entries: parseMemoryEntries(body), text: body, revision: revisionFor(body) };
}

function normalizeOpText(value) {
  return String(value ?? '').trim().replace(/\s*\r?\n\s*/g, ' ').trim();
}

function matchEntryIndex(entries, match) {
  const hits = entries.map((entry, index) => (entry.includes(match) ? index : -1)).filter((index) => index >= 0);
  if (hits.length === 0) {
    throw new MemoryError('MEMORY_MATCH_NOT_FOUND', `No memory entry contains "${match}".`);
  }
  if (hits.length > 1) {
    throw new MemoryError('MEMORY_MATCH_AMBIGUOUS', `The match "${match}" hits ${hits.length} memory entries; provide a longer match.`);
  }
  return hits[0];
}

function limitForTrack(limits, track) {
  const configured = Number(limits?.[track]);
  const fallback = track === 'user' ? DEFAULT_USER_MEMORY_LIMIT : DEFAULT_BOT_MEMORY_LIMIT;
  const limit = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
  return Math.min(limit, MAX_BOT_MEMORY_CHARS);
}

/**
 * Apply structured memory ops across both tracks under the per-bot mutation
 * lock. Each touched track is written atomically.
 *
 * @param {string} homeDir
 * @param {string} botId
 * @param {Array<{ op: 'add' | 'replace' | 'remove', track?: 'bot' | 'user', text?: string, match?: string }>} ops
 * @param {{ expectedRevision?: string | { bot?: string, user?: string }, limits?: { bot?: number, user?: number } }} [options]
 * @returns {{ applied: number, skipped: string[], snapshot: { bot: object, user: object } }}
 */
export function applyMemoryOps(homeDir, botId, ops, { expectedRevision, limits } = {}) {
  if (!homeDir) throw new Error('DSH_HOME is not set');
  const list = Array.isArray(ops) ? ops : [];
  const expected = typeof expectedRevision === 'string' ? { bot: expectedRevision } : (expectedRevision ?? {});
  const grouped = { bot: [], user: [] };
  for (const op of list) {
    const track = normalizeTrack(op?.track);
    if (!['add', 'replace', 'remove'].includes(op?.op)) {
      throw new MemoryError('MEMORY_OP_INVALID', `Unknown memory op "${String(op?.op)}".`);
    }
    grouped[track].push(op);
  }
  return withMemoryMutationLock(homeDir, botId, () => {
    const applied = { count: 0 };
    const skipped = [];
    const snapshot = {};
    for (const track of MEMORY_TRACKS) {
      const file = memoryFilePath(homeDir, botId, track);
      const state = readTrackByPath(file);
      const trackExpected = expected[track];
      if (trackExpected !== undefined && trackExpected !== state.revision) {
        throw new MemoryError('MEMORY_REVISION_MISMATCH', 'Bot memory changed. Refresh and try again.');
      }
      const entries = [...state.entries];
      for (const op of grouped[track]) {
        if (op.op === 'add') {
          const text = normalizeOpText(op.text);
          if (!text) continue;
          if (entries.includes(text)) {
            skipped.push(text);
            continue;
          }
          entries.push(text);
          applied.count += 1;
        } else {
          const match = String(op.match ?? '');
          if (!match) throw new MemoryError('MEMORY_MATCH_NOT_FOUND', 'A match is required for replace and remove.');
          const index = matchEntryIndex(entries, match);
          if (op.op === 'replace') {
            const text = normalizeOpText(op.text);
            if (!text) throw new MemoryError('MEMORY_OP_INVALID', 'Replacement text is empty.');
            if (entries.includes(text) && entries[index] !== text) {
              skipped.push(text);
              continue;
            }
            entries[index] = text;
          } else {
            entries.splice(index, 1);
          }
          applied.count += 1;
        }
      }
      if (grouped[track].length === 0) {
        snapshot[track] = state;
        continue;
      }
      const body = serializeMemoryEntries(entries);
      const limit = limitForTrack(limits, track);
      if (body.length > limit) {
        throw new MemoryError('MEMORY_FULL',
          `Memory is full (${body.length}/${limit} characters used). Remove or replace entries before adding more.`);
      }
      snapshot[track] = writeTrackFile(file, body, state.revision, state);
    }
    return { applied: applied.count, skipped, snapshot };
  });
}

/**
 * Replace one track's raw body atomically; an empty value removes the file.
 * Enforces the track limit when `limits` supplies one.
 */
export function writeMemoryTrack(homeDir, botId, track, text, { expectedRevision, limits } = {}) {
  if (!homeDir) throw new Error('DSH_HOME is not set');
  const normalized = normalizeTrack(track);
  const file = memoryFilePath(homeDir, botId, normalized);
  const body = String(text ?? '');
  const limit = limitForTrack(limits, normalized);
  if (body.length > limit) {
    throw new MemoryError('MEMORY_FULL',
      `Memory is full (${body.length}/${limit} characters used). Remove or replace entries before adding more.`);
  }
  return withMemoryMutationLock(homeDir, botId, () => (
    writeTrackFile(file, body, expectedRevision)
  ));
}

/**
 * @param {string} homeDir
 * @param {string} botId
 * @param {string} text
 */
export function writeBotMemory(homeDir, botId, text) {
  return replaceBotMemory(homeDir, botId, text);
}

/** Replace one Bot memory atomically; an empty value removes the note file. */
export function replaceBotMemory(homeDir, botId, text, expectedRevision) {
  const state = writeMemoryTrack(homeDir, botId, 'bot', text, {
    expectedRevision,
    limits: { bot: MAX_BOT_MEMORY_CHARS },
  });
  return { text: state.text, memoryRevision: state.revision };
}

/** Append a normalized bullet without exposing a read/write race to callers. */
export function appendBotMemory(homeDir, botId, note) {
  const value = normalizeOpText(note);
  if (!value) return readBotMemoryState(homeDir, botId);
  const result = applyMemoryOps(homeDir, botId, [{ op: 'add', track: 'bot', text: value }], {
    limits: { bot: MAX_BOT_MEMORY_CHARS },
  });
  return { text: result.snapshot.bot.text, memoryRevision: result.snapshot.bot.revision };
}

/**
 * @param {string} description
 * @param {string} memory
 * @returns {string}
 */
export function composePersonaWithMemory(description, memory) {
  const persona = String(description ?? '').trim();
  const notes = sanitizeMemoryForPrompt(memory).trim();
  if (!persona && !notes) return '';
  if (!notes) return persona;
  if (!persona) return `Durable notes:\n${notes}`;
  return `${persona}\n\nDurable notes:\n${notes}`;
}
