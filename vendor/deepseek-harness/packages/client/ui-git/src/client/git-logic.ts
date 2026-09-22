/** Git action state machine over this desktop's VcsStatus JSON. */

import type { GitKey } from './locales.ts'

/** Provider that owns change-request wording. */
export interface SourceControlProvider {
  kind: 'github' | 'gitlab' | 'azure-devops' | 'bitbucket' | 'unknown'
  name: string
  baseUrl: string
}

/** Open or closed change request attached to the current ref. */
export interface VcsPr {
  number: number
  title: string
  url: string
  baseRef: string
  headRef: string
  state: 'open' | 'closed' | 'merged'
}

/** Minimum VcsStatus JSON the titlebar Git control reads from desktop IPC. */
export interface VcsStatus {
  refName: string | null
  hasWorkingTreeChanges: boolean
  hasUpstream: boolean
  aheadCount: number
  behindCount: number
  aheadOfDefaultCount?: number
  /** True when no-upstream ahead vs the default/base ref could not be counted. Titlebar Push treats this as pushable; Create PR still uses aheadCount only. */
  aheadUnreliable?: boolean
  /** Changed paths with numstat; 0/0 when porcelain has no numstat. */
  workingTree: {
    files: Array<{ path: string; insertions: number; deletions: number }>
    insertions: number
    deletions: number
  }
  pr: VcsPr | null
  sourceControlProvider?: SourceControlProvider
  isDefaultRef?: boolean
  hasPrimaryRemote?: boolean
  /** False when the cwd is authorized but is not a git work tree. Absent on older payloads. */
  isRepo?: boolean
}

/** Desktop git mutation result. */
export interface GitResult {
  ok: boolean
  message?: string
  url?: string
  skipped?: boolean
  commitSha?: string
  subject?: string
  body?: string
  refName?: string
  branch?: string
  upstreamRef?: string
  upstreamBranch?: string
  status?: string
  number?: number
  title?: string
  pr?: VcsPr | null
}

/** Stacked git action the main button or a confirm dialog may run. */
export type GitStackedAction = 'commit' | 'push' | 'create_pr' | 'commit_push' | 'commit_push_pr'

/** Menu-row icon key. */
export type GitActionIconName = 'commit' | 'push' | 'pr'

/** Dialog the menu row opens, when it is not a view-PR link. */
export type GitDialogAction = 'commit' | 'push' | 'create_pr'

/** One dropdown row. */
export interface GitActionMenuItem {
  id: 'commit' | 'push' | 'pr'
  label: string
  disabled: boolean
  icon: GitActionIconName
  kind: 'open_dialog' | 'open_pr'
  dialogAction?: GitDialogAction
}

/** Primary split-button action. */
export interface GitQuickAction {
  label: string
  disabled: boolean
  kind: 'run_action' | 'run_pull' | 'open_pr' | 'open_publish' | 'show_hint'
  action?: GitStackedAction
  hint?: string
}

/** One default-ref confirm seat: a `git` dictionary key plus its params. */
export interface DefaultBranchDialogText {
  key: GitKey
  params?: Record<string, string>
}

/** Default-ref confirm copy, resolved through the `git` dictionary by the caller. */
export interface DefaultBranchActionDialogCopy {
  title: DefaultBranchDialogText
  description: DefaultBranchDialogText
  continueLabel: DefaultBranchDialogText
}

/** Actions that prompt before running on the default ref. */
export type DefaultBranchConfirmableAction = 'push' | 'create_pr' | 'commit_push' | 'commit_push_pr'

/** Provider-specific change-request wording. */
export interface ChangeRequestTerminology {
  shortLabel: string
  singular: string
}

/** GitHub wording used when no provider is known. */
export const DEFAULT_CHANGE_REQUEST_TERMINOLOGY: ChangeRequestTerminology = {
  shortLabel: 'PR',
  singular: 'pull request',
}

/**
 * Resolve change-request wording for a provider.
 * @param provider - discovered provider, or absent for the GitHub default.
 * @returns short and singular labels.
 */
