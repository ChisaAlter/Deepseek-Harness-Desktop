import { describe, expect, it } from "vitest";

import { resolveAppSurfaceBackgrounds } from "./app-surface-backgrounds";

describe("resolveAppSurfaceBackgrounds", () => {
  it("keeps all app shell layers transparent for the liquid glass backdrop", () => {
    expect(
      resolveAppSurfaceBackgrounds({
        frameEnabled: true,
        glassEnabled: true,
        surfaceWorkspace: "rgba(8, 18, 32, 0.46)",
        surface0: "#06111f",
        glassShell: "rgba(7, 14, 27, 0.3)",
        borderAccent: "rgba(99, 230, 255, 0.32)",
      }),
    ).toEqual({
      root: "transparent",
      desktopRow: "rgba(7, 14, 27, 0.3)",
      stack: "transparent",
      frameBorderWidth: 1,
      frameBorderColor: "rgba(99, 230, 255, 0.32)",
    });
  });

  it("keeps opaque theme surfaces inside the reference frame border", () => {
    expect(
      resolveAppSurfaceBackgrounds({
        frameEnabled: true,
        glassEnabled: false,
        surfaceWorkspace: "#ffffff",
        surface0: "#f8fafc",
        glassShell: "transparent",
        borderAccent: "#d7dce6",
      }),
    ).toEqual({
      root: "#ffffff",
      desktopRow: "#ffffff",
      stack: "#f8fafc",
      frameBorderWidth: 1,
      frameBorderColor: "#d7dce6",
    });
  });
  it("disables the frame outside the desktop Electron surface", () => {
    expect(
      resolveAppSurfaceBackgrounds({
        frameEnabled: false,
        glassEnabled: false,
        surfaceWorkspace: "#ffffff",
        surface0: "#f8fafc",
        glassShell: "transparent",
        borderAccent: "#d7dce6",
      }),
    ).toEqual({
      root: "#ffffff",
      desktopRow: "#ffffff",
      stack: "#f8fafc",
      frameBorderWidth: 0,
      frameBorderColor: "transparent",
    });
  });
});
