'use strict';

/**
 * Gate for the QA / smoke drivers (`DSH_SMOKE`, `DSH_QA*`, `DSH_THEME_SMOKE`).
 * These drivers attach a debugger, resize windows, intercept quit, and call
 * app.exit — none of that may run in an installed production app just because
 * an ambient environment variable is set. Packaged builds therefore require
 * the explicit extra switch `DSHD_ALLOW_PACKAGED_QA=1`, which only the
 * repository's own `qa:packaged` / `smoke:packaged` rehearsal scripts set.
 * Source runs (development, CI) keep the old single-variable behavior.
 */

/**
 * Whether QA drivers may run at all in this process.
 * @param {{ isPackaged?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {boolean}
 */
function qaDriversAllowed({ isPackaged = false, env = process.env } = {}) {
  if (!isPackaged) {
    return true;
  }
  return env.DSHD_ALLOW_PACKAGED_QA === '1';
}

/**
 * Read one QA flag (`=== '1'`), honoring the packaged gate.
 * @param {string} name - environment variable name (e.g. `DSH_QA_SHELL`).
 * @param {{ isPackaged?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {boolean}
 */
function qaFlag(name, { isPackaged = false, env = process.env } = {}) {
  if (env[name] !== '1') {
    return false;
  }
  return qaDriversAllowed({ isPackaged, env });
}

/**
 * Remote gate mode. `1` = NEG+REM walk; `cold` = preset-on open only.
 * Packaged builds still need `DSHD_ALLOW_PACKAGED_QA=1`.
 * @param {{ isPackaged?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {'full'|'cold'|null}
 */
function qaRemoteMode({ isPackaged = false, env = process.env } = {}) {
  const raw = env.DSH_QA_REMOTE;
  if (raw !== '1' && raw !== 'cold') {
    return null;
  }
  if (!qaDriversAllowed({ isPackaged, env })) {
    return null;
  }
  return raw === 'cold' ? 'cold' : 'full';
}

module.exports = {
  qaDriversAllowed,
  qaFlag,
  qaRemoteMode,
};
