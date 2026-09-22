const REMOTE_SHELL_NAMES = [
  'gitStatus',
  'gitFetchForStatus',
  'gitDiff',
  'gitCommit',
  'gitPush',
  'gitPull',
  'gitBranchList',
  'gitSwitchBranch',
  'gitCreateBranch',
  'gitCreateChangeRequest',
  'listDir',
  'openSettings',
  'openGallery',
  'getConfig',
  'saveConfig',
];

const NAME_SET = new Set(REMOTE_SHELL_NAMES);

function isRemoteShellName(name) {
  return NAME_SET.has(String(name || ''));
}

function shellNameFromUrl(url) {
  const pathname = decodeURIComponent(String(url || '').split('?')[0] || '');
  const match = pathname.match(/^\/__remote__\/shell\/([^/]+)$/);
  return match ? match[1] : null;
}

function fail(error, status = 400) {
  return { ok: false, error: String(error || '请求失败'), status };
}

function ok(result) {
  return { ok: true, result };
}

function wrapResult(result, emptyMessage = '工作区不可用') {
  if (result == null) return fail(emptyMessage);
  if (result && result.ok === false) {
    return fail(result.message || result.error || emptyMessage);
  }
  return ok(result);
}

async function invokeDesktopShell({ name, payload, git = {}, fs = {}, host = {} }) {
  if (!isRemoteShellName(name)) {
    return fail('not found', 404);
  }
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  try {
    switch (name) {
      case 'gitStatus':
        return wrapResult(await git.gitStatus(body.cwd));
      case 'gitFetchForStatus':
        return wrapResult(await git.gitFetchForStatus(body.cwd));
      case 'gitDiff':
        return wrapResult(await git.gitDiff(body.cwd, body.options || {}));
      case 'gitCommit':
        return wrapResult(
          await git.gitCommit(
            body.cwd,
            body.message,
            body.filePaths,
            undefined,
            body.options || {},
          ),
        );
      case 'gitPush':
        return wrapResult(await git.gitPush(body.cwd));
      case 'gitPull':
        return wrapResult(await git.gitPull(body.cwd));
      case 'gitBranchList':
        return wrapResult(await git.gitBranchList(body.cwd));
      case 'gitSwitchBranch':
        return wrapResult(await git.gitSwitchBranch(body.cwd, body.ref));
      case 'gitCreateBranch':
        return wrapResult(await git.gitCreateBranch(body.cwd, body.name));
      case 'gitCreateChangeRequest':
        return wrapResult(await git.gitCreateChangeRequest(body.cwd, body.input || {}));
      case 'listDir':
        return wrapResult(await fs.listDir(body.cwd, body.relativePath || ''));
      case 'openSettings': {
        const opened = await host.openSettings(body.sectionId);
        return ok({ opened: Boolean(opened), section: typeof body.sectionId === 'string' ? body.sectionId : '' });
      }
      case 'openGallery': {
        const opened = await host.openSettings('appearance');
        return ok({ opened: Boolean(opened), section: 'appearance' });
      }
      case 'getConfig':
        return ok(await host.getConfig());
      case 'saveConfig':
        return ok(await host.saveConfig(body.patch || {}));
      default:
        return fail('not found', 404);
    }
  } catch (error) {
    return fail(error && error.message ? error.message : error);
  }
}

module.exports = {
  REMOTE_SHELL_NAMES,
  isRemoteShellName,
  shellNameFromUrl,
  invokeDesktopShell,
};
