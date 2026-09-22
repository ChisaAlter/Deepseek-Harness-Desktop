import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";

/** Flattened project row that links directly to its single workspace */
export interface SidebarProjectWorkspaceLinkRowModel {
  kind: "workspace_link";
  workspace: SidebarWorkspaceEntry;
  chevron: null;
  trailingAction: "new_worktree" | "none";
}

/** Expandable project section row shown when a project has multiple workspaces */
export interface SidebarProjectSectionRowModel {
  kind: "project_section";
  chevron: "expand" | "collapse" | null;
  trailingAction: "new_worktree" | "none";
}

/** Discriminated row model for rendering a project entry in the left sidebar */
export type SidebarProjectRowModel =
  | SidebarProjectWorkspaceLinkRowModel
  | SidebarProjectSectionRowModel;

/**
 * Whether a project should render as a single workspace link instead of a section
 * @param project The sidebar project entry to evaluate
 * @returns True when the project has one workspace and is not a multi-worktree git project
 */
export function isSidebarProjectFlattened(project: SidebarProjectEntry): boolean {
  if (project.workspaces.length !== 1) {
    return false;
  }

  if (project.projectKind !== "git") {
    return true;
  }

  return project.workspaces[0]?.workspaceKind === "local_checkout";
}

/**
 * Builds the left-sidebar row presentation for a project entry
 * @param input The project and whether its section is currently collapsed
 * @returns A workspace link model when flattened, otherwise a section model with chevron state
 */
export function buildSidebarProjectRowModel(input: {
  project: SidebarProjectEntry;
  collapsed: boolean;
}): SidebarProjectRowModel {
  const flattenedWorkspace = isSidebarProjectFlattened(input.project)
    ? (input.project.workspaces[0] ?? null)
    : null;

  if (flattenedWorkspace) {
    return {
      kind: "workspace_link",
      workspace: flattenedWorkspace,
      chevron: null,
      trailingAction: input.project.projectKind === "git" ? "new_worktree" : "none",
    };
  }

  const collapsible = input.project.projectKind === "git" || input.project.workspaces.length > 1;

  let chevron: "expand" | "collapse" | null;
  if (!collapsible) chevron = null;
  else if (input.collapsed) chevron = "expand";
  else chevron = "collapse";

  return {
    kind: "project_section",
    chevron,
    trailingAction: input.project.projectKind === "git" ? "new_worktree" : "none",
  };
}
