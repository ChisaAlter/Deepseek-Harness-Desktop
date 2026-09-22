type PendingNewWorkspaceAction = "chat" | "empty" | null;

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildNewWorkspaceDraftResetKey(input: {
  resetKey: string | null | undefined;
  sourceDirectory: string | null | undefined;
}) {
  return `${trimNonEmpty(input.resetKey) ?? "initial"}:${trimNonEmpty(input.sourceDirectory) ?? ""}`;
}

export function resolveNewWorkspaceDraftReset(input: {
  currentResetKey: string | null;
  resetKey: string | null | undefined;
  sourceDirectory: string | null | undefined;
  pendingAction: PendingNewWorkspaceAction;
}):
  | {
      kind: "unchanged";
      nextResetKey: string;
    }
  | {
      kind: "pending";
      nextResetKey: string;
    }
  | {
      kind: "reset";
      nextResetKey: string;
      selectedDirectory: string | null;
    } {
  const selectedDirectory = trimNonEmpty(input.sourceDirectory);
  const nextResetKey = buildNewWorkspaceDraftResetKey({
    resetKey: input.resetKey,
    sourceDirectory: selectedDirectory,
  });
  if (input.currentResetKey === nextResetKey) {
    return { kind: "unchanged", nextResetKey };
  }
  if (input.pendingAction !== null) {
    return { kind: "pending", nextResetKey };
  }
  return {
    kind: "reset",
    nextResetKey,
    selectedDirectory,
  };
}
