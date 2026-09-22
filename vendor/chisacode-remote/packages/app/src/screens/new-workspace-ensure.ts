import { normalizeCheckoutCwd } from "@/git/query-keys";

export type NewWorkspaceSendOpenPlan =
  | { mode: "reuse-open"; workspaceId: string }
  | { mode: "open-existing" };

export function planNewWorkspaceSendOpen(input: {
  cwd: string;
  openWorkspaces: ReadonlyArray<{ id: string; workspaceDirectory: string | null }>;
}): NewWorkspaceSendOpenPlan {
  const cwd = normalizeCheckoutCwd(input.cwd);
  const existing = input.openWorkspaces.find((workspace) => {
    if (!workspace.workspaceDirectory) {
      return false;
    }
    return normalizeCheckoutCwd(workspace.workspaceDirectory) === cwd;
  });
  if (existing) {
    return { mode: "reuse-open", workspaceId: existing.id };
  }
  return { mode: "open-existing" };
}