export function getChangeRequestTerminology(
  provider: SourceControlProvider | null | undefined,
): ChangeRequestTerminology {
  if (provider === undefined || provider === null) return DEFAULT_CHANGE_REQUEST_TERMINOLOGY
  switch (provider.kind) {
    case 'gitlab':
      return { shortLabel: 'MR', singular: 'merge request' }
    case 'unknown':
      return { shortLabel: 'change request', singular: 'change request' }
    default:
      return DEFAULT_CHANGE_REQUEST_TERMINOLOGY
  }
}

function resolveChangeRequestTerminology(gitStatus: VcsStatus | null): ChangeRequestTerminology {
  return gitStatus?.sourceControlProvider
    ? getChangeRequestTerminology(gitStatus.sourceControlProvider)
    : DEFAULT_CHANGE_REQUEST_TERMINOLOGY
}

/**
 * Build the three dropdown rows (or commit-only when there is no origin).
 * @param gitStatus - current VcsStatus, or null when git is unavailable.
 * @param isBusy - true while a git action is running.
 * @param hasPrimaryRemote - whether an origin remote exists.
 * @returns menu items; empty when status is null.
 */
export function buildMenuItems(
  gitStatus: VcsStatus | null,
  isBusy: boolean,
  hasPrimaryRemote = true,
): GitActionMenuItem[] {
  if (!gitStatus) return []
  const terminology = resolveChangeRequestTerminology(gitStatus)

  const hasBranch = gitStatus.refName !== null
  const hasChanges = gitStatus.hasWorkingTreeChanges
  const hasOpenPr = gitStatus.pr?.state === 'open'
  const isBehind = gitStatus.behindCount > 0
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0
  const canPushWithoutUpstream = hasPrimaryRemote && !gitStatus.hasUpstream
  const canCommit = !isBusy && hasChanges
  const canPushAhead = gitStatus.aheadCount > 0 || Boolean(gitStatus.aheadUnreliable)
  const canPush =
    !isBusy
    && hasBranch
    && !isBehind
    && canPushAhead
    && (gitStatus.hasUpstream || canPushWithoutUpstream)
  const canCreatePr =
    !isBusy
    && hasBranch
    && !hasChanges
    && !hasOpenPr
    && hasDefaultBranchDelta
    && !isBehind
    && (gitStatus.hasUpstream || canPushWithoutUpstream)
  const canOpenPr = !isBusy && hasOpenPr

  const commitItem: GitActionMenuItem = {
    id: 'commit',
    label: 'Commit',
    disabled: !canCommit,
    icon: 'commit',
    kind: 'open_dialog',
    dialogAction: 'commit',
  }

  if (!hasPrimaryRemote) {
    return [commitItem]
  }

  return [
    commitItem,
    {
      id: 'push',
      label: 'Push',
      disabled: !canPush,
      icon: 'push',
      kind: 'open_dialog',
      dialogAction: 'push',
    },
    hasOpenPr
      ? {
          id: 'pr',
          label: `View ${terminology.shortLabel}`,
          disabled: !canOpenPr,
          icon: 'pr',
          kind: 'open_pr',
        }
      : {
          id: 'pr',
          label: `Create ${terminology.shortLabel}`,
          disabled: !canCreatePr,
          icon: 'pr',
          kind: 'open_dialog',
          dialogAction: 'create_pr',
        },
  ]
}

/**
 * Hover copy for a disabled Git menu row.
 * @param input - the row, live status, busy flag, and whether origin exists.
 * @returns the reason, or null when the row is enabled.
 */
