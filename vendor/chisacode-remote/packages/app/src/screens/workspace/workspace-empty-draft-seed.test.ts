import { describe, expect, it } from "vitest";
import { shouldSeedEmptyWorkspaceDraft } from "./workspace-empty-draft-seed";

const readyEmptyWorkspace = {
  isRouteFocused: true,
  hasPersistenceKey: true,
  hasWorkspaceDirectory: true,
  hasHydratedWorkspaceLayoutStore: true,
  hasHydratedAgents: true,
  hasLoadedTerminals: true,
  hasConsideredEmptyWorkspaceDraftSeed: false,
  activeAgentCount: 0,
  terminalCount: 0,
  hasActiveTarget: false,
};

describe("shouldSeedEmptyWorkspaceDraft", () => {
  it("waits for refresh-time hydration before seeding a draft", () => {
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        hasHydratedWorkspaceLayoutStore: false,
      }),
    ).toBe(false);
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        hasHydratedAgents: false,
      }),
    ).toBe(false);
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        hasLoadedTerminals: false,
      }),
    ).toBe(false);
  });

  it("seeds when historical agents exist but the workspace shows no content", () => {
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        activeAgentCount: 1,
      }),
    ).toBe(true);
  });

  it("does not seed when terminals or active content are known", () => {
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        terminalCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        hasActiveTarget: true,
      }),
    ).toBe(false);
  });

  it("seeds once an empty focused workspace is fully known", () => {
    expect(shouldSeedEmptyWorkspaceDraft(readyEmptyWorkspace)).toBe(true);
  });

  it("does not seed again once empty workspace seeding was already considered", () => {
    const alreadyConsideredWorkspace = {
      ...readyEmptyWorkspace,
      hasConsideredEmptyWorkspaceDraftSeed: true,
    };

    expect(shouldSeedEmptyWorkspaceDraft(alreadyConsideredWorkspace)).toBe(false);
  });
});
