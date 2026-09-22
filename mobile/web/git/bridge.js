const CAMEL_TO_KEBAB = {
  gitStatus: 'git-status',
  gitFetchForStatus: 'git-fetch-status',
  gitReadPullRequest: 'git-pull-request',
  gitInit: 'git-init',
  gitCommit: 'git-commit',
  gitPush: 'git-push',
  gitPull: 'git-pull',
  gitCreateChangeRequest: 'git-create-change-request',
  gitPublishRepository: 'git-publish',
  gitStatusEntries: 'git-status-entries',
  gitBranchList: 'git-branch-list',
  gitSwitchBranch: 'git-switch-branch',
  gitCreateBranch: 'git-create-branch',
};

function gitTunnelAction(name) {
  return CAMEL_TO_KEBAB[name] || name;
}

function gitCommitPayload({ message = '', filePaths, featureBranch = false } = {}) {
  return {
    message,
    ...(Array.isArray(filePaths) ? { filePaths } : {}),
    options: featureBranch ? { featureBranch: true } : {},
  };
}

export { gitCommitPayload, gitTunnelAction };
