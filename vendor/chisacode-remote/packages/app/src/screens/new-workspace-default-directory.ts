interface NewWorkspaceDefaultDirectoryWorkspace {
  projectRootPath?: string | null;
  workspaceDirectory?: string | null;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveNewWorkspaceDefaultDirectory(input: {
  routeDirectory: string | null | undefined;
  activeWorkspace: NewWorkspaceDefaultDirectoryWorkspace | null | undefined;
  lastDraftDirectory?: string | null | undefined;
}): string | null {
  return (
    trimNonEmpty(input.routeDirectory) ??
    trimNonEmpty(input.lastDraftDirectory) ??
    trimNonEmpty(input.activeWorkspace?.projectRootPath) ??
    trimNonEmpty(input.activeWorkspace?.workspaceDirectory)
  );
}
