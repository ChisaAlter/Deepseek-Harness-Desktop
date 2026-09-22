const { runGit } = require('./git-exec');

function parseRemoteHost(remoteUrl) {
  const trimmed = String(remoteUrl || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('git@')) {
    const hostWithPath = trimmed.slice('git@'.length);
    const separatorIndex = hostWithPath.search(/[:/]/);
    if (separatorIndex <= 0) return null;
    return hostWithPath.slice(0, separatorIndex).toLowerCase();
  }
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return null;
  }
}

function parseHostName(host) {
  try {
    return new URL(`https://${host}`).hostname.toLowerCase();
  } catch {
    return String(host || '').replace(/:\d+$/u, '').toLowerCase();
  }
}

/**
 * Stable remote comparison key.
 * @param {string} value
 * @returns {string}
 */
function normalizeGitRemoteUrl(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\/+$/g, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
  if (/^(?:ssh|https?|git):\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      const repositoryPath = url.pathname
        .split('/')
        .filter((segment) => segment.length > 0)
        .join('/');
      if (url.hostname && repositoryPath.includes('/')) {
        return `${url.hostname}/${repositoryPath}`;
      }
    } catch {
      return normalized;
    }
  }
  const scp = /^git@([^:/\s]+)[:/]([^/\s]+(?:\/[^/\s]+)+)$/i.exec(normalized);
  if (scp?.[1] && scp[2]) return `${scp[1]}/${scp[2]}`;
  return normalized;
}

/**
 * GitHub `owner/repo` from common remote URL shapes.
 * @param {string} url
 * @returns {string | null}
 */
function parseGitHubRepositoryNameWithOwner(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;
  const match = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(trimmed);
  const name = match?.[1]?.trim() ?? '';
  return name || null;
}

function providerFromRemoteUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return undefined;
  const host = parseRemoteHost(trimmed);
  if (!host) {
    // Fallback for odd aliases: keep previous substring heuristics.
    const lower = trimmed.toLowerCase();
    if (lower.includes('github')) {
      return { kind: 'github', name: 'GitHub', baseUrl: 'https://github.com' };
    }
    return { kind: 'unknown', name: 'source control', baseUrl: '' };
  }
  const hostname = parseHostName(host);
  if (hostname === 'github.com' || hostname.includes('github')) {
    return {
      kind: 'github',
      name: hostname === 'github.com' ? 'GitHub' : 'GitHub Self-Hosted',
      baseUrl: `https://${host}`,
    };
  }
  if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
    return {
      kind: 'gitlab',
      name: hostname === 'gitlab.com' ? 'GitLab' : 'GitLab Self-Hosted',
      baseUrl: `https://${host}`,
    };
  }
  if (hostname === 'dev.azure.com' || hostname.endsWith('.visualstudio.com')) {
    return { kind: 'azure-devops', name: 'Azure DevOps', baseUrl: `https://${host}` };
  }
  if (hostname === 'bitbucket.org' || hostname.includes('bitbucket')) {
    return {
      kind: 'bitbucket',
      name: hostname === 'bitbucket.org' ? 'Bitbucket' : 'Bitbucket Self-Hosted',
      baseUrl: `https://${host}`,
    };
  }
  return { kind: 'unknown', name: host, baseUrl: `https://${host}` };
}

async function listRemoteNames(cwd) {
  const listed = await runGit(cwd, ['remote']);
  if (listed.code !== 0) return [];
  return listed.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function resolvePrimaryRemoteName(cwd) {
  const remotes = await listRemoteNames(cwd);
  if (remotes.includes('origin')) return 'origin';
  return remotes[0] || null;
}

/**
 * Prefer origin, else the first non-unknown remote.
 * @param {string} cwd
 * @returns {Promise<{ provider: object, remoteName: string, remoteUrl: string } | null>}
 */
async function selectProviderContext(cwd) {
  const names = await listRemoteNames(cwd);
  const candidates = [];
  for (const name of names) {
    const urlResult = await runGit(cwd, ['remote', 'get-url', name]);
    if (urlResult.code !== 0 || !urlResult.stdout.trim()) continue;
    const provider = providerFromRemoteUrl(urlResult.stdout);
    if (!provider) continue;
    candidates.push({ provider, remoteName: name, remoteUrl: urlResult.stdout.trim() });
  }
  return candidates.find((item) => item.remoteName === 'origin')
    || candidates.find((item) => item.provider.kind !== 'unknown')
    || candidates[0]
    || null;
}

/** Change-request wording for progress phases. */
function changeRequestTerms(provider) {
  if (provider?.kind === 'gitlab') return { shortLabel: 'MR', singular: 'merge request' };
  if (provider?.kind === 'unknown') return { shortLabel: 'change request', singular: 'change request' };
  return { shortLabel: 'PR', singular: 'pull request' };
}

async function defaultRefName(cwd, hasPrimaryRemote) {
  // Default branch from the primary remote, not a hardcoded origin.
  if (hasPrimaryRemote) {
    const primary = await resolvePrimaryRemoteName(cwd);
    if (primary) {
      const symbolic = await runGit(cwd, ['symbolic-ref', '--quiet', `refs/remotes/${primary}/HEAD`]);
      if (symbolic.code === 0) {
        const prefix = `refs/remotes/${primary}/`;
        const raw = symbolic.stdout.trim();
        const name = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.replace(/^refs\/remotes\/[^/]+\//, '');
        if (name) return name;
      }
    }
  }
  for (const candidate of ['main', 'master']) {
    const probe = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]);
    if (probe.code === 0) return candidate;
  }
  return null;
}

