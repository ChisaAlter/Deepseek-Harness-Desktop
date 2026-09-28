'use strict';

/**
 * Semantic update status for the Web-localized optional status indicator.
 * Ported from upstream apps/desktop/update-presentation.ts.
 */

const NETWORK_FAILURE = /\b(?:ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ETIMEDOUT|ENOTFOUND|net::ERR)\b/u;

/**
 * Classify one updater failure for both native and Web-localized summaries.
 * @param {{ phase: string, failedOperation?: string, preparationFailure?: string, message?: string }} state
 * @returns {string} stable presentation kind without raw diagnostics.
 */
function updateFailureKind(state) {
  if (state.failedOperation === 'install' && state.preparationFailure !== undefined) return state.preparationFailure;
  const operation = state.failedOperation ?? 'install';
  return NETWORK_FAILURE.test(state.message ?? '') ? `${operation}-network` : operation;
}

/**
 * @param {{ phase: string, version?: string, percent?: number, message?: string,
 *           failedOperation?: string, preparationFailure?: string }} state
 * @returns {{ phase: string, version?: string, percent?: number, failure?: string }}
 *   semantic status without localized copy, diagnostics, or installation controls.
 */
function presentUpdate(state) {
  return {
    phase: state.phase,
    ...(state.version === undefined ? {} : { version: state.version }),
    ...(state.percent === undefined ? {} : { percent: Math.floor(state.percent) }),
    ...(state.phase === 'error' ? { failure: updateFailureKind(state) } : {}),
  };
}

module.exports = { updateFailureKind, presentUpdate };
