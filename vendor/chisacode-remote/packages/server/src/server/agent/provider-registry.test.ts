import { beforeEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentModelDefinition } from "./agent-sdk-types.js";

const mockState = vi.hoisted(() => {
  interface ConstructorEntry {
    runtimeSettings?: unknown;
  }

  return {
    constructorArgs: {
      claude: [] as ConstructorEntry[],
      codex: [] as ConstructorEntry[],
      opencode: [] as ConstructorEntry[],
      copilot: [] as ConstructorEntry[],
      cursor: [] as Array<{
        command: string[];
        env?: Record<string, string>;
      }>,
      pi: [] as ConstructorEntry[],
      kimi: [] as Array<{
        runtimeSettings?: unknown;
        providerId?: string;
        label?: string;
        models?: unknown[];
      }>,
      grokbuild: [] as Array<{
        runtimeSettings?: unknown;
        providerId?: string;
        label?: string;
      }>,
      dsh: [] as Array<{
        runtimeSettings?: unknown;
        providerId?: string;
        label?: string;
        models?: unknown[];
      }>,
      genericAcp: [] as Array<{
        command: string[];
        env?: Record<string, string>;
        providerId?: string;
        label?: string;
      }>,
    },
    isCommandAvailable: vi.fn(async (_command: string) => false),
    runtimeModels: new Map<string, AgentModelDefinition[]>(),
    reset() {
      this.constructorArgs.claude = [];
      this.constructorArgs.codex = [];
      this.constructorArgs.opencode = [];
      this.constructorArgs.pi = [];
      this.constructorArgs.kimi = [];
      this.constructorArgs.grokbuild = [];
      this.constructorArgs.dsh = [];
      this.constructorArgs.genericAcp = [];
      this.isCommandAvailable.mockReset();
      this.isCommandAvailable.mockImplementation(async (_command: string) => false);
      this.runtimeModels.clear();
    },
  };
});

vi.mock("../../utils/executable.js", () => ({
  isCommandAvailable: mockState.isCommandAvailable,
}));

vi.mock("./providers/claude/agent.js", () => ({
  ClaudeAgentClient: class ClaudeAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "claude";
    readonly runtimeSettings?: unknown;

    constructor(options: { runtimeSettings?: unknown }) {
      this.runtimeSettings = options.runtimeSettings;
      mockState.constructorArgs.claude.push({
        runtimeSettings: options.runtimeSettings,
      });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      const command: { mode?: string; argv?: string[] } | undefined =
        typeof this.runtimeSettings === "object" && this.runtimeSettings !== null
          ? Reflect.get(this.runtimeSettings, "command")
          : undefined;
      if (command?.mode === "replace") {
        const { isCommandAvailable } = await import("../../utils/executable.js");
        return await isCommandAvailable(command.argv?.[0] ?? "");
      }
      return true;
    }
  },
}));

vi.mock("./providers/codex-app-server-agent.js", () => ({
  CodexAppServerAgentClient: class CodexAppServerAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "codex";
    readonly runtimeSettings?: unknown;

    constructor(_logger: unknown, runtimeSettings?: unknown) {
      this.runtimeSettings = runtimeSettings;
      mockState.constructorArgs.codex.push({ runtimeSettings });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      const command: { mode?: string; argv?: string[] } | undefined =
        typeof this.runtimeSettings === "object" && this.runtimeSettings !== null
          ? Reflect.get(this.runtimeSettings, "command")
          : undefined;
      if (command?.mode === "replace") {
        const { isCommandAvailable } = await import("../../utils/executable.js");
        return await isCommandAvailable(command.argv?.[0] ?? "");
      }
      return true;
    }
  },
}));

vi.mock("./providers/pi/agent.js", () => ({
  PiRpcAgentClient: class PiRpcAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "pi";
    readonly runtimeSettings?: unknown;

    constructor(options: { runtimeSettings?: unknown }) {
      this.runtimeSettings = options.runtimeSettings;
      mockState.constructorArgs.pi.push({
        runtimeSettings: options.runtimeSettings,
      });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      return true;
    }
  },
}));

vi.mock("./providers/opencode-agent.js", () => ({
  OpenCodeAgentClient: class OpenCodeAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "opencode";
    readonly runtimeSettings?: unknown;

    constructor(_logger: unknown, runtimeSettings?: unknown) {
      this.runtimeSettings = runtimeSettings;
      mockState.constructorArgs.opencode.push({ runtimeSettings });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      return true;
    }
  },
}));

vi.mock("./providers/kimi-code-agent.js", () => ({
  KimiCodeAgentClient: class KimiCodeAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "kimi";
    readonly runtimeSettings?: unknown;

    constructor(options: {
      runtimeSettings?: unknown;
      providerId?: string;
      label?: string;
      models?: unknown[];
    }) {
      this.runtimeSettings = options.runtimeSettings;
      mockState.constructorArgs.kimi.push({
        runtimeSettings: options.runtimeSettings,
        providerId: options.providerId,
        label: options.label,
        models: options.models,
      });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      return true;
    }
  },
}));

vi.mock("./providers/grok-build-agent.js", () => ({
  GrokBuildAgentClient: class GrokBuildAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "grokbuild";

    constructor(options: {
      runtimeSettings?: unknown;
      providerId?: string;
      label?: string;
      models?: unknown;
    }) {
      mockState.constructorArgs.grokbuild.push({
        runtimeSettings: options.runtimeSettings,
        providerId: options.providerId,
        label: options.label,
        models: options.models,
      });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      return true;
    }
  },
}));

