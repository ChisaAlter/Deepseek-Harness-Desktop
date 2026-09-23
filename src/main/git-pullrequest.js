const { run, runGit, asCwd, GH_TIMEOUT_MS } = require('./git-exec');
const {
  normalizeGitRemoteUrl,
  selectProviderContext,
  parseGitHubRepositoryNameWithOwner,
  resolveCurrentUpstream,
} = require('./git-remotes');

const PR_LOOKUP_CACHE_CAPACITY = 32;
/** @type {Map<string, { pr: object | null, headBranch: string, upstreamRef: string | null, remoteName: string | null, headRemoteUrlKey: string | null }>} */
const lastKnownPrByBranchKey = new Map();

function rememberLastKnownPr(branchKey, entry) {
  if (!lastKnownPrByBranchKey.has(branchKey) && lastKnownPrByBranchKey.size >= PR_LOOKUP_CACHE_CAPACITY) {
    const oldest = lastKnownPrByBranchKey.keys().next().value;
    if (oldest !== undefined) lastKnownPrByBranchKey.delete(oldest);
  }
  lastKnownPrByBranchKey.set(branchKey, entry);
}

function resolveLastKnownPr(branchKey, current) {
  const lastKnown = lastKnownPrByBranchKey.get(branchKey);
  if (!lastKnown) return null;
  if (lastKnown.headBranch !== current.headBranch) return null;
  if (lastKnown.headRemoteUrlKey !== null && current.headRemoteUrlKey !== null) {
    return lastKnown.headRemoteUrlKey === current.headRemoteUrlKey ? lastKnown.pr : null;
  }
  if (
    lastKnown.upstreamRef !== null
    && current.upstreamRef !== null
    && lastKnown.remoteName !== null
    && current.remoteName !== null
  ) {
    return lastKnown.remoteName === current.remoteName ? lastKnown.pr : null;
  }
  return lastKnown.pr;
}

function resetLastKnownPrCache() {
  lastKnownPrByBranchKey.clear();
}

function appendUnique(values, next) {
  const trimmed = String(next || '').trim();
  if (!trimmed || values.includes(trimmed)) return;
  values.push(trimmed);
}

/**
 * Head selectors for `gh pr list --head` probing.
 * @param {string} cwd
 * @param {string} refName
 * @returns {Promise<object>}
 */
async function resolveBranchHeadContext(cwd, refName, readRun = runGit) {
  const configuredRemote = await readRun(cwd, ['config', '--get', `branch.${refName}.remote`]);
  const remoteName = configuredRemote.code === 0 && configuredRemote.stdout.trim()
    ? configuredRemote.stdout.trim()
    : null;
  const upstream = await resolveCurrentUpstream(cwd, readRun);
  const upstreamRef = upstream?.upstreamRef || null;
  const headBranchFromUpstream = upstream?.branchName || '';
  const headBranch = headBranchFromUpstream || refName;
  const shouldProbeLocalBranchSelector = !headBranchFromUpstream || headBranch === refName;
  const effectiveRemote = remoteName || upstream?.remoteName || null;

  const headRemote = effectiveRemote
    ? await readRun(cwd, ['remote', 'get-url', effectiveRemote])
    : { code: 1, stdout: '' };
  const originRemote = await readRun(cwd, ['remote', 'get-url', 'origin']);
  const headRemoteUrl = headRemote.code === 0 ? headRemote.stdout.trim() : '';
  const originRemoteUrl = originRemote.code === 0 ? originRemote.stdout.trim() : '';
  const headRepo = parseGitHubRepositoryNameWithOwner(headRemoteUrl)
    || parseRepositoryNameWithOwnerFromNormalized(headRemoteUrl);
  const originRepo = parseGitHubRepositoryNameWithOwner(originRemoteUrl)
    || parseRepositoryNameWithOwnerFromNormalized(originRemoteUrl);
  const ownerLogin = headRepo ? headRepo.split('/')[0] : null;
  const isCrossRepository = headRepo && originRepo
    ? headRepo.toLowerCase() !== originRepo.toLowerCase()
    : Boolean(effectiveRemote && effectiveRemote !== 'origin' && headRepo);
  const ownerHeadSelector = ownerLogin && headBranch ? `${ownerLogin}:${headBranch}` : null;
  const remoteAliasHeadSelector = effectiveRemote && headBranch ? `${effectiveRemote}:${headBranch}` : null;
  const shouldProbeRemoteOwnedSelectors = isCrossRepository
    || (effectiveRemote !== null && effectiveRemote !== 'origin');
  const headSelectors = [];
  if (isCrossRepository && shouldProbeRemoteOwnedSelectors) {
    appendUnique(headSelectors, ownerHeadSelector);
    appendUnique(headSelectors, remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null);
  }
  if (shouldProbeLocalBranchSelector) appendUnique(headSelectors, refName);
  if (headBranch !== refName) appendUnique(headSelectors, headBranch);
  if (!isCrossRepository && shouldProbeRemoteOwnedSelectors) {
    appendUnique(headSelectors, ownerHeadSelector);
    appendUnique(headSelectors, remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null);
  }
  if (headSelectors.length === 0) appendUnique(headSelectors, headBranch);
  return {
    localBranch: refName,
    headBranch,
    preferredHeadSelector: ownerHeadSelector && isCrossRepository ? ownerHeadSelector : headBranch,
    headSelectors,
    remoteName: effectiveRemote,
    upstreamRef,
    headRemoteUrlKey: headRemoteUrl
      ? normalizeGitRemoteUrl(headRemoteUrl)
      : (effectiveRemote === null && originRemoteUrl ? normalizeGitRemoteUrl(originRemoteUrl) : null),
    headRepositoryNameWithOwner: headRepo,
    headRepositoryOwnerLogin: ownerLogin,
    isCrossRepository,
  };
}

