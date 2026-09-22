import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentPresetSchema, type AgentPreset } from "@chisacode/protocol/agent-presets";
import { z } from "zod/v3";

import { ensureValidJson } from "../json-utils.js";

export interface RegisterAgentPresetMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  listPresets?: (() => Promise<AgentPreset[]>) | null;
  callerAgentId?: string;
}

/** Registers top-level read-only preset discovery without exposing user presets to agents. */
export function registerAgentPresetMcpTools(options: RegisterAgentPresetMcpToolsOptions): void {
  const listPresets = options.listPresets;
  if (!listPresets || options.callerAgentId) {
    return;
  }

  options.registerTool(
    "list_agent_presets",
    {
      title: "List agent presets",
      description:
        "List built-in and user-defined draft templates. Presets only fill create-agent settings and never start an agent by themselves.",
      inputSchema: {},
      outputSchema: {
        presets: z.array(AgentPresetSchema),
      },
    },
    async () => ({
      content: [],
      structuredContent: ensureValidJson({ presets: await listPresets() }),
    }),
  );
}