vi.mock("./providers/dsh-agent.js", () => ({
  DshAgentClient: class DshAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "dsh";
    readonly runtimeSettings?: unknown;

    constructor(options: {
      runtimeSettings?: unknown;
      providerId?: string;
      label?: string;
      models?: unknown[];
    }) {
      this.runtimeSettings = options.runtimeSettings;
      mockState.constructorArgs.dsh.push({
        runtimeSettings: options.runtimeSettings,
        providerId: options.providerId,
        label: options.label,
        models: options.models,
      });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      return true;
    }
  },
}));

vi.mock("./providers/generic-acp-agent.js", () => ({
  GenericACPAgentClient: class GenericACPAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "acp";
    readonly runtimeSettings?: unknown;

    constructor(options: {
      command: string[];
      env?: Record<string, string>;
      providerId?: string;
      label?: string;
    }) {
      this.runtimeSettings = {
        command: {
          mode: "replace",
          argv: options.command,
        },
        env: options.env,
      };
      mockState.constructorArgs.genericAcp.push({
        command: options.command,
        env: options.env,
        providerId: options.providerId,
        label: options.label,
      });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      return true;
    }
  },
}));

vi.mock("./providers/cursor-acp-agent.js", () => ({
  CursorACPAgentClient: class CursorACPAgentClient {
    readonly capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    readonly provider = "acp";
    readonly runtimeSettings?: unknown;

    constructor(options: { command: string[]; env?: Record<string, string> }) {
      this.runtimeSettings = {
        command: {
          mode: "replace",
          argv: options.command,
        },
        env: options.env,
      };
      mockState.constructorArgs.cursor.push({
        command: options.command,
        env: options.env,
      });
    }

    async createSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async resumeSession(): Promise<never> {
      throw new Error("not implemented");
    }

    async listModels(): Promise<AgentModelDefinition[]> {
      return mockState.runtimeModels.get(this.provider) ?? [];
    }

    async listModes(): Promise<[]> {
      return [];
    }

    async isAvailable(): Promise<boolean> {
      return true;
    }
  },
}));

import {
  AGENT_PROVIDER_DEFINITIONS,
  buildProviderRegistry,
  createAllClients,
  resolveGatewayAgentFaces,
} from "./provider-registry.js";

const logger = createTestLogger();

beforeEach(() => {
  mockState.reset();
});

test("builds registry with no overrides in built-in manifest order", () => {
  const registry = buildProviderRegistry(logger);

  expect(Object.keys(registry).filter((id) => !id.startsWith("mock"))).toEqual([
    "claude",
    "codex",
    "opencode",
    "pi",
    "kimi",
    "grokbuild",
    "dsh",
  ]);
});

test("grokbuild client uses the Grok Build ACP launcher", () => {
  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      grokbuild: {
        command: ["custom-grok", "agent", "stdio"],
        env: { XAI_API_KEY: "secret" },
      },
    },
  });

  expect(registry.grokbuild.createClient(logger).provider).toBe("grokbuild");
  expect(mockState.constructorArgs.grokbuild.at(-1)).toMatchObject({
    runtimeSettings: {
      command: {
        mode: "replace",
        argv: ["custom-grok", "agent", "stdio"],
      },
      env: { XAI_API_KEY: "secret" },
    },
  });
});

test("dsh client uses the DeepSeek Harness ACP launcher with default identity", () => {
  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      dsh: {
        env: { DEEPSEEK_API_KEY: "secret" },
      },
    },
  });

  expect(registry.dsh.createClient(logger).provider).toBe("dsh");
  expect(mockState.constructorArgs.dsh.at(-1)).toMatchObject({
    providerId: "dsh",
    label: "DeepSeek Harness",
    runtimeSettings: { env: { DEEPSEEK_API_KEY: "secret" } },
  });
});

test("includes mock provider only for development builds or explicit opt-in", () => {
  expect(buildProviderRegistry(logger).mock).toBeUndefined();
  expect(buildProviderRegistry(logger, { isDev: false }).mock).toBeUndefined();
  expect(buildProviderRegistry(logger, { enableDevProviders: false }).mock).toBeUndefined();

  const registry = buildProviderRegistry(logger, { isDev: true });

  expect(registry.mock).toMatchObject({
    id: "mock",
    label: "Mock Load Test",
    defaultModeId: "load-test",
  });

  const optInRegistry = buildProviderRegistry(logger, { enableDevProviders: true });
  expect(optInRegistry.mock).toMatchObject({
    id: "mock",
    label: "Mock Load Test",
    defaultModeId: "load-test",
  });
  expect(optInRegistry["mock-slow"]).toMatchObject({
    id: "mock-slow",
  });
  expect(buildProviderRegistry(logger, { enableDevProviders: false })["mock-slow"]).toBeUndefined();
  expect(buildProviderRegistry(logger)["mock-slow"]).toBeUndefined();
});

test("built-in override applies command", () => {
  buildProviderRegistry(logger, {
    providerOverrides: {
      claude: {
        command: ["/opt/custom-claude", "--verbose"],
      },
    },
  });

  expect(mockState.constructorArgs.claude[0]).toEqual({
    runtimeSettings: {
      command: {
        mode: "replace",
        argv: ["/opt/custom-claude", "--verbose"],
      },
      env: undefined,
    },
  });
});

