export function shouldSeedEmptyWorkspaceDraft(input: {
  isRouteFocused: boolean;
  hasPersistenceKey: boolean;
  hasWorkspaceDirectory: boolean;
  hasHydratedWorkspaceLayoutStore: boolean;
  hasHydratedAgents: boolean;
  hasLoadedTerminals: boolean;
  hasConsideredEmptyWorkspaceDraftSeed: boolean;
  activeAgentCount: number;
  terminalCount: number;
  hasActiveTarget: boolean;
}): boolean {
  if (
    !input.isRouteFocused ||
    !input.hasPersistenceKey ||
    !input.hasWorkspaceDirectory ||
    !input.hasHydratedWorkspaceLayoutStore ||
    !input.hasHydratedAgents ||
    !input.hasLoadedTerminals ||
    input.hasConsideredEmptyWorkspaceDraftSeed
  ) {
    return false;
  }

  return input.terminalCount === 0 && !input.hasActiveTarget;
}
