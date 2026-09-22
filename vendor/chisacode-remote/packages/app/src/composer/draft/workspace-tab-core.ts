import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";
import type { ProviderSelectionCopy } from "@/provider-selection/provider-selection";

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string;
  model: string | null;
}

/**
 * How long the /new auto-send flow waits for its readiness gates (workspace
 * hydration, daemon client, model defaults) before restoring the submission
 * into the composer for a manual send. Bounds the auto-send so a stalled gate
 * can never leave the user on an empty draft page with the message gone.
 */
export const AUTO_SUBMIT_READINESS_WATCHDOG_MS = 10_000;

/**
 * Whether the pending /new submission should be restored to the composer and
 * given up on automatic sending.
 * @param input.hasPending Whether a pending auto-submit still exists
 * @param input.isReady Whether the auto-submit readiness gates are satisfied
 * @param input.sendStarted Whether the create attempt already started
 * @param input.waitedForMs How long readiness was waited for
 * @param input.thresholdMs The wait budget before restoring
 * @returns True when the submission should be restored for a manual send
 */
export function shouldRestorePendingAutoSubmit(input: {
  hasPending: boolean;
  isReady: boolean;
  sendStarted: boolean;
  waitedForMs: number;
  thresholdMs: number;
}): boolean {
  const { hasPending, isReady, sendStarted, waitedForMs, thresholdMs } = input;
  if (!hasPending || isReady || sendStarted) {
    return false;
  }
  return waitedForMs >= thresholdMs;
}

export function shouldWaitForDraftModelReadiness(input: {
  autoSubmitConfig: WorkspaceDraftAutoSubmitConfig | null;
  isModelLoading: boolean;
}): boolean {
  if (input.autoSubmitConfig?.model) {
    return false;
  }
  return input.isModelLoading;
}

export function validateDraftSubmission(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  composerState: {
    providerDefinitions: unknown[];
    selectedProvider: string | null;
    isModelLoading: boolean;
    effectiveModelId: string | null;
    availableModels: unknown[];
  };
  autoSubmitConfig: WorkspaceDraftAutoSubmitConfig | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
  copy?: ProviderSelectionCopy;
}): string | null {
  const {
    text,
    allowsEmptyAutoSubmit,
    composerState,
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  } = input;
  const readiness = resolveSubmissionReadiness({
    text,
    allowsEmptyAutoSubmit,
    providerCount: composerState.providerDefinitions.length,
    selection: {
      provider: composerState.selectedProvider,
      modelId: composerState.effectiveModelId ?? "",
      availableModels: composerState.availableModels,
      isModelLoading: composerState.isModelLoading,
    },
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
    copy: input.copy,
  });
  return readiness.ok ? null : (readiness.reason ?? null);
}

export interface SoftHomeBranchContextInput {
  cwd: string | null | undefined;
  checkoutIsGit: boolean | null | undefined;
  currentBranch: string | null | undefined;
  serverId: string;
}

/**
 * Soft Home branch pill policy: same as /new — show for any cwd until checkout proves non-git.
 * @param input.cwd Working directory for git operations (path, not opaque workspace id)
 * @returns Branch switcher context, or null when hidden
 */
export function resolveSoftHomeBranchContext(input: SoftHomeBranchContextInput): {
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string;
  isGitCheckout: true;
} | null {
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  if (!cwd) {
    return null;
  }
  if (input.checkoutIsGit === false) {
    return null;
  }
  const currentBranch =
    typeof input.currentBranch === "string" && input.currentBranch.trim().length > 0
      ? input.currentBranch.trim()
      : null;
  return {
    currentBranchName: currentBranch === "HEAD" ? null : currentBranch,
    serverId: input.serverId,
    workspaceId: cwd,
    isGitCheckout: true,
  };
}