test("built-in override applies env", () => {
  buildProviderRegistry(logger, {
    providerOverrides: {
      claude: {
        env: {
          CLAUDE_CONFIG_DIR: "/tmp/claude",
        },
      },
    },
  });

  expect(mockState.constructorArgs.claude[0]).toEqual({
    runtimeSettings: {
      command: undefined,
      env: {
        CLAUDE_CONFIG_DIR: "/tmp/claude",
      },
    },
  });
});

test("new provider extending claude appears in registry", () => {
  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      zai: {
        extends: "claude",
        label: "ZAI",
        description: "Claude with ZAI defaults",
      },
    },
  });

  expect(registry.zai).toBeDefined();
  expect(registry.zai.label).toBe("ZAI");
  expect(registry.zai.description).toBe("Claude with ZAI defaults");
  expect(registry.zai.createClient(logger).provider).toBe("zai");
});

test("model gateway materializes provider entries for all built-in agents", async () => {
  const registry = buildProviderRegistry(logger, {
    modelGateways: {
      zai: {
        id: "zai",
        label: "ZAI",
        enabled: true,
        models: [
          {
            id: "glm-5",
            label: "GLM 5",
            isDefault: true,
            contextWindowMaxTokens: 200_000,
            supportsImages: true,
          },
          { id: "glm-5-air", label: "GLM 5 Air" },
        ],
        syntheticModels: [
          {
            id: "moa-coder",
            label: "MoA Coder",
            description: "Synthetic coding model",
            references: [{ model: "glm-5" }],
            aggregatorModel: "glm-5",
            rounds: 2,
          },
        ],
        generatedModels: {
          opencode: [
            {
              id: "glm-5",
              label: "GLM 5",
              isDefault: true,
              contextWindowMaxTokens: 200_000,
              supportsImages: true,
            },
            { id: "glm-5-air", label: "GLM 5 Air" },
          ],
          kimi: [
            {
              id: "glm-5",
              label: "GLM 5",
              isDefault: true,
              contextWindowMaxTokens: 200_000,
              supportsImages: true,
            },
            { id: "glm-5-air", label: "GLM 5 Air" },
          ],
        },
        upstreams: {
          anthropic: {
            enabled: true,
            baseUrl: "https://api.z.ai/api/anthropic",
            apiKey: "sk-anthropic",
          },
          chatCompletions: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
          },
          responses: {
            enabled: true,
            baseUrl: "https://api.z.ai/v1",
            apiKey: "sk-responses",
          },
        },
      },
    },
    modelGatewayBaseUrl: "http://127.0.0.1:6767",
    modelGatewayToken: "internal-token",
  });

  expect(registry["zai-claude"]).toMatchObject({
    id: "zai-claude",
    label: "ZAI Claude",
    derivedFromProviderId: "claude",
    modelGatewayId: "zai",
    enabled: true,
  });
  expect(registry["zai-codex"]).toMatchObject({
    id: "zai-codex",
    label: "ZAI Codex",
    derivedFromProviderId: "codex",
    modelGatewayId: "zai",
    enabled: true,
  });
  expect(registry["zai-opencode"]).toMatchObject({
    id: "zai-opencode",
    label: "ZAI OpenCode",
    derivedFromProviderId: "opencode",
    modelGatewayId: "zai",
    enabled: true,
  });
  expect(registry["zai-pi"]).toMatchObject({
    id: "zai-pi",
    label: "ZAI Pi",
    derivedFromProviderId: "pi",
    modelGatewayId: "zai",
    enabled: true,
  });
  expect(registry["zai-kimi"]).toMatchObject({
    id: "zai-kimi",
    label: "ZAI Kimi Code",
    derivedFromProviderId: "kimi",
    modelGatewayId: "zai",
    enabled: true,
  });
  expect(registry["zai-grokbuild"]).toMatchObject({
    id: "zai-grokbuild",
    label: "ZAI Grok Build",
    derivedFromProviderId: "grokbuild",
    modelGatewayId: "zai",
    enabled: true,
  });

  const opencodeProviderModels = [
    {
      provider: "zai-opencode",
      id: "openai/glm-5",
      label: "GLM 5",
      isDefault: true,
      contextWindowMaxTokens: 200_000,
      supportsImages: true,
    },
    {
      provider: "zai-opencode",
      id: "openai/glm-5-air",
      label: "GLM 5 Air",
    },
    {
      provider: "zai-opencode",
      id: "openai/moa-coder",
      label: "MoA Coder",
      description: "Synthetic coding model",
    },
  ];
  await expect(
    registry["zai-opencode"].fetchModels({ cwd: "/tmp/registry-models", force: false }),
  ).resolves.toEqual(opencodeProviderModels);
  await expect(
    registry["zai-claude"].fetchModels({ cwd: "/tmp/registry-models", force: false }),
  ).resolves.toEqual([
    {
      provider: "zai-claude",
      id: "glm-5",
      label: "GLM 5",
      isDefault: true,
      contextWindowMaxTokens: 200_000,
      supportsImages: true,
    },
    {
      provider: "zai-claude",
      id: "glm-5-air",
      label: "GLM 5 Air",
    },
    {
      provider: "zai-claude",
      id: "moa-coder",
      label: "MoA Coder",
      description: "Synthetic coding model",
    },
  ]);
  await expect(
    registry["zai-codex"].fetchModels({ cwd: "/tmp/registry-models", force: false }),
  ).resolves.toEqual([
    {
      provider: "zai-codex",
      id: "glm-5",
      label: "GLM 5",
      isDefault: true,
      contextWindowMaxTokens: 200_000,
      supportsImages: true,
    },
    {
      provider: "zai-codex",
      id: "glm-5-air",
      label: "GLM 5 Air",
    },
    {
      provider: "zai-codex",
      id: "moa-coder",
      label: "MoA Coder",
      description: "Synthetic coding model",
    },
  ]);
  await expect(
    registry["zai-pi"].fetchModels({ cwd: "/tmp/registry-models", force: false }),
  ).resolves.toEqual(
    opencodeProviderModels.map((model) => Object.assign({}, model, { provider: "zai-pi" })),
  );
  await expect(
    registry["zai-kimi"].fetchModels({ cwd: "/tmp/registry-models", force: false }),
  ).resolves.toEqual([
    {
      provider: "zai-kimi",
      id: "glm-5",
      label: "GLM 5",
      isDefault: true,
      contextWindowMaxTokens: 200_000,
      supportsImages: true,
    },
    {
      provider: "zai-kimi",
      id: "glm-5-air",
      label: "GLM 5 Air",
    },
    {
      provider: "zai-kimi",
      id: "moa-coder",
      label: "MoA Coder",
      description: "Synthetic coding model",
    },
  ]);

  registry["zai-claude"].createClient(logger);
  registry["zai-codex"].createClient(logger);
  registry["zai-opencode"].createClient(logger);
  registry["zai-pi"].createClient(logger);
  registry["zai-kimi"].createClient(logger);
  registry["zai-grokbuild"].createClient(logger);

  const claudeGatewayArgs = mockState.constructorArgs.claude.find((entry) => {
    const env =
      typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
        ? Reflect.get(entry.runtimeSettings, "env")
        : undefined;
    return env?.ANTHROPIC_BASE_URL === "http://127.0.0.1:6767/api/model-gateways/zai";
  });
  expect(claudeGatewayArgs).toEqual({
    runtimeSettings: {
      command: undefined,
      env: {
        ANTHROPIC_API_KEY: "internal-token",
        ANTHROPIC_AUTH_TOKEN: "internal-token",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai",
        CLAUDE_CONFIG_DIR: expect.any(String),
      },
      disallowedTools: ["WebSearch"],
    },
  });
  const claudeGatewayConfigDir: string | undefined =
    typeof claudeGatewayArgs?.runtimeSettings === "object" &&
    claudeGatewayArgs.runtimeSettings !== null
      ? Reflect.get(Reflect.get(claudeGatewayArgs.runtimeSettings, "env"), "CLAUDE_CONFIG_DIR")
      : undefined;
  expect(claudeGatewayConfigDir).toMatch(/[\\/]\.chisacode[\\/]claude-model-gateways[\\/]zai$/u);

  const codexGatewayArgs = mockState.constructorArgs.codex.find((entry) => {
    const env =
      typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
        ? Reflect.get(entry.runtimeSettings, "env")
        : undefined;
    return env?.OPENAI_WIRE_API === "responses";
  });
  expect(codexGatewayArgs).toEqual({
    runtimeSettings: {
      command: undefined,
      env: {
        OPENAI_API_KEY: "internal-token",
        OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai",
        OPENAI_WIRE_API: "responses",
      },
    },
  });

  const opencodeGatewayArgs = mockState.constructorArgs.opencode.find((entry) => {
    const env =
      typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
        ? Reflect.get(entry.runtimeSettings, "env")
        : undefined;
    return env?.OPENAI_BASE_URL === "http://127.0.0.1:6767/api/model-gateways/zai/v1";
  });
  expect(opencodeGatewayArgs).toEqual({
    runtimeSettings: {
      command: undefined,
      env: {
        OPENAI_API_KEY: "internal-token",
        OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        OPENCODE_CONFIG: expect.stringMatching(
          /[\\/]\.chisacode[\\/]opencode-model-gateways[\\/]zai[\\/]opencode\.json$/u,
        ),
      },
    },
  });

  const piGatewayArgs = mockState.constructorArgs.pi.find((entry) => {
    const env =
      typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
        ? Reflect.get(entry.runtimeSettings, "env")
        : undefined;
    return env?.OPENAI_BASE_URL === "http://127.0.0.1:6767/api/model-gateways/zai/v1";
  });
  expect(piGatewayArgs).toEqual({
    runtimeSettings: {
      command: undefined,
      env: {
        OPENAI_API_KEY: "internal-token",
        OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
      },
    },
  });

  const kimiGatewayArgs = mockState.constructorArgs.kimi.find((entry) => {
    const env =
      typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
        ? Reflect.get(entry.runtimeSettings, "env")
        : undefined;
    return env?.OPENAI_BASE_URL === "http://127.0.0.1:6767/api/model-gateways/zai/v1";
  });
  expect(kimiGatewayArgs).toEqual({
    runtimeSettings: {
      command: undefined,
      env: {
        OPENAI_API_KEY: "internal-token",
        OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
      },
    },
    providerId: "zai-kimi",
    label: "ZAI Kimi Code",
    models: [
      {
        id: "glm-5",
        label: "GLM 5",
        isDefault: true,
        contextWindowMaxTokens: 200_000,
        supportsImages: true,
      },
      { id: "glm-5-air", label: "GLM 5 Air" },
      {
        id: "moa-coder",
        label: "MoA Coder",
        description: "Synthetic coding model",
      },
    ],
  });

  const grokbuildGatewayArgs = mockState.constructorArgs.grokbuild.find((entry) => {
    const env =
      typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
        ? Reflect.get(entry.runtimeSettings, "env")
        : undefined;
    return env?.OPENAI_BASE_URL === "http://127.0.0.1:6767/api/model-gateways/zai/v1";
  });
  expect(grokbuildGatewayArgs).toEqual({
    runtimeSettings: {
      command: undefined,
      env: {
        OPENAI_API_KEY: "internal-token",
        OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        XAI_API_KEY: "internal-token",
        GROK_MODELS_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        GROK_DEFAULT_SELECTED_PERMISSION: "always_allow_all_sessions",
      },
    },
    providerId: "zai-grokbuild",
    label: "ZAI Grok Build",
    models: [
      {
        id: "glm-5",
        label: "GLM 5",
        isDefault: true,
        contextWindowMaxTokens: 200_000,
        supportsImages: true,
      },
      { id: "glm-5-air", label: "GLM 5 Air" },
      {
        id: "moa-coder",
        label: "MoA Coder",
        description: "Synthetic coding model",
      },
    ],
  });

  // dsh faces build lazily (see the createRegistryEntry lazy note); drive one
  // materialization explicitly instead of relying on cold-start construction.
  registry["zai-dsh"].createClient(logger);
  const dshGatewayArgs = mockState.constructorArgs.dsh.find((entry) => {
    const env =
      typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
        ? Reflect.get(entry.runtimeSettings, "env")
        : undefined;
    return env?.DEEPSEEK_BASE_URL === "http://127.0.0.1:6767/api/model-gateways/zai/v1";
  });
  expect(dshGatewayArgs).toMatchObject({
    providerId: "zai-dsh",
    label: "ZAI DeepSeek",
    runtimeSettings: {
      env: {
        DEEPSEEK_API_KEY: "internal-token",
        DEEPSEEK_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
      },
    },
  });
});

