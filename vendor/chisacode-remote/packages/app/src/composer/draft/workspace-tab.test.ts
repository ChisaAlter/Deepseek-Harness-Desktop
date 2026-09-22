import { describe, expect, test } from "vitest";

import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import {
  AUTO_SUBMIT_READINESS_WATCHDOG_MS,
  resolveSoftHomeBranchContext,
  shouldRestorePendingAutoSubmit,
  shouldWaitForDraftModelReadiness,
  validateDraftSubmission,
} from "./workspace-tab-core";

const baseComposerState = {
  providerDefinitions: [{ id: "deepseek-tui" }],
  selectedProvider: "deepseek-tui",
  isModelLoading: false,
  effectiveModelId: "",
  availableModels: [],
};

function validate(overrides = {}) {
  return validateDraftSubmission({
    text: "hello",
    allowsEmptyAutoSubmit: false,
    composerState: baseComposerState,
    autoSubmitConfig: null,
    workspaceDirectory: "/tmp/project",
    hasClient: true,
    ...overrides,
  });
}

describe("workspace draft agent model validation", () => {
  test("allows a ready provider with no models to submit without a selected model", () => {
    expect(validate({})).toBeNull();
  });

  test("keeps waiting while model defaults are loading", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          isModelLoading: true,
        },
      }),
    ).toBe("Model defaults are still loading");
  });

  test("allows auto submit with an explicit model while model defaults are loading", () => {
    expect(
      validate({
        allowsEmptyAutoSubmit: true,
        text: "",
        autoSubmitConfig: { provider: "codex", model: "mimo-v2.5" },
        composerState: {
          ...baseComposerState,
          selectedProvider: "codex",
          isModelLoading: true,
          effectiveModelId: "",
          availableModels: [],
        },
      }),
    ).toBeNull();
  });

  test("does not block pending auto submit when the queued config has an explicit model", () => {
    expect(
      shouldWaitForDraftModelReadiness({
        autoSubmitConfig: { provider: "codex", model: "mimo-v2.5" },
        isModelLoading: true,
      }),
    ).toBe(false);
  });

  test("does not wait for provider snapshot when grokbuild already has a model", () => {
    expect(
      shouldWaitForDraftModelReadiness({
        autoSubmitConfig: { provider: "grokbuild", model: "grok-4.6" },
        isModelLoading: true,
      }),
    ).toBe(false);
  });

  test("still requires a selected model when the provider exposes models", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          availableModels: [{ id: "deepseek/deepseek-v4-pro" }],
        },
      }),
    ).toBe("No model is available for the selected provider");
  });

  test("keeps agent provider separate from runtime provider in create config", () => {
    expect(
      buildWorkspaceDraftAgentConfig({
        provider: "claude",
        runtimeProvider: "deepseek-claude",
        cwd: "/tmp/project",
        model: "deepseek-r1",
      } as Parameters<typeof buildWorkspaceDraftAgentConfig>[0] & { runtimeProvider: string }),
    ).toMatchObject({
      provider: "claude",
      runtimeProvider: "deepseek-claude",
      model: "deepseek-r1",
    });
  });
});

describe("resolveSoftHomeBranchContext", () => {
  test("hides the branch pill without a cwd", () => {
    expect(
      resolveSoftHomeBranchContext({
        cwd: null,
        checkoutIsGit: true,
        currentBranch: "main",
        serverId: "local",
      }),
    ).toBeNull();
  });

  test("hides the branch pill when checkout proves non-git", () => {
    expect(
      resolveSoftHomeBranchContext({
        cwd: "/repo",
        checkoutIsGit: false,
        currentBranch: null,
        serverId: "local",
      }),
    ).toBeNull();
  });

  test("shows a branch pill while checkout is still unknown", () => {
    expect(
      resolveSoftHomeBranchContext({
        cwd: "/repo",
        checkoutIsGit: undefined,
        currentBranch: null,
        serverId: "local",
      }),
    ).toEqual({
      currentBranchName: null,
      serverId: "local",
      workspaceId: "/repo",
      isGitCheckout: true,
    });
  });

  test("uses the real cwd as BranchSwitcher workspaceId", () => {
    expect(
      resolveSoftHomeBranchContext({
        cwd: "  /repo/worktree  ",
        checkoutIsGit: true,
        currentBranch: "feature",
        serverId: "server-1",
      }),
    ).toEqual({
      currentBranchName: "feature",
      serverId: "server-1",
      workspaceId: "/repo/worktree",
      isGitCheckout: true,
    });
  });
});

describe("shouldRestorePendingAutoSubmit", () => {
  test("restores once the readiness wait exceeds the threshold", () => {
    expect(
      shouldRestorePendingAutoSubmit({
        hasPending: true,
        isReady: false,
        sendStarted: false,
        waitedForMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS,
        thresholdMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS,
      }),
    ).toBe(true);
  });

  test("keeps waiting before the threshold", () => {
    expect(
      shouldRestorePendingAutoSubmit({
        hasPending: true,
        isReady: false,
        sendStarted: false,
        waitedForMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS - 1,
        thresholdMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS,
      }),
    ).toBe(false);
  });

  test("never restores while the gates are satisfied", () => {
    expect(
      shouldRestorePendingAutoSubmit({
        hasPending: true,
        isReady: true,
        sendStarted: false,
        waitedForMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS * 2,
        thresholdMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS,
      }),
    ).toBe(false);
  });

  test("never restores after the send already started", () => {
    expect(
      shouldRestorePendingAutoSubmit({
        hasPending: true,
        isReady: false,
        sendStarted: true,
        waitedForMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS * 2,
        thresholdMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS,
      }),
    ).toBe(false);
  });

  test("never restores when no submission is pending", () => {
    expect(
      shouldRestorePendingAutoSubmit({
        hasPending: false,
        isReady: false,
        sendStarted: false,
        waitedForMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS * 2,
        thresholdMs: AUTO_SUBMIT_READINESS_WATCHDOG_MS,
      }),
    ).toBe(false);
  });
});
