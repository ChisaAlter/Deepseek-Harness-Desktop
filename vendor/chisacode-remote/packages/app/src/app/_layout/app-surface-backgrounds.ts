interface AppSurfaceBackgroundInput {
  frameEnabled: boolean;
  glassEnabled: boolean;
  surfaceWorkspace: string;
  surface0: string;
  glassShell: string;
  borderAccent: string;
}

interface AppSurfaceBackgrounds {
  root: string;
  desktopRow: string;
  stack: string;
  frameBorderWidth: number;
  frameBorderColor: string;
}

/**
 * Resolves shell layers that sit above the global theme backdrop.
 * @param input Theme surface tokens and whether the glass backdrop is active
 * @returns Background colors for the root, desktop row, and navigation stack
 */
export function resolveAppSurfaceBackgrounds(
  input: AppSurfaceBackgroundInput,
): AppSurfaceBackgrounds {
  // Soft Workbench: frame uses quiet border token, not dense borderAccent chrome.
  const frame = input.frameEnabled
    ? { frameBorderWidth: 1, frameBorderColor: input.borderAccent }
    : { frameBorderWidth: 0, frameBorderColor: "transparent" };

  if (input.glassEnabled) {
    return {
      root: "transparent",
      desktopRow: input.glassShell,
      stack: "transparent",
      ...frame,
    };
  }

  return {
    root: input.surfaceWorkspace,
    desktopRow: input.surfaceWorkspace,
    stack: input.surface0,
    ...frame,
  };
}
