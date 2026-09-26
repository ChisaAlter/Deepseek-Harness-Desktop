'use strict';

// shell:install-delta lane. The handler delegates to launcher/delta/install
// which downloads + verifies the release's `<product>-delta-<from>-<to>.zip`
// asset and applies it to the installed runtime; every delta-side failure
// falls back through ctx.launcher.installRelease (the same full-installer
// path as shell:install-release, slim/full split included) and reports
// mode:'full'. contributeStatus surfaces locally cached delta artifacts —
// sync and cheap, never a network call.
const fs = require('fs');
const path = require('path');
const deltaInstall = require('../launcher/delta/install');
const deltaManifest = require('../launcher/delta/manifest');

let lastDeltaError = '';
// Test seam: register()/contributeStatus() signatures are frozen, so hermetic
// deps (fake installDelta, fake deltaDir) arrive through this setter instead.
let depsOverride = null;

function setDeltaDeps(deps) {
  depsOverride = deps || null;
  lastDeltaError = '';
}

function deltaDir() {
  if (depsOverride && typeof depsOverride.deltaDir === 'string') {
    return depsOverride.deltaDir;
  }
  if (process.env.DSHD_DELTA_DIR) {
    return process.env.DSHD_DELTA_DIR;
  }
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'deltas');
  } catch {
    return '';
  }
}

function register(ctx) {
  ctx.handle('shell:install-delta', ctx.LAUNCHER_ONLY, async (event, tag) => {
    const progress = (payload) => ctx.send(event, 'shell:update-progress', { delta: true, ...payload });
    const install = depsOverride && typeof depsOverride.installDelta === 'function'
      ? depsOverride.installDelta
      : deltaInstall.installDelta;
    const deps = {
      ...(depsOverride || {}),
      deltaDir: deltaDir(),
      fullInstall: (resolvedTag, onProgress) => ctx.launcher.installRelease(resolvedTag, onProgress),
    };
    try {
      const result = await install(tag, progress, deps);
      lastDeltaError = result && result.ok === false
        ? (result.error || result.message || 'delta-failed')
        : '';
      return result;
    } catch (error) {
      lastDeltaError = error?.message || String(error);
      return { ok: false, mode: 'full', error: lastDeltaError };
    }
  });
}

function contributeStatus() {
  const available = [];
  const dir = deltaDir();
  if (dir) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const parsed = deltaManifest.parseDeltaAssetName(name);
        if (!parsed) {
          continue;
        }
        const file = path.join(dir, name);
        const size = fs.statSync(file).size;
        let tag = parsed.to;
        try {
          const sidecar = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
          if (typeof sidecar.tag === 'string' && sidecar.tag) {
            tag = sidecar.tag;
          }
        } catch { /* filename versions still carry from/to */ }
        available.push({ tag, from: parsed.from, size });
      }
    } catch { /* cache dir unreadable → empty list */ }
  }
  if (!available.length && !lastDeltaError) {
    return null;
  }
  return {
    deltas: {
      available,
      ...(lastDeltaError ? { lastError: lastDeltaError } : {}),
    },
  };
}

module.exports = { register, contributeStatus, setDeltaDeps };