test("resolveGatewayAgentFaces narrows faces by protocolPreset", () => {
  expect(
    resolveGatewayAgentFaces({
      protocolPreset: "codex",
      upstreams: {
        responses: { enabled: true },
      },
    }),
  ).toEqual({
    claude: false,
    codex: true,
    opencode: false,
    pi: false,
    kimi: false,
    grokbuild: false,
    dsh: false,
  });

  expect(
    resolveGatewayAgentFaces({
      protocolPreset: "openai",
      attachToAllAgents: true,
    }),
  ).toEqual({
    claude: true,
    codex: true,
    opencode: true,
    pi: true,
    kimi: true,
    grokbuild: true,
    dsh: true,
  });

  expect(
    resolveGatewayAgentFaces({
      upstreams: {
        chatCompletions: { enabled: true },
      },
    }),
  ).toEqual({
    claude: false,
    codex: false,
    opencode: true,
    pi: true,
    kimi: true,
    grokbuild: true,
    dsh: true,
  });
});

const ALL_GATEWAY_FACES = {
  claude: true,
  codex: true,
  opencode: true,
  pi: true,
  kimi: true,
  grokbuild: true,
  dsh: true,
} as const;

test("resolveGatewayAgentFaces supplyScope all wins over preset and legacy fields", () => {
  for (const protocolPreset of ["claude", "codex", "openai", "all", undefined] as const) {
    expect(
      resolveGatewayAgentFaces({
        supplyScope: "all",
        protocolPreset,
        attachToAllAgents: false,
        upstreams: { responses: { enabled: true } },
      }),
    ).toEqual(ALL_GATEWAY_FACES);
  }
});

