/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTurnFooterStreamItemWrapperStyle } from "./turn-footer-layout";

afterEach(cleanup);

vi.mock("react-native", () => ({
  Platform: {
    select: (options: Record<string, unknown>) => options.web ?? options.default,
  },
  Text: ({
    children,
    style,
    testID,
  }: {
    children: React.ReactNode;
    style?: unknown;
    testID?: string;
  }) =>
    React.createElement(
      "span",
      { "data-style": JSON.stringify(style), "data-testid": testID },
      children,
    ),
  Image: ({
    source: _source,
    style,
    testID,
  }: {
    source?: unknown;
    style?: unknown;
    testID?: string;
  }) => React.createElement("img", { "data-style": JSON.stringify(style), "data-testid": testID }),
  View: ({
    children,
    style,
    testID,
  }: {
    children: React.ReactNode;
    style?: unknown;
    testID?: string;
  }) =>
    React.createElement(
      "span",
      { "data-style": JSON.stringify(style), "data-testid": testID },
      children,
    ),
}));

function svgElement(tagName: string) {
  return function SvgElement({
    children,
    testID,
    ...props
  }: {
    children?: React.ReactNode;
    testID?: string;
    [key: string]: unknown;
  }) {
    return React.createElement(tagName, { ...props, "data-testid": testID }, children);
  };
}

vi.mock("react-native-svg", () => ({
  default: svgElement("svg"),
  Circle: svgElement("circle"),
  G: svgElement("g"),
  Line: svgElement("line"),
  Rect: svgElement("rect"),
}));

vi.mock("lucide-react-native", () => ({
  Brain: () => React.createElement("span", { "data-testid": "brain-icon" }),
}));

vi.mock("@/components/synced-loader", () => ({
  SyncedLoader: ({ color, size }: { color: string; size?: number }) =>
    React.createElement("span", {
      "data-color": color,
      "data-size": size,
      "data-testid": "synced-loader",
    }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("react-native-unistyles", () => {
  const theme = {
    borderRadius: { md: 6 },
    colorScheme: "light",
    colors: {
      foregroundMuted: "#71717a",
      palette: {
        amber: { 500: "#f59e0b", 700: "#b45309" },
      },
    },
    fontSize: { xs: 12 },
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
  };
  return {
    StyleSheet: {
      create: (factory: (currentTheme: unknown) => unknown) => factory(theme),
    },
    useUnistyles: () => ({ theme }),
    withUnistyles: (Component: React.ComponentType<Record<string, unknown>>) => {
      return function ThemedComponent(props: Record<string, unknown>) {
        const mapped = typeof props.uniProps === "function" ? props.uniProps(theme) : undefined;
        return <Component {...props} {...mapped} />;
      };
    },
  };
});

vi.mock("@/utils/time", () => ({
  formatDuration: () => "22s",
}));

const { RunningTurnFooter } = await import("./running-turn-footer");

describe("RunningTurnFooter", () => {
  it("uses the synced amber pixel loader for a running turn", () => {
    render(<RunningTurnFooter inFlightTurnStartedAt={new Date("2026-06-18T00:00:00.000Z")} />);

    expect(screen.getByTestId("turn-working-indicator")).not.toBeNull();
    expect(screen.getByTestId("turn-working-pixel-loader")).not.toBeNull();
    expect(screen.getByTestId("synced-loader").getAttribute("data-color")).toBe("#b45309");
    expect(screen.queryByTestId("brain-icon")).toBeNull();
    expect(screen.getByTestId("turn-working-elapsed")).not.toBeNull();
  });
});

describe("TurnFooter layout", () => {
  it("aligns running and completed footer rows with the message column", () => {
    expect(getTurnFooterStreamItemWrapperStyle(8)).toMatchObject({
      width: "100%",
      alignSelf: "stretch",
      paddingHorizontal: 8,
    });
  });
});
