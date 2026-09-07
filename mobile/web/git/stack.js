const ACTION_MAP = {
  commit: ['git-commit'],
  commit_push: ['git-commit', 'git-push'],
  commit_push_pr: ['git-commit', 'git-push', 'git-create-change-request'],
  push: ['git-push'],
  create_pr: ['git-push', 'git-create-change-request'],
  create_branch_push: ['git-create-branch', 'git-push'],
  create_branch_pr: ['git-create-branch', 'git-push', 'git-create-change-request'],
  pull: ['git-pull'],
};

async function runStackedGit(run, action, extra = {}, { completed = [], onProgress = () => {} } = {}) {
  const steps = ACTION_MAP[action] || [action];
  if (completed.some((step, index) => steps[index] !== step)) throw new Error('Git progress does not match the operation');
  const done = completed.slice();
  for (const step of steps.slice(done.length)) {
    onProgress(step, done.slice());
    try {
      await run(step, extra);
      done.push(step);
    } catch (cause) {
      const error = new Error(cause?.message || 'Git operation failed', { cause });
      error.completedSteps = done.slice();
      error.remainingSteps = steps.slice(done.length);
      throw error;
    }
  }
  return done;
}

export { runStackedGit };
