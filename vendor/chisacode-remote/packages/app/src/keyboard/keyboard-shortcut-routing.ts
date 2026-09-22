import {
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";

export function canToggleFileExplorerShortcut(input: {
  selectedAgentId?: string;
  pathname: string;
  toggleFileExplorer?: () => void;
}): boolean {
  if (!input.toggleFileExplorer) {
    return false;
  }
  if (parseHostWorkspaceRouteFromPathname(input.pathname)) {
    return true;
  }

  if (parseHostAgentRouteFromPathname(input.pathname)) {
    return true;
  }

  return false;
}