test("resolveGatewayAgentFaces supplyScope matched narrows by protocolPreset", () => {
  expect(resolveGatewayAgentFaces({ supplyScope: "matched", protocolPreset: "claude" })).toEqual({
    claude: true,
    codex: false,
    opencode: false,
    pi: false,
    kimi: false,
    grokbuild: false,
    dsh: false,
  });

  expect(resolveGatewayAgentFaces({ supplyScope: "matched", protocolPreset: "codex" })).toEqual({
    claude: false,
    codex: true,
    opencode: false,
    pi: false,
    kimi: false,
    grokbuild: false,
    dsh: false,
  });

  // openai + matched → the 4 OpenAI-family faces only
  expect(resolveGatewayAgentFaces({ supplyScope: "matched", protocolPreset: "openai" })).toEqual({
    claude: false,
    codex: false,
    opencode: true,
    pi: true,
    kimi: true,
    grokbuild: true,
    dsh: true,
  });

  // matched + preset "all" covers every protocol → all seven faces
  expect(resolveGatewayAgentFaces({ supplyScope: "matched", protocolPreset: "all" })).toEqual(
    ALL_GATEWAY_FACES,
  );
});

test("resolveGatewayAgentFaces supplyScope matched without preset falls back to upstream inference", () => {
  expect(
    resolveGatewayAgentFaces({
      supplyScope: "matched",
      upstreams: { chatCompletions: { enabled: true } },
    }),
  ).toEqual({
    claude: false,
    codex: false,
    opencode: true,
    pi: true,
    kimi: true,
    grokbuild: true,
    dsh: true,
  });

  expect(
    resolveGatewayAgentFaces({
      supplyScope: "matched",
      upstreams: {
        anthropic: { enabled: true },
        chatCompletions: { enabled: true },
      },
    }),
  ).toEqual(ALL_GATEWAY_FACES);
});

