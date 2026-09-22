interface WorkbenchSurfaceRoleInput {
  glassEnabled: boolean;
  surface0: string;
  surface1: string;
  surfaceWorkspace: string;
}

interface WorkbenchThemeSurfaceInput {
  glass: { enabled: boolean };
  colors: {
    surface0: string;
    surface1: string;
    surfaceWorkspace: string;
  };
}

interface WorkbenchSurfaceRoles {
  workspace: string;
  content: string;
  chrome: string;
  pane: string;
}

const LIQUID_GLASS_WORKSPACE_SURFACE = "rgba(7, 14, 27, 0.25)";

/**
 * Resolves background roles for the compact workbench without stacking glass canvas layers.
 * @param input Theme surface values and whether Liquid Glass compositing is active
 * @returns Background colors for the workspace canvas, content, chrome, and split panes
 */
export function resolveWorkbenchSurfaceRoles(
  input: WorkbenchSurfaceRoleInput,
): WorkbenchSurfaceRoles {
  if (input.glassEnabled) {
    return {
      workspace: LIQUID_GLASS_WORKSPACE_SURFACE,
      content: "transparent",
      chrome: input.surface1,
      pane: "transparent",
    };
  }

  // Soft Workbench: one calm shell; elevated cards use surface0 at components.
  return {
    workspace: input.surfaceWorkspace,
    content: input.surfaceWorkspace,
    chrome: input.surfaceWorkspace,
    pane: input.surfaceWorkspace,
  };
}

/**
 * Resolves workbench background roles from the active Unistyles theme.
 * @param theme Theme glass and surface tokens
 * @returns Background colors for workbench layout roles
 */
export function resolveThemeWorkbenchSurfaceRoles(
  theme: WorkbenchThemeSurfaceInput,
): WorkbenchSurfaceRoles {
  return resolveWorkbenchSurfaceRoles({
    glassEnabled: theme.glass.enabled,
    surface0: theme.colors.surface0,
    surface1: theme.colors.surface1,
    surfaceWorkspace: theme.colors.surfaceWorkspace,
  });
}
