import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusBadge } from "./status-badge";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 3: 12 },
    borderWidth: { 1: 1 },
    borderRadius: { full: 999 },
    fontSize: { xs: 11 },
    fontWeight: { normal: "400" },
    shadow: { sm: {} },
    colors: {
      border: "#666",
      foregroundMuted: "#aaa",
      statusDanger: "#ef4444",
      statusSuccess: "#22c55e",
      statusWarning: "#f59e0b",
      surfaceWorkspace: "#111",
      surface2: "#222",
    },
  },
}));

vi.mock("react-native", () => ({
  Text: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  View: ({
    accessibilityLabel,
    accessibilityRole,
    children,
    style,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    children: React.ReactNode;
    style?: unknown;
  }) =>
    React.createElement(
      "div",
      {
        "aria-label": accessibilityLabel,
        "data-style": JSON.stringify(style),
        role: accessibilityRole,
      },
      children,
    ),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
}));

describe("StatusBadge", () => {
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

  it("uses a stable fallback when the label is blank", () => {
    act(() => {
      root?.render(<StatusBadge label="   " />);
    });

    expect(container?.textContent).toBe("Status");
    expect(container?.querySelector("[role='text']")?.getAttribute("aria-label")).toBe("Status");
  });

  it("allows a custom accessibility label", () => {
    act(() => {
      root?.render(<StatusBadge label="PR open" accessibilityLabel="Pull request open" />);
    });

    expect(container?.textContent).toBe("PR open");
    expect(container?.querySelector("[role='text']")?.getAttribute("aria-label")).toBe(
      "Pull request open",
    );
  });

  it("falls back to the visible label when a custom accessibility label is blank", () => {
    act(() => {
      root?.render(<StatusBadge label="Checks pending" accessibilityLabel="   " />);
    });

    expect(container?.textContent).toBe("Checks pending");
    expect(container?.querySelector("[role='text']")?.getAttribute("aria-label")).toBe(
      "Checks pending",
    );
  });

  it("falls back to muted styling for invalid runtime variants", () => {
    act(() => {
      root?.render(<StatusBadge label="Unknown" variant={"danger" as never} />);
    });

    const style = container?.querySelector("[role='text']")?.getAttribute("data-style") ?? "";
    expect(style).toContain(theme.colors.border);
    expect(style).not.toContain(theme.colors.statusDanger);
  });
});