test("resolveGatewayAgentFaces supplyScope wins over conflicting attachToAllAgents", () => {
  // matched + attachToAllAgents=true → matched wins, single claude face
  expect(
    resolveGatewayAgentFaces({
      supplyScope: "matched",
      protocolPreset: "claude",
      attachToAllAgents: true,
    }),
  ).toEqual({
    claude: true,
    codex: false,
    opencode: false,
    pi: false,
    kimi: false,
    grokbuild: false,
    dsh: false,
  });

  // all + attachToAllAgents=false → all wins
  expect(
    resolveGatewayAgentFaces({
      supplyScope: "all",
      protocolPreset: "openai",
      attachToAllAgents: false,
    }),
  ).toEqual(ALL_GATEWAY_FACES);
});

test("matched openai supply scope materializes only the OpenAI-family candidate faces", () => {
  // Vision fallback and model pickers rely on the materialized face set; the
  // matched+openai scope must expose exactly the five OpenAI-family faces.
  const faces = resolveGatewayAgentFaces({ supplyScope: "matched", protocolPreset: "openai" });
  const providerIds = Object.entries(faces)
    .filter(([, enabled]) => enabled)
    .map(([face]) => `vision-${face}`);
  expect(providerIds).toEqual([
    "vision-opencode",
    "vision-pi",
    "vision-kimi",
    "vision-grokbuild",
    "vision-dsh",
  ]);
  expect(providerIds).not.toContain("vision-claude");
  expect(providerIds).not.toContain("vision-codex");
});

test("model gateway with codex protocolPreset only materializes codex face", async () => {
  const registry = buildProviderRegistry(logger, {
    modelGateways: {
      grok: {
        id: "grok",
        label: "Grok",
        enabled: true,
        protocolPreset: "codex",
        models: [
          {
            id: "grok-4.5",
            label: "grok-4.5",
            thinkingOptions: [
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium", isDefault: true },
              { id: "high", label: "High" },
            ],
          },
        ],
        upstreams: {
          anthropic: { enabled: false, baseUrl: "", apiKey: "" },
          chatCompletions: { enabled: false, baseUrl: "", apiKey: "" },
          responses: {
            enabled: true,
            baseUrl: "https://api.x.ai/v1",
            apiKey: "sk-xai",
          },
        },
      },
    },
    modelGatewayBaseUrl: "http://127.0.0.1:6767",
    modelGatewayToken: "internal-token",
  });

  expect(registry["grok-codex"]).toBeDefined();
  expect(registry["grok-claude"]).toBeUndefined();
  expect(registry["grok-opencode"]).toBeUndefined();
  expect(registry["grok-pi"]).toBeUndefined();
  expect(registry["grok-kimi"]).toBeUndefined();
});

test("new provider extending acp uses GenericACPAgentClient", () => {
  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      "my-agent": {
        extends: "acp",
        label: "My Agent",
        command: ["my-agent", "--acp"],
        env: {
          ACP_TOKEN: "secret",
        },
      },
    },
  });

  expect(registry["my-agent"].createClient(logger).provider).toBe("my-agent");
  expect(mockState.constructorArgs.genericAcp).toEqual([
    {
      command: ["my-agent", "--acp"],
      env: {
        ACP_TOKEN: "secret",
      },
      providerId: "my-agent",
      label: "My Agent",
    },
    {
      command: ["my-agent", "--acp"],
      env: {
        ACP_TOKEN: "secret",
      },
      providerId: "my-agent",
      label: "My Agent",
    },
  ]);
});

test('extends: "acp" without command throws', () => {
  expect(() =>
    buildProviderRegistry(logger, {
      providerOverrides: {
        "my-agent": {
          extends: "acp",
          label: "My Agent",
        },
      },
    }),
  ).toThrowError("ACP provider 'my-agent' requires a command");
});

test("custom provider without label throws", () => {
  expect(() =>
    buildProviderRegistry(logger, {
      providerOverrides: {
        zai: {
          extends: "claude",
        },
      },
    }),
  ).toThrowError("Custom provider 'zai' requires a label");
});

test("enabled: false keeps provider metadata in registry", () => {
  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      claude: {
        enabled: false,
      },
    },
  });

  expect(registry.claude).toMatchObject({
    id: "claude",
    label: "Claude",
    description: "Anthropic's multi-tool assistant with MCP support, streaming, and deep reasoning",
    defaultModeId: "default",
    enabled: false,
  });
  expect(registry.claude.modes).toEqual(
    AGENT_PROVIDER_DEFINITIONS.find((definition) => definition.id === "claude")?.modes,
  );
  expect(registry.codex.enabled).toBe(true);
});

test("enabled: false still produces a client (enabled gate is enforced elsewhere)", () => {
  const clients = createAllClients(logger, {
    providerOverrides: {
      claude: {
        enabled: false,
      },
    },
  });

  expect(clients.claude).toBeDefined();
  expect(mockState.constructorArgs.claude.length).toBeGreaterThan(0);
  expect(clients.codex).toBeDefined();
});

