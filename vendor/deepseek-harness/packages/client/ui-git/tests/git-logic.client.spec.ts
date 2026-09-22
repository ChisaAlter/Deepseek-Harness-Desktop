/** Git action vectors against this package's VcsStatus JSON. */
import { describe, expect, it } from 'vitest'
import type { VcsStatus } from '../src/client/git-logic.ts'
import {
  buildGitActionProgressStages,
  buildMenuItems,
  formatElapsedDescription,
  inferHookName,
  isGitAdviceLine,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  attachOpenPrForCta,
  resolveCompletionCta,
  resolveQuickAction,
  summarizeGitActionResult,
  getMenuActionDisabledReason,
  toastFailureDescription,
} from '../src/client/git-logic.ts'

const GITHUB: NonNullable<VcsStatus['sourceControlProvider']> = {
  kind: 'github',
  name: 'GitHub',
  baseUrl: 'https://github.com',
}

function status(overrides: Omit<Partial<VcsStatus>, 'sourceControlProvider'> & { sourceControlProvider?: VcsStatus['sourceControlProvider'] | undefined } = {}): VcsStatus {
  const base: VcsStatus = {
    refName: 'feature/test',
    hasWorkingTreeChanges: false,
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    sourceControlProvider: GITHUB,
    workingTree: { files: [], insertions: 0, deletions: 0 },
  }
  // Spread-equivalent merge that keeps exactOptionalPropertyTypes quiet: an
  // explicit `sourceControlProvider: undefined` override must win over GITHUB,
  // which a fresh literal spread cannot express.
  Object.assign(base, overrides)
  return base
}

describe('when: working tree has local changes on the default ref', () => {
  it('resolveQuickAction returns Commit & push', () => {
    const quick = resolveQuickAction(
      status({ refName: 'main', hasWorkingTreeChanges: true }),
      false,
      true,
    )
    expect(quick).toMatchObject({
      kind: 'run_action',
      action: 'commit_push',
      label: 'Commit & push',
      disabled: false,
    })
  })
})

describe('when: ref is clean, ahead, and on the default ref', () => {
  it('resolveQuickAction returns Push', () => {
    const quick = resolveQuickAction(
      status({ refName: 'main', aheadCount: 2, pr: null }),
      false,
      true,
    )
    expect(quick).toMatchObject({
      kind: 'run_action',
      action: 'commit_push',
      label: 'Push',
      disabled: false,
    })
  })
})

describe('when: git status is unavailable', () => {
  it('resolveQuickAction returns unavailable disabled state', () => {
    const quick = resolveQuickAction(null, false)
    expect(quick).toMatchObject({
      kind: 'show_hint',
      label: 'Commit',
      disabled: true,
      hint: 'Git status is unavailable.',
    })
  })

  it('buildMenuItems returns no menu items', () => {
    expect(buildMenuItems(null, false)).toEqual([])
  })
})

describe('when: ref is clean, ahead, and has no open PR', () => {
  it('resolveQuickAction pushes and creates a PR', () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, pr: null }), false)
    expect(quick).toMatchObject({
      kind: 'run_action',
      action: 'create_pr',
      label: 'Push & create PR',
    })
  })

  it('buildMenuItems enables push and create PR, with commit disabled', () => {
    expect(buildMenuItems(status({ aheadCount: 2, pr: null }), false)).toEqual([
      {
        id: 'commit',
        label: 'Commit',
        disabled: true,
        icon: 'commit',
        kind: 'open_dialog',
        dialogAction: 'commit',
      },
      {
        id: 'push',
        label: 'Push',
        disabled: false,
        icon: 'push',
        kind: 'open_dialog',
        dialogAction: 'push',
      },
      {
        id: 'pr',
        label: 'Create PR',
        disabled: false,
        icon: 'pr',
        kind: 'open_dialog',
        dialogAction: 'create_pr',
      },
    ])
  })
})

