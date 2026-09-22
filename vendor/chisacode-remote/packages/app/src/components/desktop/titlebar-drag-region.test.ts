import { describe, expect, it } from "vitest";
import {
  TITLEBAR_NO_DRAG_REGION_STYLE,
  TITLEBAR_NO_DRAG_VIEW_STYLE,
  TITLEBAR_TOP_RESIZER_STYLE,
} from "@/components/desktop/titlebar-drag-region";

describe("titlebar drag region styles", () => {
  it("exposes a React Native Web compatible no-drag style for interactive chrome", () => {
    expect(Reflect.get(TITLEBAR_NO_DRAG_REGION_STYLE, "WebkitAppRegion")).toBe("no-drag");
    expect(TITLEBAR_NO_DRAG_VIEW_STYLE).toBe(TITLEBAR_NO_DRAG_REGION_STYLE);
  });

  it("anchors the top resizer to the titlebar bounds", () => {
    expect(TITLEBAR_TOP_RESIZER_STYLE.left).toBe(0);
    expect(TITLEBAR_TOP_RESIZER_STYLE.width).toBe("100%");
  });
});
