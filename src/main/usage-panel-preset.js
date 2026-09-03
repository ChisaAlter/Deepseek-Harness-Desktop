'use strict';

const fs = require('fs');
const path = require('path');
const { missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir, stripBlockFromFile } = require('./plugins');

const fsp = fs.promises;

const USAGE_PANEL_PACKAGE = 'dsh-usage-panel';
const USAGE_PANEL_BEGIN = '# --- dshd-gui-usage-panel ---';
const USAGE_PANEL_END = '# --- end dshd-gui-usage-panel ---';
const USAGE_PANEL_OVERLAY_FILENAME = 'desktop-usage-panel.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', USAGE_PANEL_PACKAGE);
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', USAGE_PANEL_PACKAGE);
  }
}

function profileListsBundle(profileDir) {
  const file = path.join(profileDir, 'package.json');
  if (!fs.existsSync(file)) {
    return false;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bundles = manifest.dsh?.profile?.bundles;
    return Array.isArray(bundles) && bundles.includes(USAGE_PANEL_PACKAGE);
  } catch {
    return false;
  }
}

function missingRuntimeDependencies(sourceDir) {
  return missingRuntimeFiles(sourceDir);
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function removeLinkOrDir(target) {
  if (!pathExists(target)) {
    return;
  }
  try {
    fs.readlinkSync(target);
    fs.unlinkSync(target);
    return;
  } catch {
    // Real directory or file, not a junction/symlink.
  }
  const st = fs.lstatSync(target);
  if (st.isSymbolicLink() || st.isFile()) {
    fs.unlinkSync(target);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * True when the destination already holds this exact file (same size and
 * mtime). Copies preserve timestamps, so an untouched bundle compares equal
 * on the next start and only the manifest walk hits the disk.
 * @param {string} src
 * @param {string} dest
 */
async function unchangedFile(src, dest) {
  try {
    const [from, to] = await Promise.all([fsp.stat(src), fsp.stat(dest)]);
    if (!from.isFile() || !to.isFile()) {
      return false;
    }
    return from.size === to.size && Math.abs(from.mtimeMs - to.mtimeMs) < 1;
  } catch {
    return false;
  }
}

/**
 * Refresh the desktop-managed copy off the UI thread. `fs.cpSync` of the
 * ~6k-file bundle held the Electron main thread 4–11 s on every full start,
 * which is over Windows' 5 s hang threshold (未响应). The async copy runs on
 * the libuv threadpool and skips files whose size+mtime already match, so
 * the steady state is a stat walk rather than a rewrite.
 * @param {string} sourceDir
 * @param {string} destDir
 */
async function copyBundle(sourceDir, destDir) {
  await fsp.cp(sourceDir, destDir, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    filter: async (src, dest) => !(await unchangedFile(src, dest)),
  });
}

function linkIntoProfileModules(destDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', USAGE_PANEL_PACKAGE);
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  removeLinkOrDir(linked);
  fs.symlinkSync(destDir, linked, process.platform === 'win32' ? 'junction' : 'dir');
}

function removeOverlayFile(overlayFile) {
  if (!fs.existsSync(overlayFile)) {
    return;
  }
  try {
    fs.unlinkSync(overlayFile);
  } catch {
    // A stale overlay only mounts when the controller passes it to --patch,
    // and the controller only passes the overlay this call returned.
  }
}

/**
 * Whether the profile owns the plugin outside the desktop preset: a REAL
 * directory install or a junction to somewhere OTHER than our
 * desktop-plugins copy (a `dsh plugin add` / `link:` user install). The
 * desktop then backs off — no fresh copy, no managed junction, no overlay —
 * so a user-managed install (e.g. built from a custom checkout) survives
 * full starts.
 * @param {string} profileDir
 * @param {string} destDir desktop-managed copy path
 * @returns {boolean}
 */
function isUserOwned(profileDir, destDir) {
  const linked = path.join(profileDir, 'node_modules', USAGE_PANEL_PACKAGE);
  if (!pathExists(linked)) {
    return false;
  }
  if (!fs.existsSync(path.join(destDir, 'package.json'))) {
    // No desktop copy yet: anything in node_modules is user-owned.
    return true;
  }
  try {
    return fs.realpathSync.native(linked) !== fs.realpathSync.native(destDir);
  } catch {
    return true;
  }
}

/**
 * Copy the bundled usage-panel package into the web profile and register it
 * through a desktop-owned overlay (`--patch`, full starts only). Does not
 * call `dsh plugin add`. The profile's `cordis.patch.yml` is user-owned:
 * this function only strips the managed block earlier desktop versions wrote
 * there and never writes one back. A user-owned install (real directory or a
 * non-managed link in profile node_modules) makes the desktop back off
 * (`{ userOwned: true }`): no copy, no junction, overlay removed so a user
 * patch insert cannot double-mount. Only when the profile has no
 * node_modules entry does the desktop copy the bundle and manage the
 * junction itself. Missing `package.json` or zod returns
 * `{ ok: false }` and removes the overlay so the controller never passes a
 * stale one. Async: the bundle copy must never block the main thread.
 * @param {{ sourceDir?: string, profileDir?: string, disabledPlugins?: string[] }} [options]
 */
async function ensureUsagePanelPlugin(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
    return { ok: false, added: false, error: 'missing-source:package.json' };
  }
  const profileDir = options.profileDir || webProfileDir();
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  stripBlockFromFile(patchFile, USAGE_PANEL_BEGIN, USAGE_PANEL_END);
  const destDir = path.join(profileDir, 'desktop-plugins', USAGE_PANEL_PACKAGE);
  const overlayFile = path.join(destDir, USAGE_PANEL_OVERLAY_FILENAME);
  const disabled = require('./config').readDisabledPlugins(options);
  if (disabled.includes(USAGE_PANEL_PACKAGE)) {
    removeOverlayFile(overlayFile);
    return { ok: true, added: false, destDir: null, disabled: true };
  }
  if (isUserOwned(profileDir, destDir)) {
    removeOverlayFile(overlayFile);
    return { ok: true, added: false, destDir: null, userOwned: true };
  }
  const missing = missingRuntimeDependencies(sourceDir);
  if (missing.length) {
    removeOverlayFile(overlayFile);
    return {
      ok: false,
      added: false,
      error: `missing-source:node_modules:${missing.join(',')}`,
    };
  }
  const existed = fs.existsSync(path.join(destDir, 'package.json'));
  fs.mkdirSync(destDir, { recursive: true });
  await copyBundle(sourceDir, destDir);
  linkIntoProfileModules(destDir, profileDir);
  if (profileListsBundle(profileDir)) {
    // A marketplace install already mounts the package as a profile bundle;
    // adding the overlay insert too would mount it twice.
    removeOverlayFile(overlayFile);
    return { ok: true, added: false, destDir };
  }
  const contents = [
    '# Desktop-managed overlay passed to full starts via --patch: only the',
    '# usage-panel insert. Skip starts do not pass this file. Regenerated on',
    '# every full start; do not edit.',
    '- insert:',
    '    - id: usage-stats',
    `      name: ${JSON.stringify(USAGE_PANEL_PACKAGE)}`,
    '',
  ].join('\n');
  const existing = fs.existsSync(overlayFile) ? fs.readFileSync(overlayFile, 'utf8') : '';
  if (existing !== contents) {
    const tmp = `${overlayFile}.tmp`;
    fs.writeFileSync(tmp, contents, 'utf8');
    fs.renameSync(tmp, overlayFile);
  }
  return {
    ok: true,
    added: !existed,
    destDir,
    overlayFile,
  };
}

module.exports = {
  USAGE_PANEL_PACKAGE,
  USAGE_PANEL_BEGIN,
  USAGE_PANEL_END,
  ensureUsagePanelPlugin,
};
