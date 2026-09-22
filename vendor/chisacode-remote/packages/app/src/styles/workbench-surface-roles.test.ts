import { describe, expect, it } from "vitest";

import { resolveWorkbenchSurfaceRoles } from "./workbench-surface-roles";

describe("resolveWorkbenchSurfaceRoles", () => {
  it("maps Liquid Glass to one canvas layer with transparent content and glass chrome", () => {
    expect(
      resolveWorkbenchSurfaceRoles({
        glassEnabled: true,
        surface0: "#06111f",
        surface1: "rgba(255, 255, 255, 0.09)",
        surfaceWorkspace: "rgba(8, 18, 32, 0.46)",
      }),
    ).toEqual({
      workspace: "rgba(7, 14, 27, 0.25)",
      content: "transparent",
      chrome: "rgba(255, 255, 255, 0.09)",
      pane: "transparent",
    });
  });

  it("maps opaque Soft Workbench surfaces to one calm shell", () => {
    expect(
      resolveWorkbenchSurfaceRoles({
        glassEnabled: false,
        surface0: "#090b11",
        surface1: "#121722",
        surfaceWorkspace: "#0f1219",
      }),
    ).toEqual({
      workspace: "#0f1219",
      content: "#0f1219",
      chrome: "#0f1219",
      pane: "#0f1219",
    });
  });
});
