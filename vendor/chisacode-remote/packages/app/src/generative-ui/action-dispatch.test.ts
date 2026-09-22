import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { dispatchValidatedAction } from "./action-dispatch";
import { genUiRegistry } from "./registry/registry";

describe("dispatchValidatedAction", () => {
  beforeEach(() => {
    genUiRegistry.clear();
    genUiRegistry.register("form", {
      component: () => null,
      category: "form",
      propsSchema: z.object({}),
      description: "Form",
      actions: [
        {
          name: "submit",
          payloadSchema: z.object({ values: z.record(z.unknown()) }),
          description: "Submit",
        },
      ],
    });
  });

  it.each([
    ["unknown component", "missing", "submit", { values: {} }],
    ["unknown action", "form", "delete", {}],
    ["invalid payload", "form", "submit", { wrong: true }],
  ])("does not call sender for %s", async (_name, componentId, action, payload) => {
    const calls: unknown[][] = [];
    const result = await dispatchValidatedAction({
      componentId,
      instanceId: "form-1",
      action,
      payload,
      sender: async (...args) => {
        calls.push(args);
        return true;
      },
    });
    expect(result).toBe(false);
    expect(calls).toEqual([]);
  });

  it("calls the sender exactly once after exact action validation", async () => {
    const calls: unknown[][] = [];
    const result = await dispatchValidatedAction({
      componentId: "form",
      instanceId: "form-1",
      action: "submit",
      payload: { values: { name: "Ada" } },
      sender: async (...args) => {
        calls.push(args);
        return true;
      },
    });
    expect(result).toBe(true);
    expect(calls).toEqual([["form-1", "submit", { values: { name: "Ada" } }]]);
  });

  it("converts sender rejection to false", async () => {
    const result = await dispatchValidatedAction({
      componentId: "form",
      instanceId: "form-1",
      action: "submit",
      payload: { values: {} },
      sender: async () => {
        throw new Error("offline");
      },
    });
    expect(result).toBe(false);
  });
});