describe('when: source control provider uses merge requests', () => {
  it('keeps Create MR rows; desktop gh failure stays on the backend', () => {
    const gitlabStatus = status({
      aheadCount: 2,
      sourceControlProvider: {
        kind: 'gitlab',
        name: 'GitLab',
        baseUrl: 'https://gitlab.com',
      },
    })
    expect(resolveQuickAction(gitlabStatus, false)).toMatchObject({
      kind: 'run_action',
      action: 'create_pr',
      label: 'Push & create MR',
    })
    expect(buildMenuItems(gitlabStatus, false).map(item => item.id)).toEqual(['commit', 'push', 'pr'])
    expect(buildMenuItems(gitlabStatus, false).find(item => item.id === 'pr')?.label).toBe('Create MR')
  })
})

describe('when: actions are busy', () => {
  it('resolveQuickAction returns running disabled state', () => {
    expect(resolveQuickAction(status(), true)).toMatchObject({
      kind: 'show_hint',
      label: 'Commit',
      disabled: true,
      hint: 'Git action in progress.',
    })
  })
})

describe('when: working tree has local changes on a feature ref', () => {
  it('resolveQuickAction returns commit, push, and create PR', () => {
    expect(resolveQuickAction(status({ hasWorkingTreeChanges: true }), false)).toMatchObject({
      kind: 'run_action',
      action: 'commit_push_pr',
      label: 'Commit, push & PR',
    })
  })

  it('buildMenuItems enables commit and disables push and PR', () => {
    const items = buildMenuItems(status({ hasWorkingTreeChanges: true }), false)
    expect(items.find(item => item.id === 'commit')?.disabled).toBe(false)
    expect(items.find(item => item.id === 'push')?.disabled).toBe(true)
    expect(items.find(item => item.id === 'pr')?.disabled).toBe(true)
  })
})

describe('requiresDefaultBranchConfirmation', () => {
  it('requires confirmation for push actions on default ref', () => {
    expect(requiresDefaultBranchConfirmation('commit', true)).toBe(false)
    expect(requiresDefaultBranchConfirmation('push', true)).toBe(true)
    expect(requiresDefaultBranchConfirmation('create_pr', true)).toBe(true)
    expect(requiresDefaultBranchConfirmation('commit_push', true)).toBe(true)
    expect(requiresDefaultBranchConfirmation('commit_push_pr', true)).toBe(true)
    expect(requiresDefaultBranchConfirmation('commit_push', false)).toBe(false)
    expect(requiresDefaultBranchConfirmation('push', false)).toBe(false)
  })
})

describe('resolveDefaultBranchActionDialogCopy', () => {
  it('uses push-only keys when pushing without a commit', () => {
    expect(resolveDefaultBranchActionDialogCopy({
      action: 'commit_push',
      branchName: 'main',
      includesCommit: false,
    })).toEqual({
      title: { key: 'confirm.push.title' },
      description: { key: 'confirm.push.description', params: { branch: 'main' } },
      continueLabel: { key: 'confirm.push.continue', params: { branch: 'main' } },
    })
  })

  it('keeps commit keys when the action includes a commit', () => {
    expect(resolveDefaultBranchActionDialogCopy({
      action: 'commit_push',
      branchName: 'main',
      includesCommit: true,
    })).toEqual({
      title: { key: 'confirm.commitPush.title' },
      description: { key: 'confirm.commitPush.description', params: { branch: 'main' } },
      continueLabel: { key: 'confirm.commitPush.continue', params: { branch: 'main' } },
    })
  })

  it('uses PR keys with short and singular wording seats', () => {
    expect(resolveDefaultBranchActionDialogCopy({
      action: 'create_pr',
      branchName: 'main',
      includesCommit: false,
      terminology: { shortLabel: 'MR', singular: 'merge request' },
    })).toEqual({
      title: { key: 'confirm.pr.title', params: { kind: 'MR' } },
      description: { key: 'confirm.pr.description', params: { branch: 'main', kind: 'merge request' } },
      continueLabel: { key: 'confirm.pr.continue', params: { kind: 'MR' } },
    })
    expect(resolveDefaultBranchActionDialogCopy({
      action: 'commit_push_pr',
      branchName: 'main',
      includesCommit: true,
    })).toEqual({
      title: { key: 'confirm.commitPr.title', params: { kind: 'PR' } },
      description: { key: 'confirm.commitPr.description', params: { branch: 'main', kind: 'pull request' } },
      continueLabel: { key: 'confirm.commitPr.continue', params: { kind: 'PR' } },
    })
  })
})

