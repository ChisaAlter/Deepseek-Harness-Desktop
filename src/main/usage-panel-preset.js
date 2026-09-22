'use strict';

const fs = require('fs');
const path = require('path');
const { missingRuntimeFiles } = require('./plugin-runtime-files');
const { webProfileDir, stripBlockFromFile } = require('./plugins');

const fsp = fs.promises;

/** npm package name (also used for market/forensics aliases). */
const USAGE_PANEL_PACKAGE = 'dsh-usage-panel';
/** Legacy managed-block markers earlier desktop versions wrote into the
 * user-owned cordis.patch.yml; ensure only strips them (migration). */
const USAGE_PANEL_BEGIN = '# --- dshd-gui-usage-panel ---';
const USAGE_PANEL_END = '# --- end dshd-gui-usage-panel ---';
/** Forensics / config / IPC aliases (usage-panel is desktop built-in: the
 * aliases are stripped from the disable list, never honored). */
const USAGE_PANEL_ALIASES = [USAGE_PANEL_PACKAGE];
const USAGE_PANEL_OVERLAY_FILENAME = 'desktop-usage-panel.patch.yml';

function defaultSourceDir() {
  try {
    const { projectRoot } = require('./paths');
    return path.join(projectRoot(), 'vendor', USAGE_PANEL_PACKAGE);
  } catch {
    return path.join(__dirname, '..', '..', 'vendor', USAGE_PANEL_PACKAGE);
  }
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

/**
 * Junction/symlink profile node_modules → desktop-plugins copy so
 * require() and package-name resolution stay coherent with the
 * file:// cordis insert.
 * @param {string} destDir
 * @param {string} profileDir
 */
function linkIntoProfileModules(destDir, profileDir) {
  const linked = path.join(profileDir, 'node_modules', USAGE_PANEL_PACKAGE);
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  removeLinkOrDir(linked);
  fs.symlinkSync(destDir, linked, process.platform === 'win32' ? 'junction' : 'dir');
}

function withoutUsagePanelAliases(list) {
  const blocked = new Set(USAGE_PANEL_ALIASES);
  return (Array.isArray(list) ? list : [])
    .filter((name) => !blocked.has(String(name || '').trim()));
}

/**
 * Wire the desktop-built-in usage-panel from vendor (or packaged resources):
 * a desktop-owned `--patch` overlay (`desktop-plugins/dsh-usage-panel/
 * desktop-usage-panel.patch.yml`) carries the package-name insert, and a
 * profile node_modules junction to the desktop-plugins copy makes the name
 * resolvable. The overlay rides EVERY start (full and skip) — usage-panel is
 * desktop built-in Settings → 用量统计, not a user plugin, so the disable
 * list never applies (config normalization strips the aliases). The
 * profile's `cordis.patch.yml` is user-owned: this function only strips the
 * managed block earlier desktop versions wrote there and never writes one
 * back; the strip and the overlay write happen in the same call before every
 * spawn so no start can compose both copies (the CLI's `insert` does not
 * dedupe by id).
 *
 * @param {{ sourceDir?: string, profileDir?: string }} [options]
 * @returns {{
 *   ok: boolean,
 *   added?: boolean,
 *   destDir?: string|null,
 *   overlayFile?: string,
 *   error?: string,
 * }}
 */
async function ensureDesktopUsagePanel(options = {}) {
  const sourceDir = options.sourceDir || defaultSourceDir();
  if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
    return { ok: false, added: false, error: 'missing-source:package.json' };
  }
  const profileDir = options.profileDir || webProfileDir();
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  // Migration: earlier desktop versions upserted a managed block into the
  // user-owned cordis.patch.yml. Strip it on every start regardless of the
  // outcome below — a stale copy composed next to the overlay double-mounts.
  stripBlockFromFile(patchFile, USAGE_PANEL_BEGIN, USAGE_PANEL_END);

  const missing = missingRuntimeFiles(sourceDir);
  if (missing.length) {
    // Broken vendor runtime is desktop damage — caller must fail the start
    // (skip cannot fix it); never pretend success with a stale mount.
    return {
      ok: false,
      added: false,
      error: `missing-source:node_modules:${missing.join(',')}`,
    };
  }

  const destDir = path.join(profileDir, 'desktop-plugins', USAGE_PANEL_PACKAGE);
  const existed = fs.existsSync(path.join(destDir, 'package.json'));
  fs.mkdirSync(destDir, { recursive: true });
  await copyBundle(sourceDir, destDir);
  linkIntoProfileModules(destDir, profileDir);

  const overlayFile = path.join(destDir, USAGE_PANEL_OVERLAY_FILENAME);
  const overlayContents = [
    '# Desktop-managed overlay passed to EVERY start (full and skip) via',
    '# --patch: only the built-in usage-panel insert, never the profile user',
    '# layer. Regenerated on every start; do not edit.',
    '- insert:',
    '    - id: usage-stats',
    `      name: ${JSON.stringify(USAGE_PANEL_PACKAGE)}`,
    '',
  ].join('\n');
  const existing = fs.existsSync(overlayFile) ? fs.readFileSync(overlayFile, 'utf8') : '';
  if (existing !== overlayContents) {
    const tmp = `${overlayFile}.tmp`;
    fs.writeFileSync(tmp, overlayContents, 'utf8');
    fs.renameSync(tmp, overlayFile);
  }
  return {
    ok: true,
    added: !existed,
    destDir,
    overlayFile,
  };
}

/** @deprecated Use ensureDesktopUsagePanel — kept as alias for harness wiring. */
function ensureUsagePanelPlugin(options) {
  return ensureDesktopUsagePanel(options);
}

module.exports = {
  USAGE_PANEL_PACKAGE,
  USAGE_PANEL_BEGIN,
  USAGE_PANEL_END,
  USAGE_PANEL_ALIASES,
  withoutUsagePanelAliases,
  ensureDesktopUsagePanel,
  ensureUsagePanelPlugin,
};