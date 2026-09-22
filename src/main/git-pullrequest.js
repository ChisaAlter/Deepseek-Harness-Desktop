const { run, runGit, asCwd, GH_TIMEOUT_MS } = require('./git-exec');
const {
  normalizeGitRemoteUrl,
  selectProviderContext,
  parseGitHubRepositoryNameWithOwner,
  resolveCurrentUpstream,
} = require('./git-remotes');

const PR_LOOKUP_CACHE_CAPACITY = 32;
/** @type {Map<string, { pr: object | null, headBranch: string, upstreamRef: string | null, remoteName: string | null, headRemoteUrlKey: string | null, targetRepositoryUrlKey?: string }>} */
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
  if (current.targetRepositoryUrlKey !== undefined
    && lastKnown.targetRepositoryUrlKey !== current.targetRepositoryUrlKey) return null;
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
 * @param {object} [targetRepository] Resolved gh target; otherwise compare with origin.
 * @returns {Promise<object>}
 */
async function resolveBranchHeadContext(cwd, refName, targetRepository) {
  const configuredRemote = await runGit(cwd, ['config', '--get', `branch.${refName}.remote`]);
  const remoteName = configuredRemote.code === 0 && configuredRemote.stdout.trim()
    ? configuredRemote.stdout.trim()
    : null;
  const upstream = await resolveCurrentUpstream(cwd);
  const upstreamRef = upstream?.upstreamRef || null;
  const headBranchFromUpstream = upstream?.branchName || '';
  const headBranch = headBranchFromUpstream || refName;
  const shouldProbeLocalBranchSelector = !headBranchFromUpstream || headBranch === refName;
  const effectiveRemote = remoteName || upstream?.remoteName || null;

  const headRemote = effectiveRemote
    ? await runGit(cwd, ['remote', 'get-url', effectiveRemote])
    : { code: 1, stdout: '' };
  const originRemote = await runGit(cwd, ['remote', 'get-url', 'origin']);
  const headRemoteUrl = headRemote.code === 0 ? headRemote.stdout.trim() : '';
  const originRemoteUrl = originRemote.code === 0 ? originRemote.stdout.trim() : '';
  const headRepo = parseGitHubRepositoryNameWithOwner(headRemoteUrl)
    || parseRepositoryNameWithOwnerFromNormalized(headRemoteUrl);
  const originRepo = parseGitHubRepositoryNameWithOwner(originRemoteUrl)
    || parseRepositoryNameWithOwnerFromNormalized(originRemoteUrl);
  const ownerLogin = headRepo ? headRepo.split('/')[0] : null;
  const isCrossRepository = targetRepository && headRemoteUrl
    ? normalizeGitRemoteUrl(headRemoteUrl) !== normalizeGitRemoteUrl(targetRepository.url)
    : headRepo && originRepo
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
    targetRepositoryUrlKey: targetRepository ? normalizeGitRemoteUrl(targetRepository.url) : undefined,
  };
}

/** Resolve the repository selected by gh, including its configured base override. */
async function resolvePullRequestRepository(cwd) {
  const viewed = await run('gh', ['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef'], cwd, {
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (viewed.missing || viewed.code !== 0) return null;
  try {
    const parsed = JSON.parse(viewed.stdout);
    if (typeof parsed.nameWithOwner !== 'string' || !parsed.nameWithOwner.trim()
      || typeof parsed.url !== 'string' || !/^https?:\/\//i.test(parsed.url)
      || typeof parsed.defaultBranchRef?.name !== 'string' || !parsed.defaultBranchRef.name.trim()) return null;
    return {
      nameWithOwner: parsed.nameWithOwner.trim(),
      url: parsed.url,
      defaultBranch: parsed.defaultBranchRef.name.trim(),
    };
  } catch {
    return null;
  }
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
 * Query the resolved target and match both the head branch and repository.
 * @param {string} cwd
 * @param {string} [refName]
 * @param {object} [targetRepository] Reuse the target throughout a create operation.
 * @returns {Promise<{ pr: object | null, failed: boolean, headContext?: object, targetRepository?: object }>}
 */
async function lookupOpenPullRequest(cwd, refName, targetRepository) {
  if (lookupOpenPullRequestOverride) return lookupOpenPullRequestOverride(cwd);
  const root = asCwd(cwd);
  if (!root) return { pr: null, failed: true };
  const selected = await selectProviderContext(root);
  // Only GitHub (including self-hosted) uses `gh`.
  if (selected?.provider?.kind !== 'github') {
    return { pr: null, failed: false };
  }
  const headRef = typeof refName === 'string' && refName.trim() ? refName.trim() : '';
  if (!headRef) return { pr: null, failed: false };
  const target = targetRepository || await resolvePullRequestRepository(root);
  if (!target) return { pr: null, failed: true };
  const headContext = await resolveBranchHeadContext(root, headRef, target);
  const jsonFields = 'number,title,url,baseRefName,headRefName,state,isCrossRepository,headRepository,headRepositoryOwner';
  // gh pr list filters by branch name; repository identity is checked on each row.
  const listed = await run('gh', [
    'pr', 'list', '--repo', target.url, '--head', headContext.headBranch,
    '--state', 'open', '--limit', '20', '--json', jsonFields,
  ], root, { timeoutMs: GH_TIMEOUT_MS });
  const context = { headContext, targetRepository: target };
  if (listed.missing || listed.code !== 0) return { pr: null, failed: true, ...context };
  try {
    const rows = JSON.parse(listed.stdout);
    if (!Array.isArray(rows)) return { pr: null, failed: true, ...context };
    for (const row of rows) {
      const pr = parseGhPullRequestRow(row);
      if (pr && matchesBranchHeadContext(pr, headContext)) {
        return { pr, failed: false, ...context };
      }
    }
  } catch {
    return { pr: null, failed: true, ...context };
  }
  return { pr: null, failed: false, ...context };
}

/** @type {null | ((cwd: string) => Promise<{ pr: object | null, failed: boolean, headContext?: object }>)} */
let lookupOpenPullRequestOverride = null;

/** Test seam: replace open-PR lookup (avoids live `gh` in unit tests). */
function setLookupOpenPullRequest(resolver) {
  lookupOpenPullRequestOverride = typeof resolver === 'function' ? resolver : null;
}

async function readPullRequest(cwd, refName, targetRepository) {
  const looked = await lookupOpenPullRequest(cwd, refName, targetRepository);
  if (looked.failed) return null;
  return looked.pr;
}

module.exports = {
  rememberLastKnownPr,
  resolveLastKnownPr,
  resetLastKnownPrCache,
  resolveBranchHeadContext,
  resolvePullRequestRepository,
  parseRepositoryNameWithOwnerFromNormalized,
  matchesBranchHeadContext,
  parseGhPullRequestRow,
  lookupOpenPullRequest,
  setLookupOpenPullRequest,
  readPullRequest,
};