export function getMenuActionDisabledReason(input: {
  item: GitActionMenuItem
  gitStatus: VcsStatus | null
  isBusy: boolean
  hasPrimaryRemote: boolean
}): string | null {
  const { item, gitStatus, isBusy, hasPrimaryRemote } = input
  if (!item.disabled) return null
  if (isBusy) return 'Git action in progress.'
  if (!gitStatus) return 'Git status is unavailable.'

  const hasBranch = gitStatus.refName !== null
  const hasChanges = gitStatus.hasWorkingTreeChanges
  const hasOpenPr = gitStatus.pr?.state === 'open'
  const isAhead = gitStatus.aheadCount > 0
  const isBehind = gitStatus.behindCount > 0
  const terminology = resolveChangeRequestTerminology(gitStatus)

  if (item.id === 'commit') {
    if (!hasChanges) return 'Worktree is clean. Make changes before committing.'
    return 'Commit is currently unavailable.'
  }

  if (item.id === 'push') {
    if (!hasBranch) return 'Detached HEAD: checkout a branch before pushing.'
    if (hasChanges) return 'Commit or stash local changes before pushing.'
    if (isBehind) return 'Branch is behind upstream. Pull/rebase before pushing.'
    if (!gitStatus.hasUpstream && !hasPrimaryRemote) return 'Add an "origin" remote before pushing.'
    if (!isAhead && !gitStatus.aheadUnreliable) return 'No local commits to push.'
    return 'Push is currently unavailable.'
  }

  if (hasOpenPr) return `View ${terminology.singular} is currently unavailable.`
  if (!hasBranch) return `Detached HEAD: checkout a branch before creating a ${terminology.singular}.`
  if (hasChanges) return `Commit local changes before creating a ${terminology.singular}.`
  if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
    return `Add an "origin" remote before creating a ${terminology.singular}.`
  }
  if (!isAhead) {
    return `No local commits to include in a ${terminology.singular}.`
  }
  if (isBehind) return `Branch is behind upstream. Pull/rebase before creating a ${terminology.singular}.`
  return `Create ${terminology.singular} is currently unavailable.`
}

/**
 * Resolve the primary split-button label and action.
 * @param gitStatus - current VcsStatus, or null when git is unavailable.
 * @param isBusy - true while a git action is running.
 * @param isDefaultRef - whether the current ref is the default branch.
 * @param hasPrimaryRemote - whether an origin remote exists.
 * @returns the quick action the main button should show.
 */
export function resolveQuickAction(
  gitStatus: VcsStatus | null,
  isBusy: boolean,
  isDefaultRef = false,
  hasPrimaryRemote = true,
): GitQuickAction {
  if (isBusy) {
    return { label: 'Commit', disabled: true, kind: 'show_hint', hint: 'Git action in progress.' }
  }

  if (!gitStatus) {
    return {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: 'Git status is unavailable.',
    }
  }

  const hasBranch = gitStatus.refName !== null
  const hasChanges = gitStatus.hasWorkingTreeChanges
  const hasOpenPr = gitStatus.pr?.state === 'open'
  const isAhead = gitStatus.aheadCount > 0
  const canPushAhead = isAhead || Boolean(gitStatus.aheadUnreliable)
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0
  const isBehind = gitStatus.behindCount > 0
  const isDiverged = isAhead && isBehind
  const terminology = resolveChangeRequestTerminology(gitStatus)
  const canViewPr = hasOpenPr && gitStatus.hasUpstream

  if (!hasBranch) {
    return {
      label: 'Commit',
      disabled: true,
      kind: 'show_hint',
      hint: `Create and checkout a ref before pushing or opening a ${terminology.singular}.`,
    }
  }

  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
      return { label: 'Commit', disabled: false, kind: 'run_action', action: 'commit' }
    }
    if (hasOpenPr || isDefaultRef) {
      return { label: 'Commit & push', disabled: false, kind: 'run_action', action: 'commit_push' }
    }
    return {
      label: `Commit, push & ${terminology.shortLabel}`,
      disabled: false,
      kind: 'run_action',
      action: 'commit_push_pr',
    }
  }

  if (!gitStatus.hasUpstream) {
    if (!hasPrimaryRemote) {
      if (hasOpenPr && !isAhead) {
        return { label: `View ${terminology.shortLabel}`, disabled: false, kind: 'open_pr' }
      }
      return {
        label: 'Publish repository',
        disabled: false,
        kind: 'open_publish',
      }
    }
    if (!canPushAhead) {
      if (hasOpenPr) {
        return { label: `View ${terminology.shortLabel}`, disabled: false, kind: 'open_pr' }
      }
      return {
        label: 'Push',
        disabled: true,
        kind: 'show_hint',
        hint: 'No local commits to push.',
      }
    }
    if (gitStatus.aheadUnreliable && !isAhead) {
      return { label: 'Push', disabled: false, kind: 'run_action', action: 'push' }
    }
    if (hasOpenPr || isDefaultRef) {
      return {
        label: 'Push',
        disabled: false,
        kind: 'run_action',
        action: isDefaultRef ? 'commit_push' : 'push',
      }
    }
    return {
      label: `Push & create ${terminology.shortLabel}`,
      disabled: false,
      kind: 'run_action',
      action: 'create_pr',
    }
  }

  if (isDiverged) {
    return {
      label: 'Sync ref',
      disabled: true,
      kind: 'show_hint',
      hint: 'Branch has diverged from upstream. Rebase/merge first.',
    }
  }

  if (isBehind) {
    return {
      label: 'Pull',
      disabled: false,
      kind: 'run_pull',
    }
  }

  if (canPushAhead) {
    if (gitStatus.aheadUnreliable && !isAhead) {
      return { label: 'Push', disabled: false, kind: 'run_action', action: 'push' }
    }
    if (hasOpenPr || isDefaultRef) {
      return {
        label: 'Push',
        disabled: false,
        kind: 'run_action',
        action: isDefaultRef ? 'commit_push' : 'push',
      }
    }
    return {
      label: `Push & create ${terminology.shortLabel}`,
      disabled: false,
      kind: 'run_action',
      action: 'create_pr',
    }
  }

  if (canViewPr) {
    return { label: `View ${terminology.shortLabel}`, disabled: false, kind: 'open_pr' }
  }

  if (hasDefaultBranchDelta && !isDefaultRef) {
    return {
      label: `Create ${terminology.shortLabel}`,
      disabled: false,
      kind: 'run_action',
      action: 'create_pr',
    }
  }

  return {
    label: 'Commit',
    disabled: true,
    kind: 'show_hint',
    hint: 'Branch is up to date. No action needed.',
  }
}

