import { describe, expect, it } from "vitest";
import {
  DESKTOP_SIDEBAR_CONTROL_CONTENT_GAP,
  DESKTOP_SIDEBAR_CONTROL_EDGE_INSET,
  DESKTOP_SIDEBAR_CONTROL_SIZE,
  resolveDesktopSidebarControlLayout,
  resolveDesktopSidebarControlOverlayPad,
  resolveDesktopSidebarControlTrafficLightLeft,
} from "./desktop-sidebar-control-layout";

describe("resolveDesktopSidebarControlLayout", () => {
  it("places the control at Soft nav-top inset when the sidebar is visible", () => {
    expect(
      resolveDesktopSidebarControlLayout({
        isSidebarVisible: true,
        trafficLightLeft: 0,
        titlebarTop: 48,
      }),
    ).toEqual({
      controlInsets: {
        left: DESKTOP_SIDEBAR_CONTROL_EDGE_INSET,
        // Must match desktopSidebarTopArea.paddingTop (not (48-32)/2=8).
        top: 12,
      },
      contentLeftPad: 0,
    });
  });

  it("reserves content clearance when the sidebar is collapsed", () => {
    const layout = resolveDesktopSidebarControlLayout({
      isSidebarVisible: false,
      trafficLightLeft: 0,
      titlebarTop: 48,
    });
    expect(layout.controlInsets).toEqual({
      left: DESKTOP_SIDEBAR_CONTROL_EDGE_INSET,
      top: 12,
    });
    expect(layout.contentLeftPad).toBe(
      DESKTOP_SIDEBAR_CONTROL_EDGE_INSET +
        DESKTOP_SIDEBAR_CONTROL_SIZE +
        DESKTOP_SIDEBAR_CONTROL_CONTENT_GAP,
    );
  });

  it("sits after mac traffic lights and still clears content when collapsed", () => {
    const layout = resolveDesktopSidebarControlLayout({
      isSidebarVisible: false,
      trafficLightLeft: 78,
      titlebarTop: 45,
    });
    expect(layout.controlInsets.left).toBe(78);
    expect(layout.controlInsets.top).toBe(12);
    expect(layout.contentLeftPad).toBe(
      78 + DESKTOP_SIDEBAR_CONTROL_SIZE + DESKTOP_SIDEBAR_CONTROL_CONTENT_GAP,
    );
  });
});

describe("resolveDesktopSidebarControlTrafficLightLeft", () => {
  it("only reserves traffic lights on Electron macOS outside fullscreen", () => {
    expect(
      resolveDesktopSidebarControlTrafficLightLeft({
        isElectron: true,
        isMac: true,
        isFullscreen: false,
      }),
    ).toBe(78);
    expect(
      resolveDesktopSidebarControlTrafficLightLeft({
        isElectron: true,
        isMac: true,
        isFullscreen: true,
      }),
    ).toBe(0);
    expect(
      resolveDesktopSidebarControlTrafficLightLeft({
        isElectron: true,
        isMac: false,
        isFullscreen: false,
      }),
    ).toBe(0);
    expect(
      resolveDesktopSidebarControlTrafficLightLeft({
        isElectron: false,
        isMac: true,
        isFullscreen: false,
      }),
    ).toBe(0);
  });
});

describe("resolveDesktopSidebarControlOverlayPad", () => {
  it("clears the fixed control for open-rail chrome", () => {
    expect(resolveDesktopSidebarControlOverlayPad(0)).toBe(
      DESKTOP_SIDEBAR_CONTROL_EDGE_INSET +
        DESKTOP_SIDEBAR_CONTROL_SIZE +
        DESKTOP_SIDEBAR_CONTROL_CONTENT_GAP,
    );
    expect(resolveDesktopSidebarControlOverlayPad(78)).toBe(
      78 + DESKTOP_SIDEBAR_CONTROL_SIZE + DESKTOP_SIDEBAR_CONTROL_CONTENT_GAP,
    );
  });
});
