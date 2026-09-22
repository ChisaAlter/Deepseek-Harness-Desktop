import { describe, expect, test } from "vitest";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";
import {
  deleteManagedMcpServer,
  listManagedMcpServers,
  patchManagedMcpServerPolicy,
  resolveEffectiveManagedMcpServers,
  upsertManagedMcpServer,
} from "./mcp-server-management.js";

function testConfig(): MutableDaemonConfig {
  return {
    mcp: { injectIntoAgents: true },
    providers: {},
    modelGateways: {},
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
  } as MutableDaemonConfig;
}

describe("listManagedMcpServers", () => {
  test("lists built-in provider scopes in stable product-label order", () => {
    const result = listManagedMcpServers([], testConfig(), {
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
    });

    const expectedProviders = [
      { type: "provider", provider: "claude", label: "Claude" },
      { type: "provider", provider: "codex", label: "Codex" },
      { type: "provider", provider: "opencode", label: "OpenCode" },
      { type: "provider", provider: "pi", label: "Pi" },
      { type: "provider", provider: "kimi", label: "Kimi Code" },
      { type: "provider", provider: "grokbuild", label: "Grok Build" },
      { type: "provider", provider: "dsh", label: "DeepSeek Harness" },
    ];

    expect(result.scopes).toEqual([{ type: "global", label: "Global" }, ...expectedProviders]);
  });

  test("includes system ChisaCode server and user servers", () => {
    const config = upsertManagedMcpServer(testConfig(), {
      name: "github",
      config: { type: "stdio", command: "npx" },
    });

    const result = listManagedMcpServers([], config);

    expect(result.servers.map((server) => server.name)).toEqual(["chisacode", "github"]);
    expect(result.servers[0]).toMatchObject({
      name: "chisacode",
      source: "system",
      removable: false,
      editable: false,
    });
    expect(result.servers[1]).toMatchObject({
      name: "github",
      source: "user",
      removable: true,
      editable: true,
    });
  });

  test("applies global, provider, and agent policy precedence", () => {
    let config = upsertManagedMcpServer(testConfig(), {
      name: "github",
      config: { type: "stdio", command: "npx" },
    });
    config = patchManagedMcpServerPolicy(
      config,
      { type: "global" },
      { disabledServerNames: ["github"] },
    );
    config = patchManagedMcpServerPolicy(
      config,
      { type: "provider", provider: "codex" },
      { enabledServerNames: ["github"], disabledServerNames: [] },
    );
    config = patchManagedMcpServerPolicy(
      config,
      { type: "agent", agentId: "agent-codex" },
      { enabledServerNames: [], disabledServerNames: ["github"] },
    );

    const result = listManagedMcpServers([{ id: "agent-codex", provider: "codex" }], config);
    const github = result.servers.find((server) => server.name === "github");

    expect(github?.statusByScope).toMatchObject({
      global: "global-disabled",
      providers: { codex: "provider-enabled" },
      agents: { "agent-codex": "agent-disabled" },
    });
  });
});

describe("managed MCP server mutations", () => {
  test("deletes user servers and removes policy references", () => {
    let config = upsertManagedMcpServer(testConfig(), {
      name: "github",
      config: { type: "stdio", command: "npx" },
    });
    config = patchManagedMcpServerPolicy(
      config,
      { type: "provider", provider: "codex" },
      { enabledServerNames: ["github"], disabledServerNames: [] },
    );

    const next = deleteManagedMcpServer(config, "github");

    expect(next.mcpServers.servers.github).toBeUndefined();
    expect(next.mcpServers.providers.codex).toEqual({
      enabledServerNames: [],
      disabledServerNames: [],
    });
  });

  test("rejects deleting the built-in ChisaCode server", () => {
    expect(() => deleteManagedMcpServer(testConfig(), "chisacode")).toThrow(
      "MCP server is system managed",
    );
  });

  test("global ChisaCode toggle maps to existing injectIntoAgents config", () => {
    const next = patchManagedMcpServerPolicy(
      testConfig(),
      { type: "global" },
      { disabledServerNames: ["chisacode"] },
    );

    expect(next.mcp.injectIntoAgents).toBe(false);
    expect(listManagedMcpServers([], next).servers[0]?.statusByScope.global).toBe(
      "global-disabled",
    );
  });
});

describe("resolveEffectiveManagedMcpServers", () => {
  test("filters user MCP servers by provider policy", () => {
    let config = upsertManagedMcpServer(testConfig(), {
      name: "github",
      config: { type: "stdio", command: "npx" },
    });
    config = patchManagedMcpServerPolicy(
      config,
      { type: "provider", provider: "codex" },
      { enabledServerNames: [], disabledServerNames: ["github"] },
    );

    const result = resolveEffectiveManagedMcpServers(
      "agent-1",
      { provider: "codex", cwd: "/repo" },
      config,
    );

    expect(result.servers).toEqual({});
    expect(result.daemonMcpEnabled).toBe(true);
  });

  test("provider override can re-enable ChisaCode tools after global disable", () => {
    let config = patchManagedMcpServerPolicy(
      testConfig(),
      { type: "global" },
      { disabledServerNames: ["chisacode"] },
    );
    config = patchManagedMcpServerPolicy(
      config,
      { type: "provider", provider: "codex" },
      { enabledServerNames: ["chisacode"], disabledServerNames: [] },
    );

    const result = resolveEffectiveManagedMcpServers(
      "agent-1",
      { provider: "codex", cwd: "/repo" },
      config,
    );

    expect(result.daemonMcpEnabled).toBe(true);
  });
});
