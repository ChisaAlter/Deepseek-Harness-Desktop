import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { genUiRegistry } from "./registry";
import type { GenerativeUiComponentEntry } from "./types";

function makeEntry(overrides?: Partial<GenerativeUiComponentEntry>): GenerativeUiComponentEntry {
  return {
    component: () => null,
    category: "chart",
    propsSchema: z.object({
      title: z.string().optional(),
      data: z.array(z.record(z.unknown())),
    }),
    description: "Test component",
    ...overrides,
  };
}

describe("GenerativeUiRegistry", () => {
  beforeEach(() => {
    genUiRegistry.clear();
  });
  it("returns null for unknown component", () => {
    expect(genUiRegistry.get("nonexistent")).toBeNull();
  });

  it("registers and retrieves a component", () => {
    const entry = makeEntry();
    genUiRegistry.register("test_chart", entry);
    expect(genUiRegistry.get("test_chart")).toBe(entry);
  });

  it("overwrites on duplicate registration", () => {
    const entry1 = makeEntry({ description: "First" });
    const entry2 = makeEntry({ description: "Second" });
    genUiRegistry.register("dup", entry1);
    genUiRegistry.register("dup", entry2);
    expect(genUiRegistry.get("dup")?.description).toBe("Second");
  });

  it("validateProps throws COMPONENT_NOT_FOUND for unknown id", () => {
    expect(() => genUiRegistry.validateProps("unknown", {})).toThrowError(
      expect.objectContaining({ code: "COMPONENT_NOT_FOUND" }),
    );
  });

  it("validateProps throws PROPS_VALIDATION for invalid props", () => {
    genUiRegistry.register("strict_chart", {
      component: () => null,
      category: "chart",
      propsSchema: z.object({ requiredField: z.string() }),
      description: "Needs a required field",
    });
    expect(() => genUiRegistry.validateProps("strict_chart", {})).toThrowError(
      expect.objectContaining({ code: "PROPS_VALIDATION" }),
    );
  });

  it("validateProps merges defaultProps", () => {
    genUiRegistry.register("with_defaults", {
      component: () => null,
      category: "chart",
      propsSchema: z.object({ a: z.string(), b: z.number().default(10) }),
      defaultProps: { a: "hello" },
      description: "Has defaults",
    });
    const result = genUiRegistry.validateProps("with_defaults", { b: 20 });
    expect(result).toEqual({ a: "hello", b: 20 });
  });

  it("filters by platform", () => {
    genUiRegistry.register("web_only", {
      ...makeEntry(),
      platforms: ["web"],
    });
    genUiRegistry.register("all_platforms", makeEntry());

    const web = genUiRegistry.list({ platform: "web" });
    expect(web.map((r) => r.id)).toContain("web_only");
    expect(web.map((r) => r.id)).toContain("all_platforms");

    const ios = genUiRegistry.list({ platform: "ios" });
    expect(ios.map((r) => r.id)).not.toContain("web_only");
    expect(ios.map((r) => r.id)).toContain("all_platforms");
  });

  it("filters by category", () => {
    genUiRegistry.register("chart_a", { ...makeEntry(), category: "chart" });
    genUiRegistry.register("table_a", { ...makeEntry(), category: "table" });

    const charts = genUiRegistry.list({ category: "chart" });
    expect(charts.map((r) => r.id)).toEqual(["chart_a"]);
  });

  it("validateActionPayload passes for valid action", () => {
    genUiRegistry.register("actionable", {
      component: () => null,
      category: "chart",
      propsSchema: z.object({}),
      description: "Has actions",
      actions: [
        {
          name: "tap",
          payloadSchema: z.object({ x: z.number() }),
          description: "Tap event",
        },
      ],
    });
    expect(() => genUiRegistry.validateActionPayload("actionable", "tap", { x: 42 })).not.toThrow();
  });

  it("validateActionPayload rejects unknown action names", () => {
    genUiRegistry.register("no_actions", makeEntry());
    expect(() => genUiRegistry.validateActionPayload("no_actions", "unknown", {})).toThrowError(
      expect.objectContaining({ code: "ACTION_NOT_FOUND" }),
    );
  });

  it("registerAll registers multiple components", () => {
    const a = makeEntry({ description: "A" });
    const b = makeEntry({ description: "B" });
    genUiRegistry.registerAll({ comp_a: a, comp_b: b });
    expect(genUiRegistry.get("comp_a")).toBe(a);
    expect(genUiRegistry.get("comp_b")).toBe(b);
  });
});
