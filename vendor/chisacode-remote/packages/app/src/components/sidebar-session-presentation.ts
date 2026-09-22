export interface SidebarSessionGroupPresentation {
  showCollapseIndicator: boolean;
  showWorkspaceIcon: boolean;
  showAddButton: boolean;
  variant: "default" | "workbench";
}

export function resolveSidebarSessionGroupPresentation(
  isCompact: boolean,
): SidebarSessionGroupPresentation {
  if (isCompact) {
    return {
      showCollapseIndicator: true,
      showWorkspaceIcon: true,
      showAddButton: true,
      variant: "default",
    };
  }
  return {
    showCollapseIndicator: false,
    showWorkspaceIcon: true,
    showAddButton: false,
    variant: "workbench",
  };
}
