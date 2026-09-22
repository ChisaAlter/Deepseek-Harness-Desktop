import { describe, expect, test } from "vitest";
import {
  FileExplorerRequestSchema,
  MutableDaemonConfigSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

function workspaceDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    projectId: "remote:github.com/acme/app",
    projectDisplayName: "acme/app",
    projectRootPath: "/repo/app",
    workspaceDirectory: "/repo/app",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "app",
    status: "done",
    activityAt: null,
    diffStat: null,
    scripts: [],
    ...overrides,
  };
}

function fetchWorkspacesResponse(workspace: Record<string, unknown>) {
  return {
    type: "fetch_workspaces_response",
    payload: {
      requestId: "req-1",
      entries: [workspace],
      pageInfo: {
        nextCursor: null,
        prevCursor: null,
        hasMore: false,
      },
    },
  };
}

describe("model gateway test messages", () => {
  test("parses an optional target format for connectivity checks", () => {
    const inbound = SessionInboundMessageSchema.parse({
      type: "model_gateway.test.request",
      requestId: "gateway-test-1",
      gatewayId: "zai",
      modelId: "glm-5",
      targetFormat: "chatCompletions",
    });
    expect(inbound).toMatchObject({
      type: "model_gateway.test.request",
      targetFormat: "chatCompletions",
    });

    const outbound = SessionOutboundMessageSchema.parse({
      type: "model_gateway.test.response",
      payload: {
        requestId: "gateway-test-1",
        gatewayId: "zai",
        modelId: "glm-5",
        result: { ok: true, durationMs: 42, status: 200, error: null },
        error: null,
      },
    });
    expect(outbound.type).toBe("model_gateway.test.response");
  });
});

describe("workspace descriptor message compatibility", () => {
  test("old-shaped fetch_workspaces_response without project still parses", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(workspaceDescriptor()),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]?.project).toBeUndefined();
  });

  test("new-shaped fetch_workspaces_response with project placement parses", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(
        workspaceDescriptor({
          project: {
            projectKey: "remote:github.com/acme/app",
            projectName: "acme/app",
            checkout: {
              cwd: "/repo/app",
              isGit: true,
              currentBranch: "main",
              remoteUrl: "https://github.com/acme/app.git",
              worktreeRoot: "/repo/app",
              isChisaCodeOwnedWorktree: false,
              mainRepoRoot: null,
            },
          },
        }),
      ),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]?.project).toEqual({
      projectKey: "remote:github.com/acme/app",
      projectName: "acme/app",
      checkout: {
        cwd: "/repo/app",
        isGit: true,
        currentBranch: "main",
        remoteUrl: "https://github.com/acme/app.git",
        worktreeRoot: "/repo/app",
        isChisaCodeOwnedWorktree: false,
        mainRepoRoot: null,
      },
    });
  });

  test("adding project does not narrow existing descriptor fields", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(
        workspaceDescriptor({
          workspaceDirectory: undefined,
          projectKind: "non_git",
          workspaceKind: "directory",
          gitRuntime: null,
          githubRuntime: null,
          project: {
            projectKey: "/repo/local",
            projectName: "local",
            checkout: {
              cwd: "/repo/local",
              isGit: false,
              currentBranch: null,
              remoteUrl: null,
              worktreeRoot: null,
              isChisaCodeOwnedWorktree: false,
              mainRepoRoot: null,
            },
          },
        }),
      ),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]).toMatchObject({
      projectKind: "non_git",
      workspaceKind: "directory",
      workspaceDirectory: "/repo/app",
      gitRuntime: null,
      githubRuntime: null,
    });
  });
});

describe("file explorer request compatibility", () => {
  test("acceptBinary is optional for old clients and accepted for new clients", () => {
    expect(
      FileExplorerRequestSchema.parse({
        type: "file_explorer_request",
        cwd: "/repo/app",
        path: "image.png",
        mode: "file",
        requestId: "req-old",
      }),
    ).toEqual({
      type: "file_explorer_request",
      cwd: "/repo/app",
      path: "image.png",
      mode: "file",
      requestId: "req-old",
    });

    expect(
      FileExplorerRequestSchema.parse({
        type: "file_explorer_request",
        cwd: "/repo/app",
        path: "image.png",
        mode: "file",
        requestId: "req-new",
        acceptBinary: true,
      }),
    ).toMatchObject({
      type: "file_explorer_request",
      requestId: "req-new",
      acceptBinary: true,
    });
  });
});

