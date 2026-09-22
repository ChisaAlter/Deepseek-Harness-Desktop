import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuItem } from "./dropdown-menu";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12 },
    borderWidth: { 1: 1 },
    borderRadius: { lg: 8 },
    fontSize: { xs: 11, sm: 13 },
    fontWeight: { normal: "400", medium: "500" },
    shadow: { md: {} },
    colors: {
      accent: "#0a84ff",
      accentForeground: "#fff",
      border: "#333",
      borderAccent: "#666",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      palette: {
        green: { 500: "#22c55e" },
        red: { 400: "#f87171" },
      },
      statusSuccess: "#22c55e",
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
    },
  },
}));

vi.mock("react-native", () => ({
  ActivityIndicator: () => React.createElement("span", { "data-testid": "spinner" }),
  Dimensions: { get: () => ({ width: 1024, height: 768 }) },
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Platform: { OS: "web" },
  Pressable: ({
    accessibilityRole,
    accessibilityState,
    children,
    disabled,
    onPress,
    testID,
  }: {
    accessibilityRole?: string;
    accessibilityState?: { busy?: boolean; disabled?: boolean; selected?: boolean };
    children:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    disabled?: boolean;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        "aria-busy": accessibilityState?.busy,
        "aria-disabled": accessibilityState?.disabled,
        "aria-selected": accessibilityState?.selected,
        "data-disabled": disabled,
        "data-testid": testID,
        onClick: disabled ? undefined : onPress,
        role: accessibilityRole,
        type: "button",
      },
      typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
    ),
  StatusBar: { currentHeight: 0 },
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-native-reanimated", () => ({
  Keyframe: class {
    duration() {
      return this;
    }
    withCallback() {
      return this;
    }
  },
  runOnJS: (fn: () => void) => fn,
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("lucide-react-native", () => ({
  Check: () => <span data-testid="check" />,
  CheckCircle: () => <span data-testid="check-circle" />,
}));

vi.mock("@/components/ui/floating", () => ({
  FloatingScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FloatingSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/hooks/use-web-scrollbar-style", () => ({
  useWebScrollbarStyle: () => null,
}));

describe("DropdownMenuItem", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("navigator", dom.window.navigator);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  it("exposes disabled, busy, and selected accessibility state", () => {
    act(() => {
      root?.render(
        <DropdownMenu>
          <DropdownMenuItem testID="item" status="pending" selected>
            Archive
          </DropdownMenuItem>
        </DropdownMenu>,
      );
    });

    const item = container?.querySelector("[data-testid='item']");
    expect(item?.getAttribute("aria-busy")).toBe("true");
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    expect(item?.getAttribute("aria-selected")).toBe("true");
    expect(item?.getAttribute("data-disabled")).toBe("true");
  });
});
