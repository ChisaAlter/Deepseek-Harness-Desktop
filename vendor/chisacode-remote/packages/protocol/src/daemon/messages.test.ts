import { describe, expect, test } from "vitest";

import {
  KnownStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "../messages.js";
import {
  DaemonConfigChangedStatusPayloadSchema,
  DaemonInboundMessageSchemas,
  DaemonOutboundMessageSchemas,
  DaemonStatusPayloadSchemas,
  MutableDaemonConfigSchema,
} from "./messages.js";

describe("daemon protocol", () => {
  test("exposes daemon requests, responses, and status payloads", () => {
    expect(DaemonInboundMessageSchemas).toHaveLength(8);
    expect(DaemonOutboundMessageSchemas).toHaveLength(6);
    expect(DaemonStatusPayloadSchemas).toHaveLength(3);
  });

  test("preserves defaults for older daemon configs", () => {
    expect(MutableDaemonConfigSchema.parse({ mcp: { injectIntoAgents: true } })).toEqual({
      mcp: { injectIntoAgents: true },
      providers: {},
      modelGateways: {},
      visionFallbackModel: null,
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      appendSystemPrompt: "",
      skills: {
        global: { disabledSkillNames: [] },
        providers: {},
        agents: {},
        installedSources: {},
      },
      mcpServers: {
        servers: {},
        global: { disabledServerNames: [] },
        providers: {},
        agents: {},
      },
    });
  });

  test("keeps daemon control requests in the session inbound union", () => {
    const requests = [
      { type: "daemon.get_status.request", requestId: "status-1" },
      { type: "read_project_config_request", requestId: "project-1", repoRoot: "/repo" },
      { type: "restart_server_request", requestId: "restart-1", reason: "settings" },
    ];

    for (const request of requests) {
      expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    }
  });

  test("keeps daemon status responses in the session outbound union", () => {
    const response = {
      type: "daemon.get_status.response" as const,
      payload: {
        requestId: "status-1",
        serverId: "server-1",
        pid: 42,
        nodePath: "/usr/bin/node",
        listen: "127.0.0.1:6767",
        providers: [],
      },
    };

    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("keeps daemon config changes in the known status union", () => {
    const payload = {
      status: "daemon_config_changed" as const,
      config: { mcp: { injectIntoAgents: false } },
    };
    const direct = DaemonConfigChangedStatusPayloadSchema.parse(payload);

    expect(KnownStatusPayloadSchema.parse(payload)).toEqual(direct);
  });
});