describe('git progress helpers', () => {
  it('formatElapsedDescription uses seconds then minutes', () => {
    expect(formatElapsedDescription(null, 10_000)).toBeUndefined()
    expect(formatElapsedDescription(1000, 1000)).toBe('Running for 0s')
    expect(formatElapsedDescription(1000, 4000)).toBe('Running for 3s')
    expect(formatElapsedDescription(1000, 64_000)).toBe('Running for 1m 3s')
  })

  it('buildGitActionProgressStages starts with Generating commit message when the message is empty', () => {
    expect(buildGitActionProgressStages({
      action: 'commit_push_pr',
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
    })[0]).toBe('Generating commit message...')
    expect(buildGitActionProgressStages({
      action: 'commit',
      hasCustomCommitMessage: true,
      hasWorkingTreeChanges: true,
    })).toEqual(['Committing...'])
    expect(buildGitActionProgressStages({
      action: 'push',
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
    })).toEqual(['Pushing...'])
    expect(buildGitActionProgressStages({
      action: 'commit',
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      featureBranch: true,
    })).toEqual(['Preparing feature ref...', 'Generating commit message...', 'Committing...'])
  })

  it('inferHookName maps lefthook and pre-push lines', () => {
    expect(inferHookName('lefthook v2.1.10')).toBe('pre-commit')
    expect(inferHookName('Running pre-push hook')).toBe('pre-push')
    expect(inferHookName('oxfmt --check')).toBeNull()
  })

  it('toastFailureDescription prefers the last hook line', () => {
    expect(toastFailureDescription('a\nb', 'lefthook failed', 'fallback')).toBe('lefthook failed')
    expect(toastFailureDescription('origin rejected the push.', null, 'fallback')).toBe(
      'origin rejected the push.',
    )
    expect(toastFailureDescription('x'.repeat(200), null, 'fallback')).toBe('fallback')
  })

  it('toastFailureDescription skips CRLF warnings', () => {
    const warning = "warning: in the working copy of 'src/a.ts' LF will be replaced by CRLF the next time Git touches it"
    expect(isGitAdviceLine(warning)).toBe(true)
    expect(toastFailureDescription(
      `${warning}\nhusky - pre-commit script failed (code 1)`,
      warning,
      'fallback',
    )).toBe('husky - pre-commit script failed (code 1)')
  })

  it('summarizeGitActionResult matches stacked-action titles', () => {
    expect(summarizeGitActionResult({
      action: 'commit_push_pr',
      pr: { status: 'created', number: 12, title: 'Add files' },
    }, { shortLabel: 'PR', singular: 'pull request' })).toEqual({
      title: 'Created PR #12',
      description: 'Add files',
    })
    expect(summarizeGitActionResult({
      action: 'commit_push',
      commit: { status: 'created', commitSha: 'abcdef123456', subject: 'Add files' },
      push: { status: 'pushed', upstreamBranch: 'origin/feature' },
    }, { shortLabel: 'PR', singular: 'pull request' })).toEqual({
      title: 'Pushed abcdef1 to origin/feature',
      description: 'Add files',
    })
    expect(summarizeGitActionResult({
      action: 'commit',
      commit: { status: 'created', commitSha: 'abcdef123456', subject: 'Add files' },
    }, { shortLabel: 'PR', singular: 'pull request' })).toEqual({
      title: 'Committed abcdef1',
      description: 'Add files',
    })
  })

  it('resolveCompletionCta offers Push after commit and Create PR after push', () => {
    expect(resolveCompletionCta({
      action: 'commit',
      commit: { status: 'created', commitSha: 'abc' },
    }, { shortLabel: 'PR', singular: 'pull request' }, false)).toEqual({
      kind: 'run_action',
      label: 'Push',
      action: 'push',
    })
    expect(resolveCompletionCta({
      action: 'push',
      push: { status: 'pushed' },
    }, { shortLabel: 'PR', singular: 'pull request' }, false)).toEqual({
      kind: 'run_action',
      label: 'Create PR',
      action: 'create_pr',
    })
    expect(resolveCompletionCta({
      action: 'commit_push_pr',
      pr: { status: 'created', url: 'https://example.com/pr/1' },
    }, { shortLabel: 'PR', singular: 'pull request' }, false)).toEqual({
      kind: 'open_pr',
      label: 'View PR',
      url: 'https://example.com/pr/1',
    })
    expect(resolveCompletionCta({
      action: 'commit_push',
      push: { status: 'pushed' },
    }, { shortLabel: 'PR', singular: 'pull request' }, true)).toEqual({ kind: 'none' })
    expect(resolveCompletionCta(attachOpenPrForCta({
      action: 'commit_push',
      push: { status: 'pushed' },
    }, status({
      refName: 'feature/add-files',
      isDefaultRef: false,
      hasWorkingTreeChanges: false,
    })), { shortLabel: 'PR', singular: 'pull request' }, false)).toEqual({
      kind: 'run_action',
      label: 'Create PR',
      action: 'create_pr',
    })
    expect(resolveCompletionCta(attachOpenPrForCta({
      action: 'push',
      push: { status: 'pushed' },
    }, status({
      pr: {
        number: 4,
        title: 'Add files',
        url: 'https://example.com/4',
        baseRef: 'main',
        headRef: 'feature/test',
        state: 'open',
      },
    })), { shortLabel: 'PR', singular: 'pull request' }, false)).toEqual({
      kind: 'open_pr',
      label: 'View PR',
      url: 'https://example.com/4',
    })
  })

  it('resolveCompletionCta offers Create MR after push without a GitHub gate', () => {
    expect(resolveCompletionCta({
      action: 'push',
      push: { status: 'pushed' },
    }, { shortLabel: 'MR', singular: 'merge request' }, false)).toEqual({
      kind: 'run_action',
      label: 'Create MR',
      action: 'create_pr',
    })
  })
})

