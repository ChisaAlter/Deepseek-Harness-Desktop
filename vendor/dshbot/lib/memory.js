/**
 * Pure memory helpers for per-bot durable notes under $DSH_HOME.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_BOT_MEMORY_CHARS = 64_000;

const MAX_MEMORY_SCAN_CHARS = 65_536;
const memoryMutationLocks = new Set();

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
  '\u200B', '\u200C', '\u200D', '\u2060', '\u2062', '\u2063', '\u2064',
  '\uFEFF', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066',
  '\u2067', '\u2068', '\u2069',
]);

function revisionFor(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

function firstMemoryThreat(text) {
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

/**
 * Remove memory content from the prompt when it resembles promptware or
 * exfiltration content. The raw value is never included in the replacement.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeMemoryForPrompt(text) {
  const value = String(text ?? '');
  const threat = firstMemoryThreat(value);
  if (!threat) return value;
  return `[Blocked memory content: ${threat}; original text omitted.]`;
}

/**
 * @param {string} homeDir
 * @param {string} botId
 * @returns {string}
 */
export function memoryFilePath(homeDir, botId) {
  const safe = String(botId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(homeDir, 'dshbot-memory', `${safe || 'unknown'}.md`);
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
  if (!homeDir) throw new Error('DSH_HOME is not set');
  const file = memoryFilePath(homeDir, botId);
  try {
    const text = fs.readFileSync(file, 'utf8');
    return { text, memoryRevision: revisionFor(text) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { text: '', memoryRevision: revisionFor('') };
    throw error;
  }
}

/**
 * Read a safe, immutable prompt snapshot once at session start.
 * `text` is sanitized while `memoryRevision` still identifies the raw file
 * for editor CAS operations. Callers should retain this object for the whole
 * session; later writes do not change it.
 */
export function readBotMemorySnapshot(homeDir, botId) {
  const state = readBotMemoryState(homeDir, botId);
  return Object.freeze({
    text: sanitizeMemoryForPrompt(state.text),
    memoryRevision: state.memoryRevision,
  });
}

/**
 * @param {string} homeDir
 * @param {string} botId
 * @param {string} text
 */
export function writeBotMemory(homeDir, botId, text) {
  return replaceBotMemory(homeDir, botId, text);
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

function replaceBotMemoryLocked(homeDir, botId, file, body, expectedRevision, currentState) {
  if (body.length > MAX_BOT_MEMORY_CHARS) throw new Error('Bot memory is too large.');
  const current = currentState ?? readBotMemoryState(homeDir, botId);
  if (expectedRevision !== undefined && expectedRevision !== current.memoryRevision) {
    throw new Error('Bot memory changed. Refresh and try again.');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!body.trim()) {
    fs.rmSync(file, { force: true });
    return { text: '', memoryRevision: revisionFor('') };
  }
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, body, 'utf8');
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { text: body, memoryRevision: revisionFor(body) };
}

/** Replace one Bot memory atomically; an empty value removes the note file. */
export function replaceBotMemory(homeDir, botId, text, expectedRevision) {
  if (!homeDir) throw new Error('DSH_HOME is not set');
  const file = memoryFilePath(homeDir, botId);
  const body = String(text ?? '');
  return withMemoryMutationLock(homeDir, botId, () => (
    replaceBotMemoryLocked(homeDir, botId, file, body, expectedRevision)
  ));
}

/** Append a normalized bullet without exposing a read/write race to callers. */
export function appendBotMemory(homeDir, botId, note) {
  const value = String(note ?? '').trim();
  if (!value) return readBotMemoryState(homeDir, botId);
  if (!homeDir) throw new Error('DSH_HOME is not set');
  const file = memoryFilePath(homeDir, botId);
  return withMemoryMutationLock(homeDir, botId, () => {
    const current = readBotMemoryState(homeDir, botId);
    const text = current.text ? `${current.text.trim()}\n- ${value}\n` : `- ${value}\n`;
    return replaceBotMemoryLocked(homeDir, botId, file, text, current.memoryRevision, current);
  });
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
