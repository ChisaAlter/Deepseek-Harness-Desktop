import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  prepareWorkspaceTab as prepareWorkspaceTabPure,
  navigateToPreparedWorkspaceTab as navigateToPreparedWorkspaceTabPure,
  type PrepareWorkspaceTabInput,
  type NavigateToPreparedWorkspaceTabInput,
} from "./prepare-workspace-tab";

export type {
  PrepareWorkspaceTabInput,
  NavigateToPreparedWorkspaceTabInput,
} from "./prepare-workspace-tab";

function layoutStoreDeps() {
  const store = useWorkspaceLayoutStore.getState();
  return {
    openTarget: store.openTarget,
    pinAgent: store.pinAgent,
  };
}

/**
 * Opens (or focuses) the target workspace tab using the workspace layout store, pinning agents on request
 * @param input The workspace, tab target, and pin option to prepare
 * @returns The host workspace route for the prepared tab
 */
export function prepareWorkspaceTab(input: PrepareWorkspaceTabInput): string {
  return prepareWorkspaceTabPure(input, layoutStoreDeps());
}

/**
 * Prepares the target workspace tab via the layout store and navigates to its workspace route
 * @param input The workspace, tab target, and current route used for navigation
 * @returns The host workspace route that was navigated to
 */
export function navigateToPreparedWorkspaceTab(input: NavigateToPreparedWorkspaceTabInput): string {
  return navigateToPreparedWorkspaceTabPure(input, {
    ...layoutStoreDeps(),
    navigateToWorkspace,
  });
}
