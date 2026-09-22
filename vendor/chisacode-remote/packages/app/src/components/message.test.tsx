/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThoughtMessage } from "./thought-message";
import { getExpandableBadgeLayoutStyles } from "./message-layout";
import { stripLeadingMarkdownHorizontalRule } from "./message-markdown";

afterEach(cleanup);

vi.mock("react-native", () => ({
  Platform: {
    select: (options: Record<string, unknown>) => options.web ?? options.default,
  },
  Pressable: ({
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
    children,
    disabled,
    onPress,
    style,
    testID,
  }: {
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: { expanded?: boolean };
    children: React.ReactNode;
    disabled?: boolean;
    onPress?: () => void;
    style?: unknown;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        "aria-expanded": accessibilityState?.expanded,
        "aria-label": accessibilityLabel,
        "data-disabled": disabled,
        "data-style": JSON.stringify(style),
        "data-testid": testID,
        disabled,
        onClick: onPress,
        role: accessibilityRole,
        type: "button",
      },
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
  Text: ({
    children,
    numberOfLines: _numberOfLines,
    selectable: _selectable,
    style,
    testID,
  }: {
    children: React.ReactNode;
    numberOfLines?: number;
    selectable?: boolean;
    style?: unknown;
    testID?: string;
  }) =>
    React.createElement(
      "span",
      { "data-style": JSON.stringify(style), "data-testid": testID },
      children,
    ),
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

vi.mock("lucide-react-native", () => ({
  ChevronDown: () => React.createElement("span", { "data-testid": "chevron-down" }),
  ChevronRight: () => React.createElement("span", { "data-testid": "chevron-right" }),
}));

vi.mock("@/components/synced-loader", () => ({
  SyncedLoader: ({ color, size }: { color: string; size?: number }) =>
    React.createElement("span", {
      "data-color": color,
      "data-size": size,
      "data-testid": "synced-loader",
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
    spacing: { 1: 4, 2: 8 },
  };
  return {
    StyleSheet: {
      create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "stream.thinking") return "推理过程";
      if (key === "stream.thinkingRunning") return "正在推理";
      return key;
    },
  }),
}));

describe("ThoughtMessage", () => {
  it("expands completed reasoning by default", () => {
    render(
      <ThoughtMessage
        text={"First private step\nSecond private step"}
        status="ready"
        isLastInSequence
      />,
    );

    expect(screen.getByText("推理过程")).not.toBeNull();
    expect(screen.getByTestId("thought-pixel-dot")).not.toBeNull();
    expect(screen.queryByTestId("brain-icon")).toBeNull();
    expect(screen.queryByTestId("thought-message-preview")).toBeNull();
    expect(screen.getByTestId("thought-message-content").textContent).toBe(
      "First private step\nSecond private step",
    );

    fireEvent.click(screen.getByTestId("thought-message-toggle"));

    expect(screen.getByTestId("thought-message-preview")).not.toBeNull();
    expect(screen.queryByTestId("thought-message-content")).toBeNull();
  });

  it("can collapse completed reasoning into a one-line preview by default", () => {
    render(
      <ThoughtMessage
        text={"First private step\nSecond private step"}
        status="ready"
        defaultCollapsed
        isLastInSequence
      />,
    );

    expect(screen.getByText("推理过程")).not.toBeNull();
    expect(screen.getByTestId("thought-message-preview")).not.toBeNull();
    expect(screen.queryByTestId("thought-message-content")).toBeNull();

    fireEvent.click(screen.getByTestId("thought-message-toggle"));

    expect(screen.getByTestId("thought-message-content").textContent).toBe(
      "First private step\nSecond private step",
    );
  });

  it("uses the running label and expands reasoning while streaming", () => {
    render(<ThoughtMessage text="Still streaming" status="loading" isLastInSequence />);

    expect(screen.getByText("正在推理")).not.toBeNull();
    expect(screen.getByTestId("synced-loader").getAttribute("data-color")).toBe("#b45309");
    expect(screen.queryByTestId("thought-message-preview")).toBeNull();
    expect(screen.getByTestId("thought-message-content").textContent).toBe("Still streaming");
  });
});

describe("ExpandableBadge layout", () => {
  it("keeps expanded tool details inside the message column", () => {
    const styles = getExpandableBadgeLayoutStyles();

    expect(styles.container).not.toMatchObject({ marginHorizontal: expect.any(Number) });
    expect(styles.detailWrapper).toMatchObject({
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
    });
  });
});

describe("assistant markdown preprocessing", () => {
  it("removes a leading markdown horizontal rule before rendering assistant text", () => {
    expect(stripLeadingMarkdownHorizontalRule("---\n正式回答")).toBe("正式回答");
    expect(stripLeadingMarkdownHorizontalRule("***\n正式回答")).toBe("正式回答");
    expect(stripLeadingMarkdownHorizontalRule("___\n正式回答")).toBe("正式回答");
  });

  it("keeps horizontal rules that are not the first assistant block", () => {
    expect(stripLeadingMarkdownHorizontalRule("先说结论\n\n---\n补充")).toBe(
      "先说结论\n\n---\n补充",
    );
  });
});
