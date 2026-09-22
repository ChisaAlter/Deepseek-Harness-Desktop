import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";
import {
  AgentExtensionInboundMessageSchemas,
  AgentExtensionOutboundMessageSchemas,
  AgentMcpServersListResponseSchema,
  AgentSkillsInstallRequestSchema,
  McpServerManagementConfigSchema,
  SkillManagementConfigSchema,
} from "./extensions.js";

describe("agent extension protocol", () => {
  test("exposes all skill and MCP management message schemas", () => {
    expect(AgentExtensionInboundMessageSchemas).toHaveLength(8);
    expect(AgentExtensionOutboundMessageSchemas).toHaveLength(8);
  });

  test("preserves management config defaults", () => {
    expect(SkillManagementConfigSchema.parse({})).toEqual({
      global: { disabledSkillNames: [] },
      providers: {},
      agents: {},
      installedSources: {},
    });
    expect(McpServerManagementConfigSchema.parse({})).toEqual({
      servers: {},
      global: { disabledServerNames: [] },
      providers: {},
      agents: {},
    });
  });

  test("keeps skill install requests in the session inbound union", () => {
    const request = {
      type: "agent.skills.install.request" as const,
      requestId: "install-1",
      source: { type: "github" as const, value: "openai/codex" },
    };
    const expected = { ...request, replace: false };

    expect(AgentSkillsInstallRequestSchema.parse(request)).toEqual(expected);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(expected);
  });

  test("keeps MCP list responses in the session outbound union", () => {
    const response = {
      type: "agent.mcp_servers.list.response" as const,
      payload: {
        requestId: "mcp-list-1",
        scopes: [],
        servers: [],
        policy: {},
      },
    };
    const expected = {
      ...response,
      payload: {
        ...response.payload,
        policy: {
          servers: {},
          global: { disabledServerNames: [] },
          providers: {},
          agents: {},
        },
        errors: [],
      },
    };

    expect(AgentMcpServersListResponseSchema.parse(response)).toEqual(expected);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(expected);
  });
});