describe("agent skill management protocol", () => {
  test("old daemon config defaults skill management to all enabled", () => {
    const parsed = MutableDaemonConfigSchema.parse({
      mcp: { injectIntoAgents: true },
    });

    expect(parsed.skills).toEqual({
      global: {
        disabledSkillNames: [],
      },
      providers: {},
      agents: {},
      installedSources: {},
    });
  });

  test("accepts AGPL source offer metadata in server info", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server-1",
        sourceCode: {
          license: "AGPL-3.0-or-later",
          repositoryUrl: "https://github.com/ChisaAlter/ChisaCode",
          noticePath: "NOTICE",
          originalProjectUrl: "https://github.com/getpaseo/paseo",
          offerPath: "/api/source",
          correspondingSourceRequired: true,
        },
      }).sourceCode,
    ).toEqual({
      license: "AGPL-3.0-or-later",
      repositoryUrl: "https://github.com/ChisaAlter/ChisaCode",
      noticePath: "NOTICE",
      originalProjectUrl: "https://github.com/getpaseo/paseo",
      offerPath: "/api/source",
      correspondingSourceRequired: true,
    });
  });

  test("parses skill list request and response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.skills.list.request",
        requestId: "req-1",
      }),
    ).toEqual({
      type: "agent.skills.list.request",
      requestId: "req-1",
    });

    const parsed = SessionOutboundMessageSchema.parse({
      type: "agent.skills.list.response",
      payload: {
        requestId: "req-1",
        scopes: [
          { type: "global", label: "Global" },
          { type: "provider", provider: "codex", label: "Codex" },
          { type: "agent", agentId: "agent-1", label: "Agent 1", status: "idle" },
        ],
        skills: [
          {
            name: "review",
            sources: [
              {
                id: "codex-home:review",
                type: "codex-home",
                path: "/home/me/.codex/skills/review",
                installedSourceId: "src-1",
                removable: true,
              },
            ],
            statusByScope: {
              global: "enabled",
              providers: {
                codex: "agent-enabled",
              },
              agents: {
                "agent-1": "agent-disabled",
              },
            },
            errors: [],
          },
        ],
        policy: {
          global: { disabledSkillNames: [] },
          providers: {
            codex: {
              enabledSkillNames: ["review"],
              disabledSkillNames: [],
            },
          },
          agents: {
            "agent-1": {
              enabledSkillNames: [],
              disabledSkillNames: ["review"],
            },
          },
          installedSources: {},
        },
        errors: [],
      },
    });

    expect(parsed.type).toBe("agent.skills.list.response");
  });

  test("parses skill policy patch request and response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.skills.policy.patch.request",
        requestId: "req-2",
        scope: { type: "agent", agentId: "agent-1" },
        policy: {
          enabledSkillNames: ["review"],
          disabledSkillNames: ["security-review"],
        },
      }),
    ).toMatchObject({
      type: "agent.skills.policy.patch.request",
      scope: { type: "agent", agentId: "agent-1" },
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.skills.policy.patch.request",
        requestId: "req-provider",
        scope: { type: "provider", provider: "codex" },
        policy: {
          enabledSkillNames: ["review"],
        },
      }),
    ).toMatchObject({
      type: "agent.skills.policy.patch.request",
      scope: { type: "provider", provider: "codex" },
    });

    const parsed = SessionOutboundMessageSchema.parse({
      type: "agent.skills.policy.patch.response",
      payload: {
        requestId: "req-2",
        ok: true,
        policy: {
          global: { disabledSkillNames: [] },
          providers: {},
          agents: {},
          installedSources: {},
        },
        error: null,
      },
    });

    expect(parsed.type).toBe("agent.skills.policy.patch.response");
  });

  test("parses skill install and uninstall messages", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.skills.install.request",
        requestId: "req-3",
        source: { type: "github", value: "owner/repo" },
        replace: true,
      }),
    ).toMatchObject({
      type: "agent.skills.install.request",
      source: { type: "github", value: "owner/repo" },
      replace: true,
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.skills.uninstall.request",
        requestId: "req-4",
        sourceId: "github:owner/repo",
      }),
    ).toMatchObject({
      type: "agent.skills.uninstall.request",
      sourceId: "github:owner/repo",
    });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.skills.install.response",
        payload: {
          requestId: "req-3",
          ok: true,
          installedSource: {
            id: "github:owner/repo",
            type: "github",
            url: "https://github.com/owner/repo",
            installedAt: "2026-06-18T00:00:00.000Z",
            skillNames: ["review"],
          },
          skills: ["review"],
          error: null,
        },
      }).type,
    ).toBe("agent.skills.install.response");

    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.skills.uninstall.response",
        payload: {
          requestId: "req-4",
          ok: true,
          removedSkillNames: ["review"],
          policy: {
            global: { disabledSkillNames: [] },
            providers: {},
            agents: {},
            installedSources: {},
          },
          error: null,
        },
      }).type,
    ).toBe("agent.skills.uninstall.response");
  });
});

