const path = require('node:path');
const { runGit, FETCH_TIMEOUT_MS } = require('./git-exec');
const { resolveCurrentUpstream, resolvePrimaryRemoteName } = require('./git-remotes');

/** Status-fetch TTL: success is reused briefly; failures back off. */
const FETCH_OK_TTL_MS = 15_000;
/** First failure cooldown for status-fetch. */
const FETCH_FAIL_BASE_MS = 30_000;
/** Ceiling for status-fetch failure cooldown. */
const FETCH_FAIL_MAX_MS = 15 * 60_000;
const fetchCooldownByRoot = new Map();

function resetFetchCooldowns() {
  fetchCooldownByRoot.clear();
}

/**
 * Background `git fetch --quiet --no-tags`. A failure must not hide local status.
 * @param {string} cwd
 * @returns {Promise<void>}
 */
async function fetchCooldownKey(cwd, remote) {
  const common = await runGit(cwd, ['rev-parse', '--git-common-dir']);
  const dir = common.code === 0 && common.stdout.trim()
    ? path.resolve(cwd, common.stdout.trim())
    : cwd;
  return `${dir}\u0000${remote}`;
}

async function fetchForStatus(cwd) {
  // Fetch the tracking remote, else the primary remote.
  const upstream = await resolveCurrentUpstream(cwd);
  const remote = upstream?.remoteName || await resolvePrimaryRemoteName(cwd);
  if (!remote) return;
  const key = await fetchCooldownKey(cwd, remote);
  const now = Date.now();
  const previous = fetchCooldownByRoot.get(key);
  if (previous && now - previous.at < previous.delayMs) return;
  const fetched = await runGit(cwd, ['fetch', '--quiet', '--no-tags', remote], { timeoutMs: FETCH_TIMEOUT_MS });
  if (fetched.code === 0) {
    fetchCooldownByRoot.set(key, { at: now, fails: 0, delayMs: FETCH_OK_TTL_MS });
    return;
  }
  const fails = (previous?.fails || 0) + 1;
  fetchCooldownByRoot.set(key, {
    at: now,
    fails,
    delayMs: Math.min(FETCH_FAIL_MAX_MS, FETCH_FAIL_BASE_MS * (2 ** (fails - 1))),
  });
}

module.exports = {
  resetFetchCooldowns,
  fetchForStatus,
};
