import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test, vi } from "vitest";

import { registerAgentPresetMcpTools } from "./agent-preset-mcp-tools.js";

interface RegisteredTool {
  handler: () => Promise<{ structuredContent?: Record<string, unknown> }>;
}

function createToolRegistry(): {
  tools: Map<string, RegisteredTool>;
  registerTool: McpServer["registerTool"];
} {
  const tools = new Map<string, RegisteredTool>();
  const registerTool = ((name: string, _config: unknown, handler: RegisteredTool["handler"]) => {
    tools.set(name, { handler });
  }) as unknown as McpServer["registerTool"];
  return { tools, registerTool };
}

describe("registerAgentPresetMcpTools", () => {
  test("registers full preset discovery for top-level MCP", async () => {
    const registry = createToolRegistry();
    const listPresets = vi.fn(async () => [
      {
        id: "reviewer",
        label: "Reviewer",
        description: "Review code",
        provider: "default",
        systemPrompt: "Review carefully",
      },
    ]);

    registerAgentPresetMcpTools({
      registerTool: registry.registerTool,
      listPresets,
    });

    const tool = registry.tools.get("list_agent_presets");
    expect(registry.tools.has("list_agent_presets")).toBe(true);
    if (!tool) {
      throw new Error("Expected list_agent_presets to be registered");
    }
    await expect(tool.handler()).resolves.toMatchObject({
      structuredContent: {
        presets: [
          {
            id: "reviewer",
            systemPrompt: "Review carefully",
          },
        ],
      },
    });
    expect(listPresets).toHaveBeenCalledOnce();
  });

  test("does not expose user presets to agent-scoped MCP", () => {
    const registry = createToolRegistry();

    registerAgentPresetMcpTools({
      registerTool: registry.registerTool,
      listPresets: async () => [],
      callerAgentId: "agent-1",
    });

    expect(registry.tools.has("list_agent_presets")).toBe(false);
  });
});
