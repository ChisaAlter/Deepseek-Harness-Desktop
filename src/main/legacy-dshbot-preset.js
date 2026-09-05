'use strict';

const fs = require('fs');
const path = require('path');
const { webProfileDir, stripBlockFromFile } = require('./plugins');

const DSHBOT_BEGIN = '# --- dshd-gui-dshbot ---';
const DSHBOT_END = '# --- end dshd-gui-dshbot ---';

/**
 * Detach the retired desktop preset without deleting plugin or user data.
 * Only our managed patch block and a link to our old preset copy are removed.
 * Real installs (including pnpm links), manifests, presets, and memory stay intact.
 * @param {{ profileDir?: string }} options
 * @returns {{ ok: boolean, changed: boolean, stripped: boolean, removedLink: boolean }}
 */
function removeLegacyDshbotPreset(options = {}) {
  const profileDir = options.profileDir || webProfileDir();
  const stripped = stripBlockFromFile(path.join(profileDir, 'cordis.patch.yml'), DSHBOT_BEGIN, DSHBOT_END);
  const linked = path.join(profileDir, 'node_modules', 'dshbot');
  const ownedCopy = path.resolve(profileDir, 'desktop-plugins', 'dshbot');
  let removedLink = false;
  try {
    if (fs.lstatSync(linked).isSymbolicLink()
      && path.resolve(path.dirname(linked), fs.readlinkSync(linked)) === ownedCopy) {
      fs.unlinkSync(linked);
      removedLink = true;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { ok: true, changed: stripped || removedLink, stripped, removedLink };
}

module.exports = { DSHBOT_BEGIN, DSHBOT_END, removeLegacyDshbotPreset };
