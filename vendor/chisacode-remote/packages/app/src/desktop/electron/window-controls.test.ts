import { describe, expect, it } from "vitest";

import {
  dimDesktopWindowControlsBackground,
  getDesktopWindowControlsBackground,
} from "./window-controls";

describe("getDesktopWindowControlsBackground", () => {
  it("prefers the Soft shell canvas over elevated surface0 white", () => {
    expect(
      getDesktopWindowControlsBackground({
        foreground: "#09090b",
        surface0: "#ffffff",
        surfaceSidebar: "#f0f1f5",
        surfaceWorkspace: "#f4f5f8",
      }),
    ).toBe("#f4f5f8");
  });

  it("dims the shell canvas to match the Soft command-center backdrop", () => {
    // #f4f5f8 blended with rgba(20, 23, 31, 0.28)
    expect(dimDesktopWindowControlsBackground("#f4f5f8")).toBe("#b5b7bb");
  });

  it("leaves non-hex backgrounds unchanged when dimming", () => {
    expect(dimDesktopWindowControlsBackground("transparent")).toBe("transparent");
  });

  it("uses the workspace color when it is an opaque shell canvas", () => {
    expect(
      getDesktopWindowControlsBackground({
        foreground: "#09090b",
        surface0: "transparent",
        surfaceSidebar: "#f4f4f5",
        surfaceWorkspace: "#ffffff",
      }),
    ).toBe("#ffffff");
  });

  it("uses the sidebar color when the workspace color is transparent", () => {
    expect(
      getDesktopWindowControlsBackground({
        foreground: "#09090b",
        surface0: "transparent",
        surfaceSidebar: "#f4f4f5",
        surfaceWorkspace: "transparent",
      }),
    ).toBe("#f4f4f5");
  });

  it("uses the opaque elevated surface when shell colors are transparent", () => {
    expect(
      getDesktopWindowControlsBackground({
        foreground: "#1d1d1f",
        surface0: "#fbfdff",
        surfaceSidebar: "rgba(255, 255, 255, 0.28)",
        surfaceWorkspace: "transparent",
      }),
    ).toBe("#fbfdff");
  });

  it("uses the opaque base canvas for transparent dark themes", () => {
    expect(
      getDesktopWindowControlsBackground({
        foreground: "#fafafa",
        surface0: "#06111f",
        surfaceSidebar: "rgba(20, 23, 22, 0.5)",
        surfaceWorkspace: "transparent",
      }),
    ).toBe("#06111f");
  });
});