function parseRepositoryNameWithOwnerFromNormalized(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;
  // Local paths have enough slashes on POSIX (`/var/folders/.../bare`) to look
  // like host/owner/repo. Only URL-shaped remotes get the last-two-segment parse.
  if (!/^(?:git@|(?:ssh|https?|git):\/\/)/i.test(trimmed)) return null;
  const key = normalizeGitRemoteUrl(url);
  const parts = key.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/**
 * Reject PR rows that share a branch name but not the head repo.
 * @param {object} pr
 * @param {object} headContext
 * @returns {boolean}
 */
function matchesBranchHeadContext(pr, headContext) {
  if (!pr || pr.headRef !== headContext.headBranch) return false;
  const expectedRepo = (headContext.headRepositoryNameWithOwner || '').toLowerCase() || null;
  const expectedOwner = (headContext.headRepositoryOwnerLogin || '').toLowerCase() || null;
  const prRepo = (pr.headRepositoryNameWithOwner || '').toLowerCase() || null;
  const prOwner = (pr.headRepositoryOwnerLogin || '').toLowerCase() || null;

  if (expectedRepo) {
    if (prRepo && expectedRepo !== prRepo) return false;
    if (expectedOwner && prOwner && expectedOwner !== prOwner) return false;
  }
  if (expectedOwner && prOwner && expectedOwner !== prOwner) return false;

  if (headContext.isCrossRepository) {
    if (pr.isCrossRepository === false) return false;
    if ((expectedRepo || expectedOwner) && !prRepo && !prOwner) return false;
    return true;
  }
  if (pr.isCrossRepository === true) {
    if ((!expectedRepo && !expectedOwner) || (!prRepo && !prOwner)) return false;
  }
  return true;
}

/**
 * Repo leaf from a PR HTML URL.
 * @param {string} url
 * @returns {string | null}
 */
function parseRepositoryNameFromPullRequestUrl(url) {
  const trimmed = String(url || '').trim();
  const match = /^https:\/\/[^/?#]+\/[^/]+\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(trimmed);
  const repositoryName = match?.[1]?.trim() ?? '';
  return repositoryName || null;
}

function parseGhPullRequestRow(parsed) {
  if (!parsed || typeof parsed.number !== 'number') return null;
  const state = String(parsed.state || '').toLowerCase();
  const ownerLogin = typeof parsed.headRepositoryOwner?.login === 'string'
    ? parsed.headRepositoryOwner.login.trim()
    : '';
  let repoNameWithOwner = typeof parsed.headRepository?.nameWithOwner === 'string'
    ? parsed.headRepository.nameWithOwner.trim()
    : (ownerLogin && parsed.headRepository?.name
      ? `${ownerLogin}/${String(parsed.headRepository.name).trim()}`
      : '');
  // Synthesize head repo from the PR URL when
  // cross-repo JSON omits headRepository but includes owner login.
  if (!repoNameWithOwner && parsed.isCrossRepository && ownerLogin) {
    const leaf = parseRepositoryNameFromPullRequestUrl(parsed.url);
    if (leaf) repoNameWithOwner = `${ownerLogin}/${leaf}`;
  }
  return {
    number: parsed.number,
    title: parsed.title || '',
    url: parsed.url || '',
    baseRef: parsed.baseRefName || '',
    headRef: parsed.headRefName || '',
    state: state === 'merged' || state === 'closed' ? state : 'open',
    ...(typeof parsed.isCrossRepository === 'boolean' ? { isCrossRepository: parsed.isCrossRepository } : {}),
    ...(repoNameWithOwner ? { headRepositoryNameWithOwner: repoNameWithOwner } : {}),
    ...(ownerLogin ? { headRepositoryOwnerLogin: ownerLogin } : {}),
  };
}

/**
 * Probe open PRs across head selectors. Distinguishes lookup failure from empty.
 * @param {string} cwd
 * @param {string} [refName]
 * @returns {Promise<{ pr: object | null, failed: boolean, headContext?: object }>}
 */
async function lookupOpenPullRequest(cwd, refName, readRun = runGit) {
  if (lookupOpenPullRequestOverride) return lookupOpenPullRequestOverride(cwd);
  const root = asCwd(cwd);
  if (!root) return { pr: null, failed: true };
  const selected = await selectProviderContext(root, readRun);
  // Only GitHub (including self-hosted) uses `gh`.
  if (selected?.provider?.kind !== 'github') {
    return { pr: null, failed: false };
  }
  const headRef = typeof refName === 'string' && refName.trim() ? refName.trim() : '';
  if (!headRef) return { pr: null, failed: false };
  const headContext = await resolveBranchHeadContext(root, headRef, readRun);
  const jsonFields = 'number,title,url,baseRefName,headRefName,state,isCrossRepository,headRepository,headRepositoryOwner';
  let sawFailure = false;
  for (const headSelector of headContext.headSelectors) {
    const listed = await run('gh', [
      'pr',
      'list',
      '--head',
      headSelector,
      '--state',
      'open',
      '--limit',
      '20',
      '--json',
      jsonFields,
    ], root, { timeoutMs: GH_TIMEOUT_MS });
    if (listed.missing || listed.code !== 0) {
      // Fail closed on any list error (do not treat as empty).
      sawFailure = true;
      continue;
    }
    try {
      const rows = JSON.parse(listed.stdout);
      if (!Array.isArray(rows)) {
        sawFailure = true;
        continue;
      }
      for (const row of rows) {
        const pr = parseGhPullRequestRow(row);
        if (pr && matchesBranchHeadContext(pr, headContext)) {
          return { pr, failed: false, headContext };
        }
      }
    } catch {
      sawFailure = true;
    }
  }
  if (sawFailure) {
    return { pr: null, failed: true, headContext };
  }
  return { pr: null, failed: false, headContext };
}

/** @type {null | ((cwd: string) => Promise<{ pr: object | null, failed: boolean, headContext?: object }>)} */
let lookupOpenPullRequestOverride = null;

/** Test seam: replace open-PR lookup (avoids live `gh` in unit tests). */
function setLookupOpenPullRequest(resolver) {
  lookupOpenPullRequestOverride = typeof resolver === 'function' ? resolver : null;
}

async function readPullRequest(cwd, refName, readRun = runGit) {
  const looked = await lookupOpenPullRequest(cwd, refName, readRun);
  if (looked.failed) return null;
  return looked.pr;
}

module.exports = {
  rememberLastKnownPr,
  resolveLastKnownPr,
  resetLastKnownPrCache,
  resolveBranchHeadContext,
  parseRepositoryNameWithOwnerFromNormalized,
  matchesBranchHeadContext,
  parseGhPullRequestRow,
  lookupOpenPullRequest,
  setLookupOpenPullRequest,
  readPullRequest,
};
