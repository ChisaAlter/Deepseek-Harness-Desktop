interface DesktopSidebarToggleInput {
  isAgentListOpen: boolean;
  isFileExplorerOpen: boolean;
  openAgentList: () => void;
  closeAgentList: () => void;
  closeFileExplorer: () => void;
  toggleFocusedFileExplorer: () => boolean;
}

/**
 * Toggles desktop sidebars for the checkout shortcut intent
 * @param input Open state and panel open/close callbacks
 * @returns Always true after applying the toggle intent
 */
export function toggleDesktopSidebarsWithCheckoutIntent(input: DesktopSidebarToggleInput): boolean {
  if (input.isAgentListOpen || input.isFileExplorerOpen) {
    input.closeAgentList();
    input.closeFileExplorer();
    return true;
  }

  input.openAgentList();
  input.toggleFocusedFileExplorer();
  return true;
}