test("provider override command can be PATH-resolved and still report available", async () => {
  mockState.isCommandAvailable.mockResolvedValue(true);

  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      claude: {
        command: ["claude", "--flag"],
      },
    },
  });

  await expect(registry.claude.createClient(logger).isAvailable()).resolves.toBe(true);
  expect(mockState.isCommandAvailable).toHaveBeenCalledWith("claude");
});

test("disallowedTools flows through to runtime settings", () => {
  buildProviderRegistry(logger, {
    providerOverrides: {
      claude: {
        disallowedTools: ["WebSearch", "WebFetch"],
      },
    },
  });

  expect(mockState.constructorArgs.claude[0]).toEqual({
    runtimeSettings: {
      command: undefined,
      env: undefined,
      disallowedTools: ["WebSearch", "WebFetch"],
    },
  });
});

test("derived provider inherits and merges disallowedTools from base", () => {
  buildProviderRegistry(logger, {
    providerOverrides: {
      claude: {
        disallowedTools: ["WebSearch"],
      },
      zai: {
        extends: "claude",
        label: "ZAI",
        disallowedTools: ["ComputerUse"],
      },
    },
  });

  const zaiArgs = mockState.constructorArgs.claude.find((entry) => {
    const disallowedTools: string[] | undefined =
      typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
        ? Reflect.get(entry.runtimeSettings, "disallowedTools")
        : undefined;
    return Array.isArray(disallowedTools) && disallowedTools.includes("ComputerUse");
  });
  expect(zaiArgs).toBeDefined();
  const zaiDisallowedTools: string[] =
    typeof zaiArgs!.runtimeSettings === "object" && zaiArgs!.runtimeSettings !== null
      ? Reflect.get(zaiArgs!.runtimeSettings, "disallowedTools")
      : [];
  expect(zaiDisallowedTools).toEqual(["WebSearch", "ComputerUse"]);
});

test("extension inherits base override — override claude command, zai extends claude gets overridden command", () => {
  buildProviderRegistry(logger, {
    providerOverrides: {
      claude: {
        command: ["/opt/custom-claude"],
      },
      zai: {
        extends: "claude",
        label: "ZAI",
      },
    },
  });

  expect(mockState.constructorArgs.claude).toHaveLength(2);
  expect(
    mockState.constructorArgs.claude.every((entry) => {
      const command: { argv?: string[] } | undefined =
        typeof entry.runtimeSettings === "object" && entry.runtimeSettings !== null
          ? Reflect.get(entry.runtimeSettings, "command")
          : undefined;
      return command?.argv?.[0] === "/opt/custom-claude";
    }),
  ).toBe(true);
});