describe('when: a feature ref has commits and no upstream', () => {
  it('resolveQuickAction pushes and creates a PR when aheadCount is vs the default ref', () => {
    expect(resolveQuickAction(status({
      hasUpstream: false,
      aheadCount: 2,
      aheadOfDefaultCount: 2,
    }), false)).toMatchObject({
      kind: 'run_action',
      action: 'create_pr',
      label: 'Push & create PR',
    })
  })

  it('buildMenuItems enables Push only from aheadCount, not aheadOfDefaultCount alone', () => {
    expect(buildMenuItems(status({
      hasUpstream: false,
      aheadCount: 0,
      aheadOfDefaultCount: 2,
    }), false)[1]).toMatchObject({
      id: 'push',
      disabled: true,
    })
    expect(buildMenuItems(status({
      hasUpstream: false,
      aheadCount: 2,
      aheadOfDefaultCount: 2,
    }), false)[1]).toMatchObject({
      id: 'push',
      disabled: false,
    })
  })

  it('keeps Push enabled when aheadUnreliable so gitPush can run', () => {
    const noUpstream = status({
      hasUpstream: false,
      aheadCount: 0,
      aheadOfDefaultCount: 0,
      aheadUnreliable: true,
    })
    expect(resolveQuickAction(noUpstream, false)).toMatchObject({
      kind: 'run_action',
      label: 'Push',
      disabled: false,
      action: 'push',
    })
    expect(buildMenuItems(noUpstream, false).find(item => item.id === 'push')).toMatchObject({
      disabled: false,
    })
    expect(buildMenuItems(noUpstream, false).find(item => item.id === 'pr')?.disabled).toBe(true)

    const withUpstream = status({
      hasUpstream: true,
      aheadCount: 0,
      aheadUnreliable: true,
    })
    expect(resolveQuickAction(withUpstream, false)).toMatchObject({
      kind: 'run_action',
      label: 'Push',
      disabled: false,
      action: 'push',
    })
    expect(buildMenuItems(withUpstream, false).find(item => item.id === 'push')).toMatchObject({
      disabled: false,
    })
  })
})