/**
 * Format the progress subtitle from a start timestamp.
 * @param startedAtMs - epoch ms when the current phase or hook began.
 * @param nowMs - clock sample; tests pass an explicit value.
 * @returns `Running for Ns` / `Running for Nm Ns`, or undefined before start.
 */
export function formatElapsedDescription(startedAtMs: number | null, nowMs = Date.now()): string | undefined {
  if (startedAtMs === null) return undefined
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))
  if (elapsedSeconds < 60) return `Running for ${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return `Running for ${minutes}m ${seconds}s`
}

/**
 * Predict the first toast titles for a stacked action before server events arrive.
 * @param input - action, whether a custom message exists, and whether a feature ref is created first.
 * @returns ordered phase titles.
 */
export function buildGitActionProgressStages(input: {
  action: GitStackedAction
  hasCustomCommitMessage: boolean
  hasWorkingTreeChanges: boolean
  featureBranch?: boolean
  shouldPushBeforePr?: boolean
  pushTarget?: string
  terminology?: ChangeRequestTerminology
}): string[] {
  const terminology = input.terminology ?? DEFAULT_CHANGE_REQUEST_TERMINOLOGY
  const branchStages = input.featureBranch ? ['Preparing feature ref...'] : []
  const pushStage = input.pushTarget ? `Pushing to ${input.pushTarget}...` : 'Pushing...'
  const prStages = [
    `Preparing ${terminology.shortLabel}...`,
    `Generating ${terminology.shortLabel} content...`,
    `Creating ${terminology.singular}...`,
  ]
  if (input.action === 'push') return [pushStage]
  if (input.action === 'create_pr') {
    return input.shouldPushBeforePr ? [pushStage, ...prStages] : prStages
  }
  const shouldIncludeCommitStages = input.action === 'commit' || input.hasWorkingTreeChanges
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? ['Committing...']
      : ['Generating commit message...', 'Committing...']
  if (input.action === 'commit') return [...branchStages, ...commitStages]
  if (input.action === 'commit_push') return [...branchStages, ...commitStages, pushStage]
  return [...branchStages, ...commitStages, pushStage, ...prStages]
}

/**
 * Pick a hook name from a git/lefthook/husky line.
 * @param line - one sanitized output line.
 * @returns hook name, or null when the line is ordinary output.
 */
export function inferHookName(line: string): string | null {
  if (/pre-push/i.test(line)) return 'pre-push'
  if (/pre-commit|lefthook|husky/i.test(line)) return 'pre-commit'
  return null
}

/**
 * Whether a git line is autocrlf / hint noise, not a failure.
 * @param line - one sanitized output line.
 * @returns true when the line must not become the toast error.
 */
export function isGitAdviceLine(line: string): boolean {
  return /LF will be replaced by CRLF|CRLF will be replaced by LF|warning: in the working copy of |^hint:/i.test(line)
}

/** One live line from desktop `shell:git-progress`. */
export interface GitProgressEvent {
  actionId: number
  kind: string
  title?: string
  text?: string
  hookName?: string
}

/**
 * Pick the toast error subtitle: last hook line, else the first short dump line.
 * @param message - full git/hook dump.
 * @param lastLine - latest progress line, if any.
 * @param fallback - generic copy when both are empty or too long.
 * @returns a single-line subtitle.
 */
export function toastFailureDescription(
  message: string,
  lastLine: string | null,
  fallback: string,
): string {
  const candidates = [lastLine, ...message.split(/\r?\n/)]
    .map(item => item?.trim() ?? '')
    .filter(item => item !== '' && !isGitAdviceLine(item))
  const marked = candidates.find(item => /fatal:|error:|hook|failed|Format issues/i.test(item))
  const picked = marked ?? candidates[0]
  if (picked !== undefined && picked.length <= 180) return picked
  return fallback
}

/**
 * Whether a stacked action must confirm before running on the default ref.
 * @param action - stacked action about to run.
 * @param isDefaultRef - whether the current ref is the default branch.
 * @returns true when the default-ref dialog must open first.
 */
export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultRef: boolean,
): boolean {
  if (!isDefaultRef) return false
  return (
    action === 'push'
    || action === 'create_pr'
    || action === 'commit_push'
    || action === 'commit_push_pr'
  )
}

const TOAST_DESCRIPTION_MAX = 72
const SHORT_SHA_LENGTH = 7

/** Folded result of one stacked titlebar git action. */
export interface StackedActionResult {
  action: GitStackedAction
  commit?: { status: 'created' | 'skipped'; commitSha?: string; subject?: string }
  push?: { status: 'pushed' | 'skipped'; branch?: string; upstreamBranch?: string }
  pr?: { status: 'created' | 'opened_existing' | 'none'; url?: string; number?: number; title?: string }
}

/** Window-focus VCS refresh debounce. */
export const GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS = 250

/**
 * Attach an already-open PR for CTA only. Success titles stay on the action that ran.
 * @param result - folded stacked outcome.
 * @param status - status after the action, including a background PR lookup.
 * @returns a copy with `pr` filled when HEAD already has an open change request.
 */
export function attachOpenPrForCta(result: StackedActionResult, status: VcsStatus | null): StackedActionResult {
  if (result.pr?.url) return result
  const pr = status?.pr
  if (!pr || pr.state !== 'open' || !pr.url) return result
  return {
    ...result,
    pr: {
      status: 'opened_existing',
      url: pr.url,
      ...(pr.number ? { number: pr.number } : {}),
      ...(pr.title ? { title: pr.title } : {}),
    },
  }
}

/** Success-toast CTA after a stacked action. */
export type GitCompletionCta =
  | { kind: 'none' }
  | { kind: 'open_pr'; label: string; url: string }
  | { kind: 'run_action'; label: string; action: GitStackedAction }

/**
 * Shorten a commit SHA for toast titles.
 * @param sha - full or abbreviated SHA.
 * @returns the first 7 characters, or null when absent.
 */
export function shortenSha(sha?: string): string | null {
  if (!sha) return null
  return sha.slice(0, SHORT_SHA_LENGTH)
}

/**
 * Truncate a toast description.
 * @param value - subject or PR title.
 * @param maxLength - character cap.
 * @returns the clipped text, or undefined when empty.
 */
export function truncateText(value: string | undefined, maxLength = TOAST_DESCRIPTION_MAX): string | undefined {
  if (!value) return undefined
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

/**
 * Build the success title/description from a stacked result.
 * @param result - commit/push/PR outcomes.
 * @param terms - provider wording.
 * @returns toast title and optional description.
 */
export function summarizeGitActionResult(
  result: StackedActionResult,
  terms: ChangeRequestTerminology,
): { title: string; description?: string } {
  if (result.pr?.status === 'created' || result.pr?.status === 'opened_existing') {
    const prNumber = result.pr.number ? ` #${result.pr.number}` : ''
    const title = `${result.pr.status === 'created' ? 'Created' : 'Opened'} ${terms.shortLabel}${prNumber}`
    const description = truncateText(result.pr.title)
    return description ? { title, description } : { title }
  }
  if (result.push?.status === 'pushed') {
    const shortSha = shortenSha(result.commit?.commitSha)
    const branch = result.push.upstreamBranch ?? result.push.branch
    const title = `Pushed${shortSha ? ` ${shortSha}` : ''}${branch ? ` to ${branch}` : ''}`
    const description = truncateText(result.commit?.subject)
    return description ? { title, description } : { title }
  }
  if (result.commit?.status === 'created') {
    const shortSha = shortenSha(result.commit.commitSha)
    const title = shortSha ? `Committed ${shortSha}` : 'Committed changes'
    const description = truncateText(result.commit.subject)
    return description ? { title, description } : { title }
  }
  return { title: 'Done' }
}

