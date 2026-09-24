import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The desktop whale has one durable Session. IM may enter it, but must never
 * create a second whale Session from a per-chat binding. Explicit non-whale
 * bot presets keep their ordinary independent-session behavior.
 */
export async function sharedWhaleSessionId(harness, { home = process.env.DSH_HOME } = {}) {
  let preset = null;
  if (typeof harness?.agentPresetSettings === 'function') {
    const current = await harness.agentPresetSettings();
    preset = current?.agentPreset ?? null;
  }
  if (preset !== null && preset !== '' && preset !== 'whale-girl') return null;
  const explicitlyWhale = preset === 'whale-girl';
  const unavailable = () => {
    if (!explicitlyWhale) return null;
    const error = new Error('The resident whale assistant is unavailable for IM.');
    error.code = 'whale-session-unavailable';
    throw error;
  };
  if (typeof home !== 'string' || !home) return unavailable();
  // In the Desktop host a disabled whale plugin leaves her data on disk.
  // Persisted data alone must not silently re-enable her through IM.
  try {
    const desktop = JSON.parse(await readFile(join(dirname(home), 'config.json'), 'utf8'));
    if (desktop.whaleAssistantEnabled === false) return unavailable();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  let settings;
  try {
    settings = JSON.parse(await readFile(join(home, 'data', 'whale', 'settings.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return unavailable();
    throw error;
  }
  const sessionId = typeof settings.sessionId === 'string' ? settings.sessionId.trim() : '';
  if (!sessionId) return unavailable();
  if (preset === 'whale-girl') {
    if (settings.imDefault === true) return sessionId;
    const error = new Error('The whale assistant IM connection is disabled in settings.');
    error.code = 'whale-im-disabled';
    throw error;
  }
  return settings.imDefault === true ? sessionId : null;
}