describe("model merging", () => {
  test("profile models replace runtime models", async () => {
    mockState.runtimeModels.set("codex", [
      {
        provider: "codex",
        id: "runtime-pro",
        label: "Runtime Pro",
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        codex: {
          models: [
            {
              id: "profile-fast",
              label: "Profile Fast",
            },
          ],
        },
      },
    });

    const models = await registry.codex.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models.map((model) => model.id)).toEqual(["profile-fast"]);
  });

  test("profile models exclude runtime models entirely", async () => {
    mockState.runtimeModels.set("codex", [
      {
        provider: "codex",
        id: "shared-model",
        label: "Runtime Label",
      },
      {
        provider: "codex",
        id: "runtime-only",
        label: "Runtime Only",
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        codex: {
          models: [
            {
              id: "shared-model",
              label: "Profile Label",
            },
          ],
        },
      },
    });

    const models = await registry.codex.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models).toEqual([
      {
        provider: "codex",
        id: "shared-model",
        label: "Profile Label",
      },
    ]);
  });

  test("profile isDefault preserved without runtime models", async () => {
    mockState.runtimeModels.set("codex", [
      {
        provider: "codex",
        id: "runtime-default",
        label: "Runtime Default",
        isDefault: true,
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        codex: {
          models: [
            {
              id: "profile-default",
              label: "Profile Default",
              isDefault: true,
            },
          ],
        },
      },
    });

    const models = await registry.codex.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models).toEqual([
      {
        provider: "codex",
        id: "profile-default",
        label: "Profile Default",
        isDefault: true,
      },
    ]);
  });

  test("profile thinking option default is normalized onto the model", async () => {
    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        codex: {
          models: [
            {
              id: "profile-default",
              label: "Profile Default",
              isDefault: true,
              thinkingOptions: [
                { id: "off", label: "Off" },
                { id: "max", label: "Max", isDefault: true },
              ],
            },
          ],
        },
      },
    });

    const models = await registry.codex.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models).toEqual([
      {
        provider: "codex",
        id: "profile-default",
        label: "Profile Default",
        isDefault: true,
        thinkingOptions: [
          { id: "off", label: "Off" },
          { id: "max", label: "Max", isDefault: true },
        ],
        defaultThinkingOptionId: "max",
      },
    ]);
  });

  test("additional models append to runtime models", async () => {
    mockState.runtimeModels.set("claude", [
      {
        provider: "claude",
        id: "runtime-pro",
        label: "Runtime Pro",
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        claude: {
          additionalModels: [
            {
              id: "profile-fast",
              label: "Profile Fast",
            },
          ],
        },
      },
    });

    const models = await registry.claude.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models).toEqual([
      {
        provider: "claude",
        id: "runtime-pro",
        label: "Runtime Pro",
      },
      {
        provider: "claude",
        id: "profile-fast",
        label: "Profile Fast",
      },
    ]);
  });

  test("built-in Claude profile models append to runtime models", async () => {
    mockState.runtimeModels.set("claude", [
      {
        provider: "claude",
        id: "runtime-model",
        label: "Runtime Model",
      },
      {
        provider: "claude",
        id: "shared-model",
        label: "Runtime Label",
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        claude: {
          models: [
            {
              id: "shared-model",
              label: "Profile Label",
            },
            {
              id: "profile-model",
              label: "Profile Model",
            },
          ],
        },
      },
    });

    const models = await registry.claude.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models).toEqual([
      {
        provider: "claude",
        id: "runtime-model",
        label: "Runtime Model",
      },
      {
        provider: "claude",
        id: "shared-model",
        label: "Profile Label",
      },
      {
        provider: "claude",
        id: "profile-model",
        label: "Profile Model",
      },
    ]);
  });

  test("additional models merge onto profile replacement models", async () => {
    mockState.runtimeModels.set("codex", [
      {
        provider: "codex",
        id: "runtime-pro",
        label: "Runtime Pro",
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        codex: {
          models: [
            {
              id: "profile-curated",
              label: "Profile Curated",
            },
          ],
          additionalModels: [
            {
              id: "profile-extra",
              label: "Profile Extra",
            },
          ],
        },
      },
    });

    const models = await registry.codex.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models.map((model) => model.id)).toEqual(["profile-curated", "profile-extra"]);
  });

  test("additional models override matching runtime models in place", async () => {
    mockState.runtimeModels.set("claude", [
      {
        provider: "claude",
        id: "shared-model",
        label: "Runtime Label",
        description: "Runtime description",
        metadata: {
          source: "runtime",
        },
      },
      {
        provider: "claude",
        id: "runtime-only",
        label: "Runtime Only",
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        claude: {
          additionalModels: [
            {
              id: "shared-model",
              label: "Profile Label",
            },
          ],
        },
      },
    });

    const models = await registry.claude.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models).toEqual([
      {
        provider: "claude",
        id: "shared-model",
        label: "Profile Label",
        description: "Runtime description",
        metadata: {
          source: "runtime",
        },
      },
      {
        provider: "claude",
        id: "runtime-only",
        label: "Runtime Only",
      },
    ]);
  });

  test("additional model default overrides runtime default", async () => {
    mockState.runtimeModels.set("claude", [
      {
        provider: "claude",
        id: "runtime-default",
        label: "Runtime Default",
        isDefault: true,
      },
      {
        provider: "claude",
        id: "runtime-other",
        label: "Runtime Other",
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        claude: {
          additionalModels: [
            {
              id: "profile-default",
              label: "Profile Default",
              isDefault: true,
            },
          ],
        },
      },
    });

    const models = await registry.claude.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models).toEqual([
      {
        provider: "claude",
        id: "runtime-default",
        label: "Runtime Default",
        isDefault: false,
      },
      {
        provider: "claude",
        id: "runtime-other",
        label: "Runtime Other",
        isDefault: false,
      },
      {
        provider: "claude",
        id: "profile-default",
        label: "Profile Default",
        isDefault: true,
      },
    ]);
  });

  test("no profile models — runtime models returned as-is", async () => {
    mockState.runtimeModels.set("claude", [
      {
        provider: "claude",
        id: "runtime-default",
        label: "Runtime Default",
        isDefault: true,
      },
    ]);

    const registry = buildProviderRegistry(logger);
    const models = await registry.claude.fetchModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models).toEqual([
      {
        provider: "claude",
        id: "runtime-default",
        label: "Runtime Default",
        isDefault: true,
      },
    ]);
  });

  test("built-in createClient().listModels() honors profile model replacement (issue #579)", async () => {
    mockState.runtimeModels.set("codex", [
      {
        provider: "codex",
        id: "runtime-default",
        label: "Runtime Default",
        isDefault: true,
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        codex: {
          models: [
            {
              id: "profile-fast",
              label: "Profile Fast",
              isDefault: true,
            },
          ],
        },
      },
    });

    const client = registry.codex.createClient(logger);
    const models = await client.listModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    expect(models.map((model) => model.id)).toEqual(["profile-fast"]);
    expect(models.find((model) => model.isDefault)?.id).toBe("profile-fast");
  });

  test("built-in createClient().listModels() honors additionalModels default (issue #579)", async () => {
    mockState.runtimeModels.set("claude", [
      {
        provider: "claude",
        id: "runtime-default",
        label: "Runtime Default",
        isDefault: true,
      },
    ]);

    const registry = buildProviderRegistry(logger, {
      providerOverrides: {
        claude: {
          additionalModels: [
            {
              id: "profile-default",
              label: "Profile Default",
              isDefault: true,
            },
          ],
        },
      },
    });

    const client = registry.claude.createClient(logger);
    const models = await client.listModels({
      cwd: "/tmp/registry-models",
      force: false,
    });

    const defaultModel = models.find((model) => model.isDefault) ?? models[0];
    expect(defaultModel?.id).toBe("profile-default");
  });
});
