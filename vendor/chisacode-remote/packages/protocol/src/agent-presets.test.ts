import { describe, expect, test } from "vitest";
import { AgentPresetSchema, BUILTIN_AGENT_PRESETS } from "./agent-presets.js";

describe("agent presets", () => {
  test("parses built-in preset payloads", () => {
    expect(BUILTIN_AGENT_PRESETS.map((preset) => AgentPresetSchema.parse(preset))).toHaveLength(4);
  });
});
