/**
 * Per-routine notepad storage under $DSH_HOME/dshbot-routine/<safeRoutineId>.md.
 * Entries are `- ` prefixed lines; other lines are ignored on parse. Same
 * discipline as lib/memory.js: sha256 CAS revision, tmp+rename atomic write,
 * in-process mutation lock, per-entry threat scan.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  MemoryError,
  parseMemoryEntries,
  scanMemoryEntryThreats,
} from './memory.js';

export const ROUTINE_NOTEPAD_MAX_CHARS = 4_000;

const notepadMutationLocks = new Set();

function revisionFor(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/**
 * @param {string} homeDir
 * @param {string} routineId
 * @returns {string}
 */
export function notepadFilePath(homeDir, routineId) {
  const safe = String(routineId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
  return path.join(homeDir, 'dshbot-routine', `${safe}.md`);
}

function serializeEntries(entries) {
  return entries.length ? `${entries.map((entry) => `- ${entry}`).join('\n')}\n` : '';
}

function readFileState(file) {
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
 * Read one routine notepad: raw text, parsed entries, and a CAS revision token.
 * @returns {{ entries: string[], text: string, revision: string }}
 */
export function readRoutineNotepad(homeDir, routineId) {
  if (!homeDir) throw new Error('DSH_HOME is not set');
  return readFileState(notepadFilePath(homeDir, routineId));
}

function withNotepadMutationLock(homeDir, routineId, operation) {
  const key = path.resolve(notepadFilePath(homeDir, routineId));
  if (notepadMutationLocks.has(key)) {
    throw new Error('Notepad mutation is already in progress. Retry the operation.');
  }
  notepadMutationLocks.add(key);
  try {
    return operation();
  } finally {
    notepadMutationLocks.delete(key);
  }
}

function writeFile(file, body, expectedRevision, currentState) {
  if (body.length > ROUTINE_NOTEPAD_MAX_CHARS) {
    throw new MemoryError('MEMORY_FULL', `Routine notepad exceeds the ${ROUTINE_NOTEPAD_MAX_CHARS}-character limit. Remove or replace entries to free space.`);
  }
  const current = currentState ?? readFileState(file);
  if (expectedRevision !== undefined && expectedRevision !== current.revision) {
    throw new MemoryError('MEMORY_REVISION_MISMATCH', 'Routine notepad changed. Refresh and try again.');
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
    throw new MemoryError('MEMORY_MATCH_NOT_FOUND', `No notepad entry contains "${match}".`);
  }
  if (hits.length > 1) {
    throw new MemoryError('MEMORY_MATCH_AMBIGUOUS', `The match "${match}" hits ${hits.length} notepad entries; provide a longer match.`);
  }
  return hits[0];
}

/**
 * Apply structured notepad ops under the per-routine mutation lock; the file
 * is written atomically. Threatening add/replace text is skipped, never stored.
 *
 * @param {string} homeDir
 * @param {string} routineId
 * @param {Array<{ op: 'add' | 'replace' | 'remove', text?: string, match?: string }>} ops
 * @param {{ expectedRevision?: string }} [options]
 * @returns {{ applied: number, skipped: string[], snapshot: { entries: string[], text: string, revision: string } }}
 */
export function applyNotepadOps(homeDir, routineId, ops, { expectedRevision } = {}) {
  if (!homeDir) throw new Error('DSH_HOME is not set');
  const list = Array.isArray(ops) ? ops : [];
  for (const op of list) {
    if (!['add', 'replace', 'remove'].includes(op?.op)) {
      throw new MemoryError('MEMORY_OP_INVALID', `Unknown notepad op "${String(op?.op)}".`);
    }
  }
  return withNotepadMutationLock(homeDir, routineId, () => {
    const file = notepadFilePath(homeDir, routineId);
    const state = readFileState(file);
    if (expectedRevision !== undefined && expectedRevision !== state.revision) {
      throw new MemoryError('MEMORY_REVISION_MISMATCH', 'Routine notepad changed. Refresh and try again.');
    }
    const entries = [...state.entries];
    const skipped = [];
    let applied = 0;
    for (const op of list) {
      if (op.op === 'add') {
        const text = normalizeOpText(op.text);
        if (!text) continue;
        if (scanMemoryEntryThreats(text) || entries.includes(text)) {
          skipped.push(text);
          continue;
        }
        entries.push(text);
        applied += 1;
      } else {
        const match = String(op.match ?? '');
        if (!match) throw new MemoryError('MEMORY_MATCH_NOT_FOUND', 'A match is required for replace and remove.');
        const index = matchEntryIndex(entries, match);
        if (op.op === 'replace') {
          const text = normalizeOpText(op.text);
          if (!text) throw new MemoryError('MEMORY_OP_INVALID', 'Replacement text is empty.');
          if (scanMemoryEntryThreats(text) || (entries.includes(text) && entries[index] !== text)) {
            skipped.push(text);
            continue;
          }
          entries[index] = text;
        } else {
          entries.splice(index, 1);
        }
        applied += 1;
      }
    }
    const snapshot = list.length === 0
      ? state
      : writeFile(file, serializeEntries(entries), state.revision, state);
    return { applied, skipped, snapshot };
  });
}

/** Remove a routine's notepad file (routine delete cascade). */
export function deleteRoutineNotepad(homeDir, routineId) {
  if (!homeDir) return;
  fs.rmSync(notepadFilePath(homeDir, routineId), { force: true });
}