const DEFAULT_BASE_BRANCH_CANDIDATES = ['main', 'master'];

/**
 * No-upstream base: gh-merge-base, then default, then main/master.
 * Prefers the primary remote-tracking ref when it exists.
 * @param {string} cwd
 * @param {string} refName
 * @returns {Promise<string | null>}
 */
async function resolveBaseBranchForNoUpstream(cwd, refName) {
  const configured = await runGit(cwd, ['config', '--get', `branch.${refName}.gh-merge-base`]);
  const primary = await resolvePrimaryRemoteName(cwd);
  const defaultRef = await defaultRefName(cwd, Boolean(primary));
  const candidates = [
    configured.code === 0 ? configured.stdout.trim() : '',
    defaultRef,
    ...DEFAULT_BASE_BRANCH_CANDIDATES,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    let normalized = candidate;
    if (normalized.startsWith('origin/')) normalized = normalized.slice('origin/'.length);
    else if (primary && primary !== 'origin' && normalized.startsWith(`${primary}/`)) {
      normalized = normalized.slice(primary.length + 1);
    }
    if (!normalized || normalized === refName) continue;
    if (primary) {
      const remote = await runGit(cwd, ['show-ref', '--verify', '--quiet', `refs/remotes/${primary}/${normalized}`]);
      if (remote.code === 0) return `${primary}/${normalized}`;
    }
    const local = await runGit(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${normalized}`]);
    if (local.code === 0) return normalized;
  }
  return null;
}

async function computeAheadCountAgainstBase(cwd, refName) {
  const baseRef = await resolveBaseBranchForNoUpstream(cwd, refName);
  if (!baseRef) return { count: 0, unreliable: false };
  const listed = await runGit(cwd, ['rev-list', '--count', `${baseRef}..HEAD`]);
  if (listed.code !== 0) return { count: 0, unreliable: true };
  const count = Number(listed.stdout.trim());
  if (!Number.isFinite(count)) return { count: 0, unreliable: true };
  return { count: Math.max(0, count), unreliable: false };
}

async function resolveCurrentUpstream(cwd) {
  const up = await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const ref = up.stdout.trim();
  if (up.code !== 0 || !ref || ref === '@{upstream}') return null;
  const remotes = await listRemoteNames(cwd);
  for (const remote of remotes) {
    const prefix = `${remote}/`;
    if (ref.startsWith(prefix)) {
      return { remoteName: remote, branchName: ref.slice(prefix.length), upstreamRef: ref };
    }
  }
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) return null;
  return { remoteName: ref.slice(0, slash), branchName: ref.slice(slash + 1), upstreamRef: ref };
}

async function resolvePushRemoteName(cwd, refName) {
  const branchPush = await runGit(cwd, ['config', '--get', `branch.${refName}.pushRemote`]);
  if (branchPush.code === 0 && branchPush.stdout.trim()) return branchPush.stdout.trim();
  const pushDefault = await runGit(cwd, ['config', '--get', 'remote.pushDefault']);
  if (pushDefault.code === 0 && pushDefault.stdout.trim()) return pushDefault.stdout.trim();
  return resolvePrimaryRemoteName(cwd);
}

/**
 * Strip a remote-name prefix from a local ref.
 * @param {string} cwd
 * @param {string} branchName
 * @returns {Promise<string>}
 */
async function resolvePublishBranchName(cwd, branchName) {
  const remotes = await listRemoteNames(cwd);
  const trimmed = String(branchName || '').trim();
  for (const remoteName of remotes) {
    const prefix = `${remoteName}/`;
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trim();
      if (rest) return rest;
    }
  }
  return trimmed;
}

module.exports = {
  normalizeGitRemoteUrl,
  parseGitHubRepositoryNameWithOwner,
  providerFromRemoteUrl,
  listRemoteNames,
  resolvePrimaryRemoteName,
  selectProviderContext,
  changeRequestTerms,
  defaultRefName,
  resolveBaseBranchForNoUpstream,
  computeAheadCountAgainstBase,
  resolveCurrentUpstream,
  resolvePushRemoteName,
  resolvePublishBranchName,
};
