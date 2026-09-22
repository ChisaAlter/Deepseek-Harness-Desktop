/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-perf/jsx-no-new-object-as-prop */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── react-native mocks ────────────────────────────────────────────────────

const createElement = (
  tag: string,
  props: { children?: React.ReactNode; [key: string]: unknown },
) => {
  const { children, ...rest } = props;
  return React.createElement(tag, rest, children);
};

vi.mock("react-native", () => ({
  Platform: { select: (o: Record<string, unknown>) => o.default ?? o.web },
  StyleSheet: {
    compose: (first: unknown, second: unknown) => [first, second],
  },
  View: (p: Record<string, unknown>) => createElement("div", { ...p, "data-rn": "View" }),
  Text: (p: Record<string, unknown>) => createElement("span", { ...p, "data-rn": "Text" }),
  TextInput: (p: Record<string, unknown>) =>
    createElement("input", { ...p, "data-rn": "TextInput" }),
  TouchableOpacity: (p: Record<string, unknown>) =>
    createElement("button", { ...p, "data-rn": "TouchableOpacity", type: "button" }),
  ScrollView: (p: Record<string, unknown>) =>
    createElement("div", { ...p, "data-rn": "ScrollView" }),
}));

const { testTheme } = vi.hoisted(() => ({
  testTheme: {
    colors: {
      surface0: "#ffffff",
      border: "#e4e6ec",
      foreground: "#14171f",
      foregroundMuted: "#6f7686",
      foregroundSubtleText: "#3d4452",
      foregroundFaint: "#9aa1b0",
      destructive: "#ef4444",
      surface3: "#e2e5ec",
      accent: "#2a6cf0",
      accentForeground: "#ffffff",
      secondary: "#eef0f4",
    },
    fontWeight: {
      semibold: "600",
      medium: "500",
    },
    shadow: {
      sm: {},
    },
    borderRadius: {
      base: 8,
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(testTheme) : factory),
    compose: (first: unknown, second: unknown) => [first, second],
  },
  useUnistyles: () => ({ theme: testTheme }),
  withUnistyles: (Component: unknown) => Component,
}));

// ─── hook dependencies mock ────────────────────────────────────────────────

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    sendGenerativeUiAction: vi.fn().mockResolvedValue(undefined),
  }),
}));

afterEach(cleanup);

// ─── Imports ───────────────────────────────────────────────────────────────

import LineChart from "@/generative-ui/components/line-chart";
import BarChart from "@/generative-ui/components/bar-chart";
import DataTable from "@/generative-ui/components/data-table";
import GenerativeFormCard from "@/generative-ui/components/generative-form-card";
import { genUiRegistry } from "@/generative-ui/registry/registry";
// eslint-disable-next-line import/no-unassigned-import
import "@/generative-ui/registry/components";

// ─── Helpers ───────────────────────────────────────────────────────────────

const BASE = {
  instanceId: "test-instance",
  sendAction: vi.fn().mockResolvedValue(true),
} as const;

// ─── LineChart ─────────────────────────────────────────────────────────────

describe("LineChart component", () => {
  it("renders with title", () => {
    render(
      <LineChart
        {...BASE}
        props={{
          title: "Monthly Sales",
          xAxis: "month",
          yAxis: "amount",
          data: [
            { month: "Jan", amount: 10 },
            { month: "Feb", amount: 20 },
          ],
        }}
      />,
    );
    expect(screen.getByText("Monthly Sales")).toBeDefined();
  });

  it("shows empty message when data is empty", () => {
    render(<LineChart {...BASE} props={{ xAxis: "month", yAxis: "amount", data: [] }} />);
    expect(screen.getByText("No data")).toBeDefined();
  });

  it("renders axis labels for each data point", () => {
    const data = [
      { month: "Jan", amount: 10 },
      { month: "Feb", amount: 20 },
    ];
    render(<LineChart {...BASE} props={{ xAxis: "month", yAxis: "amount", data }} />);
    expect(screen.getByText("Jan")).toBeDefined();
    expect(screen.getByText("Feb")).toBeDefined();
  });

  it("uses custom color from props", () => {
    render(
      <LineChart
        {...BASE}
        props={{
          xAxis: "month",
          yAxis: "amount",
          data: [{ month: "Jan", amount: 5 }],
          color: "#ff0000",
        }}
      />,
    );
    expect(screen.getByText("Jan")).toBeDefined();
  });
});

// ─── BarChart ──────────────────────────────────────────────────────────────

describe("BarChart component", () => {
  it("renders title when provided", () => {
    render(
      <BarChart
        {...BASE}
        props={{
          title: "Scores",
          label: "name",
          value: "score",
          data: [{ name: "A", score: 5 }],
        }}
      />,
    );
    expect(screen.getByText("Scores")).toBeDefined();
  });

  it("renders category labels and values", () => {
    render(
      <BarChart
        {...BASE}
        props={{
          label: "name",
          value: "score",
          data: [
            { name: "Alpha", score: 10 },
            { name: "Beta", score: 25 },
          ],
        }}
      />,
    );
    expect(screen.getByText("Alpha")).toBeDefined();
    expect(screen.getByText("10")).toBeDefined();
    expect(screen.getByText("Beta")).toBeDefined();
    expect(screen.getByText("25")).toBeDefined();
  });

  it("handles empty data without crashing", () => {
    render(<BarChart {...BASE} props={{ label: "name", value: "score", data: [] }} />);
    // Just verify it renders
    expect(document.body.innerHTML).toBeDefined();
  });
});