/**
 * Pick the completion CTA for a stacked result.
 * @param result - commit/push/PR outcomes.
 * @param terms - provider wording.
 * @param isDefaultRef - whether the current ref is the default branch.
 * @returns the toast action, or none.
 */
export function resolveCompletionCta(
  result: StackedActionResult,
  terms: ChangeRequestTerminology,
  isDefaultRef: boolean,
): GitCompletionCta {
  if (result.action === 'commit' && result.commit?.status === 'created') {
    return { kind: 'run_action', label: 'Push', action: 'push' }
  }
  const openPr = (result.pr?.status === 'created' || result.pr?.status === 'opened_existing')
    ? result.pr
    : null
  if (
    (result.action === 'push' || result.action === 'create_pr' || result.action === 'commit_push' || result.action === 'commit_push_pr')
    && openPr?.url
    && (!isDefaultRef || result.pr?.status === 'created' || result.pr?.status === 'opened_existing')
  ) {
    return { kind: 'open_pr', label: `View ${terms.shortLabel}`, url: openPr.url }
  }
  if (
    (result.action === 'push' || result.action === 'commit_push')
    && result.push?.status === 'pushed'
    && !isDefaultRef
  ) {
    return { kind: 'run_action', label: `Create ${terms.shortLabel}`, action: 'create_pr' }
  }
  return { kind: 'none' }
}