describe("agent MCP server management protocol", () => {
  test("old daemon config defaults MCP server management to empty and all enabled", () => {
    const parsed = MutableDaemonConfigSchema.parse({
      mcp: { injectIntoAgents: true },
    });

    expect(parsed.mcpServers).toEqual({
      servers: {},
      global: { disabledServerNames: [] },
      providers: {},
      agents: {},
    });
  });

  test("parses MCP server list request and response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.mcp_servers.list.request",
        requestId: "mcp-list",
      }),
    ).toEqual({
      type: "agent.mcp_servers.list.request",
      requestId: "mcp-list",
    });

    const parsed = SessionOutboundMessageSchema.parse({
      type: "agent.mcp_servers.list.response",
      payload: {
        requestId: "mcp-list",
        scopes: [
          { type: "global", label: "Global" },
          { type: "provider", provider: "codex", label: "Codex" },
        ],
        servers: [
          {
            name: "github",
            source: "user",
            removable: true,
            editable: true,
            config: {
              type: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              env: { GITHUB_TOKEN: "token" },
            },
            statusByScope: {
              global: "enabled",
              providers: { codex: "provider-disabled" },
              agents: {},
            },
            errors: [],
          },
        ],
        policy: {
          servers: {},
          global: { disabledServerNames: [] },
          providers: {},
          agents: {},
        },
        errors: [],
      },
    });

    expect(parsed.type).toBe("agent.mcp_servers.list.response");
  });

  test("parses MCP server upsert, policy, and delete messages", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.mcp_servers.upsert.request",
        requestId: "mcp-upsert-stdio",
        server: {
          name: "github",
          config: { type: "stdio", command: "npx" },
        },
      }),
    ).toMatchObject({
      type: "agent.mcp_servers.upsert.request",
      server: { name: "github", config: { type: "stdio" } },
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.mcp_servers.upsert.request",
        requestId: "mcp-upsert-http",
        originalName: "linear",
        server: {
          name: "linear",
          config: { type: "http", url: "https://example.com/mcp" },
        },
      }),
    ).toMatchObject({
      type: "agent.mcp_servers.upsert.request",
      originalName: "linear",
      server: { name: "linear", config: { type: "http" } },
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.mcp_servers.upsert.request",
        requestId: "mcp-upsert-sse",
        server: {
          name: "docs",
          config: { type: "sse", url: "https://example.com/sse" },
        },
      }),
    ).toMatchObject({
      type: "agent.mcp_servers.upsert.request",
      server: { name: "docs", config: { type: "sse" } },
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.mcp_servers.policy.patch.request",
        requestId: "mcp-policy",
        scope: { type: "provider", provider: "codex" },
        policy: { disabledServerNames: ["github"] },
      }),
    ).toMatchObject({
      type: "agent.mcp_servers.policy.patch.request",
      scope: { type: "provider", provider: "codex" },
    });

    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.mcp_servers.delete.request",
        requestId: "mcp-delete",
        name: "github",
      }),
    ).toMatchObject({
      type: "agent.mcp_servers.delete.request",
      name: "github",
    });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.mcp_servers.policy.patch.response",
        payload: {
          requestId: "mcp-policy",
          ok: true,
          policy: {
            servers: {},
            global: { disabledServerNames: [] },
            providers: { codex: { enabledServerNames: [], disabledServerNames: ["github"] } },
            agents: {},
          },
          error: null,
        },
      }).type,
    ).toBe("agent.mcp_servers.policy.patch.response");
  });
});
