/**
 * Pure memory helpers for per-bot durable notes under $DSH_HOME.
 */

import fs from 'node:fs';
import path from 'node:path';

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
  const file = memoryFilePath(homeDir, botId);
  try {
    if (!fs.existsSync(file)) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * @param {string} homeDir
 * @param {string} botId
 * @param {string} text
 */
export function writeBotMemory(homeDir, botId, text) {
  const file = memoryFilePath(homeDir, botId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(text ?? ''), 'utf8');
}

/**
 * @param {string} description
 * @param {string} memory
 * @returns {string}
 */
export function composePersonaWithMemory(description, memory) {
  const persona = String(description ?? '').trim();
  const notes = String(memory ?? '').trim();
  if (!persona && !notes) return '';
  if (!notes) return persona;
  if (!persona) return `Durable notes:\n${notes}`;
  return `${persona}\n\nDurable notes:\n${notes}`;
}
