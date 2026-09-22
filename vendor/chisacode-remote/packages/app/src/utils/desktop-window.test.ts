import { describe, expect, it } from "vitest";
import { resolveWindowControlsPadding } from "@/utils/desktop-window";

const rawPadding = {
  left: 80,
  right: 48,
  top: 28,
};

describe("resolveWindowControlsPadding", () => {
  it("applies raw window-control padding only to the titlebar", () => {
    expect(
      resolveWindowControlsPadding({
        role: "titlebar",
        rawPadding,
        sidebarClosed: false,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual(rawPadding);
  });

  it("keeps the settings sidebar in the content row", () => {
    expect(
      resolveWindowControlsPadding({
        role: "sidebar",
        rawPadding,
        sidebarClosed: false,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("keeps the main header in the content row when the sidebar is closed", () => {
    expect(
      resolveWindowControlsPadding({
        role: "header",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("keeps detail headers in the content row when the sidebar is closed", () => {
    expect(
      resolveWindowControlsPadding({
        role: "detailHeader",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("keeps desktop workspace tab rows in the content row", () => {
    expect(
      resolveWindowControlsPadding({
        role: "tabRow",
        rawPadding,
        sidebarClosed: false,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("keeps tab rows in the content row in focus mode", () => {
    expect(
      resolveWindowControlsPadding({
        role: "tabRow",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: true,
      }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("keeps the explorer sidebar in the content row", () => {
    expect(
      resolveWindowControlsPadding({
        role: "explorerSidebar",
        rawPadding,
        sidebarClosed: false,
        explorerOpen: true,
        focusModeEnabled: false,
      }),
    ).toEqual({
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("does not expose a caption-sharing role for the right panel", () => {
    expect(
      resolveWindowControlsPadding({
        role: "titlebar",
        rawPadding,
        sidebarClosed: false,
        explorerOpen: false,
        focusModeEnabled: false,
      }),
    ).toEqual(rawPadding);

    const roles = ["sidebar", "header", "detailHeader", "tabRow", "explorerSidebar"] as const;
    for (const role of roles) {
      expect(
        resolveWindowControlsPadding({
          role,
          rawPadding,
          sidebarClosed: false,
          explorerOpen: true,
          focusModeEnabled: false,
        }),
      ).toEqual({ left: 0, right: 0, top: 0 });
    }
  });
});
