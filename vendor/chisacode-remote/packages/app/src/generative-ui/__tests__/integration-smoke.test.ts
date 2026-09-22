/**
 * Integration smoke test: verifies the full generative UI data pipeline.
 * Protocol → Stream Reducer → Registry → Render logic (no DOM)
 */
import { describe, expect, it } from "vitest";
import { reduceStreamUpdate } from "@/types/stream";
import type { AgentStreamEventPayload } from "@chisacode/protocol/messages";
import { genUiRegistry } from "@/generative-ui/registry/registry";

// Ensure MVP components are registered
// eslint-disable-next-line import/no-unassigned-import
import "@/generative-ui/registry/components";

describe("Generative UI integration smoke", () => {
  it("reduces generative_ui timeline event to GenerativeUiItem", () => {
    const event: AgentStreamEventPayload = {
      type: "timeline",
      provider: "test-provider",
      item: {
        type: "generative_ui",
        instanceId: "inst-1",
        componentId: "line_chart",
        props: { xAxis: "month", yAxis: "amount", data: [] },
        title: "Test Chart",
        source: "tool_call",
        status: "rendering",
      },
    };

    const state = reduceStreamUpdate([], event, new Date());

    expect(state).toHaveLength(1);
    const item = state[0];
    expect(item.kind).toBe("generative_ui");
    expect(item).toMatchObject({
      instanceId: "inst-1",
      componentId: "line_chart",
      title: "Test Chart",
      source: "tool_call",
      status: "rendering",
    });
  });

  it("updates generative_ui props on generative_ui_update event", () => {
    // First create the item
    const createEvent: AgentStreamEventPayload = {
      type: "timeline",
      provider: "test-provider",
      item: {
        type: "generative_ui",
        instanceId: "inst-2",
        componentId: "bar_chart",
        props: { label: "category", value: "count", data: [] },
        source: "tool_call",
        status: "rendering",
      },
    };
    const state = reduceStreamUpdate([], createEvent, new Date());

    // Then update it
    const updateEvent: AgentStreamEventPayload = {
      type: "generative_ui_update",
      instanceId: "inst-2",
      props: { color: "red" },
      status: "interactive",
    };
    const updated = reduceStreamUpdate(state, updateEvent, new Date());

    const item = updated[0];
    expect(item.kind).toBe("generative_ui");
    if (item.kind === "generative_ui") {
      expect(item.props).toMatchObject({ color: "red" });
      expect(item.status).toBe("interactive");
    }
  });

  it("marks generative_ui as error on generative_ui_remove event", () => {
    const createEvent: AgentStreamEventPayload = {
      type: "timeline",
      provider: "test-provider",
      item: {
        type: "generative_ui",
        instanceId: "inst-3",
        componentId: "table",
        props: { columns: [], rows: [] },
        source: "tool_call",
        status: "interactive",
      },
    };
    const state = reduceStreamUpdate([], createEvent, new Date());

    const removeEvent: AgentStreamEventPayload = {
      type: "generative_ui_remove",
      instanceId: "inst-3",
    };
    const removed = reduceStreamUpdate(state, removeEvent, new Date());

    const item = removed[0];
    expect(item.kind).toBe("generative_ui");
    if (item.kind === "generative_ui") {
      expect(item.status).toBe("error"); // removed expressed as error status
    }
  });

  it("registry contains all 4 MVP components", () => {
    expect(genUiRegistry.get("line_chart")).not.toBeNull();
    expect(genUiRegistry.get("bar_chart")).not.toBeNull();
    expect(genUiRegistry.get("table")).not.toBeNull();
    expect(genUiRegistry.get("form")).not.toBeNull();
  });

  it("MVP components pass schema validation", () => {
    // line_chart
    expect(() =>
      genUiRegistry.validateProps("line_chart", {
        xAxis: "date",
        yAxis: "count",
        data: [{ date: "Jan", count: 10 }],
      }),
    ).not.toThrow();

    // bar_chart
    expect(() =>
      genUiRegistry.validateProps("bar_chart", {
        label: "name",
        value: "score",
        data: [{ name: "A", score: 5 }],
      }),
    ).not.toThrow();

    // table
    expect(() =>
      genUiRegistry.validateProps("table", {
        columns: [{ key: "id", title: "ID" }],
        rows: [{ id: 1 }],
      }),
    ).not.toThrow();

    // form
    expect(() =>
      genUiRegistry.validateProps("form", {
        fields: [{ name: "email", label: "Email", type: "text" }],
      }),
    ).not.toThrow();
  });

  it("rejects invalid props for MVP components", () => {
    // line_chart requires xAxis (string)
    expect(() =>
      genUiRegistry.validateProps("line_chart", {
        yAxis: "count",
        data: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "PROPS_VALIDATION" }));

    // bar_chart requires label and value (strings)
    expect(() =>
      genUiRegistry.validateProps("bar_chart", {
        label: "name",
        data: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "PROPS_VALIDATION" }));

    // table requires rows property
    expect(() =>
      genUiRegistry.validateProps("table", {
        columns: [{ key: "id", title: "ID" }],
        // rows is missing
      }),
    ).toThrowError(expect.objectContaining({ code: "PROPS_VALIDATION" }));

    // bar_chart requires value (string) but we pass a number
    expect(() =>
      genUiRegistry.validateProps("bar_chart", {
        label: "name",
        value: 123, // should be string
        data: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "PROPS_VALIDATION" }));
  });
});