// ─── DataTable ─────────────────────────────────────────────────────────────

describe("DataTable component", () => {
  const columns = [
    { key: "id", title: "ID" },
    { key: "name", title: "Name" },
  ];
  const rows = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ];

  it("renders title", () => {
    render(<DataTable {...BASE} props={{ title: "Users", columns, rows }} />);
    expect(screen.getByText("Users")).toBeDefined();
  });

  it("renders column headers", () => {
    render(<DataTable {...BASE} props={{ columns, rows }} />);
    expect(screen.getByText("ID")).toBeDefined();
    expect(screen.getByText("Name")).toBeDefined();
  });

  it("renders row data", () => {
    render(<DataTable {...BASE} props={{ columns, rows }} />);
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
  });

  it("shows pagination when rows exceed pageSize", () => {
    const manyRows = Array.from({ length: 15 }, (_, i) => ({
      id: i,
      name: `User ${i}`,
    }));
    render(<DataTable {...BASE} props={{ columns, rows: manyRows, pageSize: 10 }} />);
    expect(screen.getByText("Prev")).toBeDefined();
    expect(screen.getByText("Next")).toBeDefined();
    expect(screen.getByText("1 / 2")).toBeDefined();
  });

  it("hides pagination when rows fit in one page", () => {
    render(<DataTable {...BASE} props={{ columns, rows, pageSize: 10 }} />);
    expect(screen.queryByText("Prev")).toBeNull();
    expect(screen.queryByText("Next")).toBeNull();
  });

  it("handles empty rows without crashing", () => {
    render(<DataTable {...BASE} props={{ columns, rows: [] }} />);
    expect(screen.getByText("ID")).toBeDefined();
  });
});

// ─── GenerativeFormCard ────────────────────────────────────────────────────

describe("GenerativeFormCard component", () => {
  const fields = [
    { name: "email", label: "Email", type: "text" as const },
    { name: "date", label: "Date", type: "date" as const },
  ];

  it("renders title", () => {
    render(
      <GenerativeFormCard
        {...BASE}
        props={{ title: "Contact Form", fields, submitLabel: "Send" }}
      />,
    );
    expect(screen.getByText("Contact Form")).toBeDefined();
  });

  it("renders field labels and submit button", () => {
    render(<GenerativeFormCard {...BASE} props={{ fields, submitLabel: "Submit" }} />);
    expect(screen.getByText("Email")).toBeDefined();
    expect(screen.getByText("Date")).toBeDefined();
    expect(screen.getByText("Submit")).toBeDefined();
  });

  it("renders required indicator for required fields", () => {
    const requiredFields = [
      {
        name: "email",
        label: "Email",
        type: "text" as const,
        required: true,
      },
    ];
    render(
      <GenerativeFormCard {...BASE} props={{ fields: requiredFields, submitLabel: "Submit" }} />,
    );
    // The label "Email" and " *" are in separate Text elements
    expect(screen.getByText("Email")).toBeDefined();
    expect(screen.getByText("*")).toBeDefined();
  });

  it("renders select options", () => {
    const selectFields = [
      {
        name: "plan",
        label: "Plan",
        type: "select" as const,
        options: [
          { label: "Basic", value: "basic" },
          { label: "Pro", value: "pro" },
        ],
      },
    ];
    render(
      <GenerativeFormCard {...BASE} props={{ fields: selectFields, submitLabel: "Submit" }} />,
    );
    expect(screen.getByText("Plan")).toBeDefined();
    expect(screen.getByText("Basic")).toBeDefined();
    expect(screen.getByText("Pro")).toBeDefined();
  });

  it("renders without crashing with empty fields", () => {
    render(<GenerativeFormCard {...BASE} props={{ fields: [], submitLabel: "Submit" }} />);
    expect(screen.getByText("Submit")).toBeDefined();
  });
});

// ─── Registry integration ──────────────────────────────────────────────────

describe("Component registry integration", () => {
  it("all 4 MVP components are registered", () => {
    for (const id of ["line_chart", "bar_chart", "table", "form"]) {
      expect(genUiRegistry.get(id)).not.toBeNull();
    }
  });

  it("all components accept validated props without throwing", () => {
    const cases: Record<string, Record<string, unknown>> = {
      line_chart: { xAxis: "x", yAxis: "y", data: [{ x: 1, y: 2 }] },
      bar_chart: { label: "l", value: "v", data: [{ l: "A", v: 5 }] },
      table: { columns: [{ key: "id", title: "ID" }], rows: [{ id: 1 }] },
      form: { fields: [{ name: "n", label: "N", type: "text" }] },
    };
    for (const [id, props] of Object.entries(cases)) {
      expect(() => genUiRegistry.validateProps(id, props)).not.toThrow();
    }
  });
});