/**
 * Build the default-ref confirmation title, body, and continue label.
 * @param input.action - confirmable stacked action.
 * @param input.branchName - current default ref name.
 * @param input.includesCommit - whether the run will create a commit.
 * @param input.terminology - provider wording; GitHub default when omitted.
 * @returns dialog copy as `git` dictionary keys plus interpolation params.
 */
export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction
  branchName: string
  includesCommit: boolean
  terminology?: ChangeRequestTerminology
}): DefaultBranchActionDialogCopy {
  const branch = input.branchName
  const terminology = input.terminology ?? DEFAULT_CHANGE_REQUEST_TERMINOLOGY

  if (input.action === 'push' || input.action === 'commit_push') {
    if (input.includesCommit) {
      return {
        title: { key: 'confirm.commitPush.title' },
        description: { key: 'confirm.commitPush.description', params: { branch } },
        continueLabel: { key: 'confirm.commitPush.continue', params: { branch } },
      }
    }
    return {
      title: { key: 'confirm.push.title' },
      description: { key: 'confirm.push.description', params: { branch } },
      continueLabel: { key: 'confirm.push.continue', params: { branch } },
    }
  }

  // Titles and buttons carry the short label (PR/MR); descriptions spell the
  // singular term (pull request / merge request).
  if (input.includesCommit) {
    return {
      title: { key: 'confirm.commitPr.title', params: { kind: terminology.shortLabel } },
      description: { key: 'confirm.commitPr.description', params: { branch, kind: terminology.singular } },
      continueLabel: { key: 'confirm.commitPr.continue', params: { kind: terminology.shortLabel } },
    }
  }
  return {
    title: { key: 'confirm.pr.title', params: { kind: terminology.shortLabel } },
    description: { key: 'confirm.pr.description', params: { branch, kind: terminology.singular } },
    continueLabel: { key: 'confirm.pr.continue', params: { kind: terminology.shortLabel } },
  }
}
