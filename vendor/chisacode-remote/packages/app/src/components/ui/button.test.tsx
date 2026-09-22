import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
    borderRadius: { xl: 12 },
    fontSize: { xs: 11, sm: 13 },
    fontWeight: { normal: "400" },
    opacity: { 50: 0.5 },
    shadow: { sm: {} },
    colors: {
      accent: "#0a84ff",
      accentForeground: "#fff",
      borderAccent: "#666",
      border: "#555",
      destructive: "#ef4444",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      palette: { white: "#fff" },
      surface0: "#222",
      surface1: "#111",
      surface2: "#222",
      surfaceWorkspace: "#111",
    },
  },
}));

vi.mock("react-native", () => ({
  ActivityIndicator: ({ color }: { color?: string }) =>
    React.createElement("span", { "data-color": color, "data-testid": "spinner" }),
  Pressable: ({
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
    children,
    disabled,
    onPress,
    style,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: { busy?: boolean; disabled?: boolean };
    children: React.ReactNode;
    disabled?: boolean;
    onPress?: () => void;
    style?: unknown;
  }) =>
    React.createElement(
      "button",
      {
        "aria-busy": accessibilityState?.busy,
        "aria-disabled": accessibilityState?.disabled,
        "aria-label": accessibilityLabel,
        "data-style": JSON.stringify(
          typeof style === "function" ? style({ pressed: false }) : style,
        ),
        "data-disabled": disabled,
        onClick: onPress,
        role: accessibilityRole,
        type: "button",
      },
      children,
    ),
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
  View: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: unknown) => Component,
}));

describe("Button", () => {
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

  it("uses text children as the default accessibility label", () => {
    act(() => {
      root?.render(<Button>Open changes</Button>);
    });

    expect(container?.querySelector("button")?.getAttribute("aria-label")).toBe("Open changes");
  });

  it("trims generated accessibility labels and ignores blank text", () => {
    act(() => {
      root?.render(<Button>{"  Save  "}</Button>);
    });

    expect(container?.querySelector("button")?.getAttribute("aria-label")).toBe("Save");

    act(() => {
      root?.render(<Button>{"   "}</Button>);
    });

    expect(container?.querySelector("button")?.getAttribute("aria-label")).toBeNull();
  });

  it("does not override an explicit accessibility label", () => {
    act(() => {
      root?.render(<Button accessibilityLabel="Open workspace changes">Changes</Button>);
    });

    expect(container?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Open workspace changes",
    );
  });

  it("falls back to generated labels when an explicit accessibility label is blank", () => {
    act(() => {
      root?.render(<Button accessibilityLabel="   ">Open changes</Button>);
    });

    expect(container?.querySelector("button")?.getAttribute("aria-label")).toBe("Open changes");
  });

  it("marks loading buttons as busy and disabled", () => {
    act(() => {
      root?.render(<Button loading>Save</Button>);
    });

    const button = container?.querySelector("button");
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("data-disabled")).toBe("true");
    expect(container?.querySelector("[data-testid='spinner']")).not.toBeNull();
  });

  it("falls back to safe styles for invalid runtime variants and sizes", () => {
    act(() => {
      root?.render(
        <Button variant={"danger" as never} size={"huge" as never}>
          Run
        </Button>,
      );
    });

    const style = container?.querySelector("button")?.getAttribute("data-style") ?? "";
    expect(style).toContain(theme.colors.surface2);
    expect(style).toContain(String(theme.spacing[3]));
    expect(style).not.toContain(theme.colors.destructive);
  });
});
