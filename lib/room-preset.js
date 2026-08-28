/**
 * Self-provisioning of the dshbot-room agent preset.
 *
 * A standalone `dsh plugin add dshbot` install has no desktop shell copying
 * presets for it, so apply() provisions `$DSH_HOME/.agent-presets/dshbot-room`
 * from the package's own `presets/` directory. Harness preset discovery
 * re-reads the roots on every call, so the preset is visible without restart.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOM_PRESET_ID = 'dshbot-room';
export const ROOM_PRESET_COMPOSITION = 'agent.cordis.yml';

/**
 * @returns {string} the packaged preset source directory.
 */
export function roomPresetSourceDir() {
  return fileURLToPath(new URL(`../presets/${ROOM_PRESET_ID}/`, import.meta.url));
}

/**
 * @param {string} homeDir
 * @returns {string}
 */
export function roomPresetDestDir(homeDir) {
  return path.join(homeDir, '.agent-presets', ROOM_PRESET_ID);
}

/**
 * Copy the room preset into the harness home, refreshing byte-different
 * files so plugin upgrades propagate. Missing home or source fails soft.
 * @param {string | undefined} homeDir
 * @param {string} [sourceDir]
 * @returns {{ ok: boolean, error?: string, destDir?: string, changed?: boolean }}
 */
export function ensureRoomPreset(homeDir, sourceDir = roomPresetSourceDir()) {
  if (!homeDir) {
    return { ok: false, error: 'missing-home' };
  }
  if (!fs.existsSync(path.join(sourceDir, ROOM_PRESET_COMPOSITION))) {
    return { ok: false, error: 'missing-source:preset' };
  }
  const destDir = roomPresetDestDir(homeDir);
  fs.mkdirSync(destDir, { recursive: true });
  let changed = false;
  for (const name of fs.readdirSync(sourceDir)) {
    const from = path.join(sourceDir, name);
    if (!fs.statSync(from).isFile()) continue;
    const to = path.join(destDir, name);
    const body = fs.readFileSync(from);
    if (fs.existsSync(to) && fs.readFileSync(to).equals(body)) continue;
    fs.writeFileSync(to, body);
    changed = true;
  }
  return { ok: true, destDir, changed };
}