describe('Create PR in the menu', () => {
  it('stays in the menu when the provider is absent or not GitHub', () => {
    expect(buildMenuItems(status({
      aheadCount: 2,
      sourceControlProvider: undefined,
    }), false).map(item => item.id)).toEqual(['commit', 'push', 'pr'])
    expect(buildMenuItems(status({
      aheadCount: 2,
      sourceControlProvider: {
        kind: 'gitlab',
        name: 'GitLab',
        baseUrl: 'https://gitlab.com',
      },
    }), false).find(item => item.id === 'pr')).toMatchObject({
      label: 'Create MR',
      disabled: false,
    })
  })
})

describe('getMenuActionDisabledReason', () => {
  it('explains a clean worktree, no-ahead push, and dirty create PR', () => {
    const clean = status({ aheadCount: 0 })
    expect(getMenuActionDisabledReason({
      item: buildMenuItems(clean, false)[0]!,
      gitStatus: clean,
      isBusy: false,
      hasPrimaryRemote: true,
    })).toBe('Worktree is clean. Make changes before committing.')
    expect(getMenuActionDisabledReason({
      item: buildMenuItems(clean, false)[1]!,
      gitStatus: clean,
      isBusy: false,
      hasPrimaryRemote: true,
    })).toBe('No local commits to push.')
    const dirty = status({ hasWorkingTreeChanges: true })
    expect(getMenuActionDisabledReason({
      item: buildMenuItems(dirty, false)[2]!,
      gitStatus: dirty,
      isBusy: false,
      hasPrimaryRemote: true,
    })).toBe('Commit local changes before creating a pull request.')
  })

  it('Push disabled reason does not claim no local commits when aheadUnreliable', () => {
    const unreliable = status({
      aheadCount: 0,
      aheadUnreliable: true,
      hasWorkingTreeChanges: false,
      hasUpstream: true,
    })
    const push = { ...buildMenuItems(unreliable, false).find(item => item.id === 'push')!, disabled: true }
    expect(getMenuActionDisabledReason({
      item: push,
      gitStatus: unreliable,
      isBusy: false,
      hasPrimaryRemote: true,
    })).toBe('Push is currently unavailable.')
  })

  it('returns null for an enabled row and busy copy while an action runs', () => {
    const ahead = status({ aheadCount: 2 })
    expect(getMenuActionDisabledReason({
      item: buildMenuItems(ahead, false)[1]!,
      gitStatus: ahead,
      isBusy: false,
      hasPrimaryRemote: true,
    })).toBeNull()
    expect(getMenuActionDisabledReason({
      item: buildMenuItems(ahead, true)[1]!,
      gitStatus: ahead,
      isBusy: true,
      hasPrimaryRemote: true,
    })).toBe('Git action in progress.')
  })

  it('Create PR disabled reason uses aheadCount only', () => {
    const noUpstreamAheadVsDefault = status({
      hasUpstream: false,
      aheadCount: 2,
      aheadOfDefaultCount: 2,
      hasWorkingTreeChanges: false,
    })
    expect(getMenuActionDisabledReason({
      item: buildMenuItems(noUpstreamAheadVsDefault, false)[2]!,
      gitStatus: noUpstreamAheadVsDefault,
      isBusy: false,
      hasPrimaryRemote: true,
    })).toBeNull()

    const behindWithDefaultDeltaOnly = status({
      hasUpstream: true,
      aheadCount: 0,
      aheadOfDefaultCount: 2,
      behindCount: 1,
      hasWorkingTreeChanges: false,
    })
    const createPr = buildMenuItems(behindWithDefaultDeltaOnly, false)[2]!
    expect(createPr.disabled).toBe(true)
    expect(getMenuActionDisabledReason({
      item: createPr,
      gitStatus: behindWithDefaultDeltaOnly,
      isBusy: false,
      hasPrimaryRemote: true,
    })).toBe('No local commits to include in a pull request.')
  })
})
