const ACTION_MAP = {
  commit: ['git-commit'],
  commit_push: ['git-commit', 'git-push'],
  commit_push_pr: ['git-commit', 'git-push', 'git-create-change-request'],
  push: ['git-push'],
  create_pr: ['git-create-change-request'],
  pull: ['git-pull'],
};

async function runStackedGit(run, action, extra = {}) {
  const steps = ACTION_MAP[action] || [action];
  for (const step of steps) {
    await run(step, extra);
  }
}

export { runStackedGit };
