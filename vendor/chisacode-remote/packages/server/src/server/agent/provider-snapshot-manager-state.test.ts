import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  AgentClient,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ListModelsOptions,
  ListModesOptions,
} from "./agent-sdk-types.js";
import { ProviderSnapshotManager, resolveSnapshotCwd } from "./provider-snapshot-manager.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

const testState = vi.hoisted(() => {
  type ModelLoader = (options: ListModelsOptions) => Promise<AgentModelDefinition[]>;
  type ModeLoader = (options: ListModesOptions) => Promise<AgentMode[]>;

  const state: {
    availability: Map<string, () => Promise<boolean>>;
    models: Map<string, ModelLoader>;
    modes: Map<string, ModeLoader>;
    createdClients: Array<AgentClient & { shutdown: ReturnType<typeof vi.fn> }>;
    toolingInfo: () => Promise<Record<string, unknown>>;
    reset: () => void;
  } = {
    availability: new Map(),
    models: new Map(),
    modes: new Map(),
    createdClients: [],
    toolingInfo: async () => ({
      packageName: "test-provider",
      installedVersion: null,
      latestVersion: null,
      versionStatus: "unknown",
      checkedAt: "2026-01-01T00:00:00.000Z",
      installAvailable: false,
      updateAvailable: false,
    }),
    reset() {
      this.availability.clear();
      this.models.clear();
      this.modes.clear();
      this.createdClients.length = 0;
      this.toolingInfo = async () => ({
        packageName: "test-provider",
        installedVersion: null,
        latestVersion: null,
        versionStatus: "unknown",
        checkedAt: "2026-01-01T00:00:00.000Z",
        installAvailable: false,
        updateAvailable: false,
      });
    },
  };
  return state;
});

vi.mock("./provider-tooling.js", () => ({
  getProviderToolingDefinition: vi.fn(() => ({
    binary: "test-provider",
    packageName: "test-provider",
    installArgs: [],
  })),
  getProviderToolingInfo: vi.fn(() => testState.toolingInfo()),
  runProviderToolingAction: vi.fn(),
}));

function createShutdownSpy() {
  return vi.fn(async () => undefined);
}

function createTestClient(provider: string, shutdown: ReturnType<typeof vi.fn>) {
  return {
    provider,
    capabilities: {
      supportsStreaming: false,
      supportsSessionPersistence: false,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    async createSession() {
      throw new Error("not implemented");
    },
    async resumeSession() {
      throw new Error("not implemented");
    },
    async listModels(_options: ListModelsOptions) {
      return await (testState.models.get(provider)?.(_options) ?? Promise.resolve([]));
    },
    async isAvailable() {
      return await (testState.availability.get(provider)?.() ?? Promise.resolve(true));
    },
    shutdown,
  } as AgentClient & { shutdown: ReturnType<typeof vi.fn> };
}

function createTestClientFactory(provider: string) {
  return () => {
    const client = createTestClient(provider, createShutdownSpy());
    testState.createdClients.push(client);
    return client;
  };
}

vi.mock("./provider-registry.js", () => ({
  buildProviderRegistry: vi.fn(
    (_logger: unknown, options?: { providerOverrides?: Record<string, { enabled?: boolean }> }) => {
      const providerIds = ["codex", "pi"];
      return Object.fromEntries(
        providerIds.map((provider) => [
          provider,
          {
            id: provider,
            label: provider,
            description: `${provider} test provider`,
            defaultModeId: null,
            modes: [],
            enabled: options?.providerOverrides?.[provider]?.enabled !== false,
            runtimeSettings: undefined,
            derivedFromProviderId: null,
            modelGatewayId: null,
            createClient: createTestClientFactory(provider),
            resolveCreateConfig: () => ({ modeId: undefined, featureValues: undefined }),
            isCreateConfigUnattended: () => false,
            fetchModels: (input: ListModelsOptions) =>
              testState.models.get(provider)?.(input) ?? Promise.resolve([]),
            fetchModes: (input: ListModesOptions) =>
              testState.modes.get(provider)?.(input) ?? Promise.resolve([]),
          },
        ]),
      );
    },
  ),
  shutdownAgentClients: vi.fn(async (clients: Iterable<AgentClient>, _logger: unknown) => {
    await Promise.all(
      Array.from(clients, async (client) => {
        await client.shutdown?.();
      }),
    );
  }),
}));

function model(provider: AgentProvider, id: string): AgentModelDefinition {
  return { provider, id, label: id };
}

function configureSuccessfulProvider(provider: string, models: AgentModelDefinition[] = []): void {
  testState.availability.set(provider, async () => true);
  testState.models.set(provider, async () => models);
  testState.modes.set(provider, async () => []);
}

function createManager(options: ConstructorParameters<typeof ProviderSnapshotManager>[0] = {}) {
  return new ProviderSnapshotManager({ logger: createTestLogger(), ...options });
}

function findProvider(
  entries: Awaited<ReturnType<ProviderSnapshotManager["listProviders"]>>,
  provider: string,
) {
  return entries.find((entry) => entry.provider === provider);
}

function getModelIds(
  entry: Awaited<ReturnType<ProviderSnapshotManager["listProviders"]>>[number] | undefined,
): string[] | undefined {
  return entry?.models?.map((item) => item.id);
}

describe("ProviderSnapshotManager terminal state contract", () => {
  beforeEach(() => {
    testState.reset();
  });

  test("reports ready with an explicitly empty model list", async () => {
    configureSuccessfulProvider("codex", []);
    const manager = createManager();
    try {
      const [entry] = await manager.listProviders({ cwd: "/workspace/project", wait: true });
      expect(entry).toMatchObject({
        provider: "codex",
        status: "ready",
        statusReason: undefined,
        models: [],
      });
    } finally {
      manager.destroy();
    }
  });

  test("separates command absence from runtime availability failures", async () => {
    testState.availability.set("codex", async () => false);
    testState.availability.set("pi", async () => {
      throw new Error("runtime failed");
    });
    const manager = createManager();
    try {
      const entries = await manager.listProviders({ cwd: "/workspace/project", wait: true });
      expect(entries.find((entry) => entry.provider === "codex")).toMatchObject({
        status: "unavailable",
        statusReason: "command_unavailable",
      });
      expect(entries.find((entry) => entry.provider === "pi")).toMatchObject({
        status: "error",
        statusReason: "runtime_unavailable",
        error: "runtime failed",
      });
    } finally {
      manager.destroy();
    }
  });

  test("reports model discovery failure separately from runtime failure", async () => {
    testState.availability.set("codex", async () => true);
    testState.models.set("codex", async () => {
      throw new Error("model endpoint rejected request");
    });
    testState.modes.set("codex", async () => []);
    const manager = createManager();
    try {
      const entry = (await manager.listProviders({ cwd: "/workspace/project", wait: true })).find(
        (candidate) => candidate.provider === "codex",
      );
      expect(entry).toMatchObject({
        status: "error",
        statusReason: "model_discovery_failed",
        error: "model endpoint rejected request",
      });
    } finally {
      manager.destroy();
    }
  });

  test("reports refresh timeouts with a refresh_failed reason", async () => {
    testState.availability.set("codex", async () => true);
    testState.models.set("codex", () => new Promise<AgentModelDefinition[]>(() => undefined));
    testState.modes.set("codex", async () => []);
    const manager = createManager({ refreshTimeoutMs: 10 });
    try {
      const entry = (await manager.listProviders({ cwd: "/workspace/project", wait: true })).find(
        (candidate) => candidate.provider === "codex",
      );
      expect(entry).toMatchObject({ status: "error", statusReason: "refresh_failed" });
      expect(entry?.error).toContain("Timed out refreshing");
    } finally {
      manager.destroy();
    }
  });

  test("retains last-good models and fetchedAt when refresh fails", async () => {
    const firstModel = model("codex", "first");
    configureSuccessfulProvider("codex", [firstModel]);
    const manager = createManager();
    try {
      const cwd = "/workspace/project";
      const first = (await manager.listProviders({ cwd, wait: true })).find(
        (entry) => entry.provider === "codex",
      );
      testState.models.set("codex", async () => {
        throw new Error("refresh rejected");
      });
      await manager.refreshSnapshotForCwd({ cwd, providers: ["codex"] });
      const after = (await manager.listProviders({ cwd })).find(
        (entry) => entry.provider === "codex",
      );
      expect(after).toMatchObject({
        status: "error",
        statusReason: "model_discovery_failed",
        models: [firstModel],
        fetchedAt: first?.fetchedAt,
      });
    } finally {
      manager.destroy();
    }
  });
});

describe("ProviderSnapshotManager load lifecycle", () => {
  beforeEach(() => {
    testState.reset();
  });

  test("isolates listener failures", async () => {
    configureSuccessfulProvider("codex", []);
    const manager = createManager();
    const first = vi.fn(() => {
      throw new Error("listener failed");
    });
    const second = vi.fn();
    manager.on("change", first);
    manager.on("change", second);
    try {
      await manager.refreshSnapshotForCwd({ cwd: "/workspace/project", providers: ["codex"] });
      expect(first).toHaveBeenCalled();
      expect(second).toHaveBeenCalled();
    } finally {
      manager.destroy();
    }
  });

  test("latest forced refresh wins over an older load", async () => {
    configureSuccessfulProvider("codex", []);
    const first = deferred<AgentModelDefinition[]>();
    const second = deferred<AgentModelDefinition[]>();
    let call = 0;
    testState.models.set("codex", async () => {
      call += 1;
      return call === 1 ? first.promise : second.promise;
    });
    testState.modes.set("codex", async () => []);
    const manager = createManager();
    try {
      const cwd = "/workspace/project";
      manager.getSnapshot(cwd);
      await vi.waitFor(() => expect(call).toBe(1));
      const refresh = manager.refreshSnapshotForCwd({ cwd, providers: ["codex"] });
      await vi.waitFor(() => expect(call).toBe(2));
      second.resolve([model("codex", "new")]);
      await refresh;
      first.resolve([model("codex", "old")]);
      await vi.waitFor(async () => {
        const entries = await manager.listProviders({ cwd });
        const entry = findProvider(entries, "codex");
        const modelIds = getModelIds(entry);
        expect(modelIds).toEqual(["new"]);
      });
    } finally {
      manager.destroy();
    }
  });

  test("drops a late tooling result after destroy", async () => {
    configureSuccessfulProvider("codex", [model("codex", "one")]);
    const tooling = deferred<Record<string, unknown>>();
    testState.toolingInfo = () => tooling.promise;
    const manager = createManager();
    const loading = manager.listProviders({ cwd: "/workspace/project", wait: true });
    await vi.waitFor(() => expect(testState.createdClients.length).toBeGreaterThan(0));
    manager.destroy();
    tooling.resolve({ packageName: "late", versionStatus: "current" });
    await expect(loading).resolves.toEqual([]);
  });

  test("refreshes every established scope and retains scope isolation", async () => {
    const calls: string[] = [];
    testState.availability.set("codex", async () => true);
    testState.models.set("codex", async (input) => {
      calls.push(input.cwd ?? "missing");
      return [];
    });
    testState.modes.set("codex", async () => []);
    const manager = createManager();
    try {
      await manager.listProviders({ cwd: "/workspace/project", wait: true });
      await manager.listProviders({ cwd: "/workspace/other", wait: true });
      calls.length = 0;
      await manager.refreshSettingsSnapshot({ providers: ["codex"] });
      expect(calls.sort()).toEqual(
        [
          resolveSnapshotCwd(),
          resolveSnapshotCwd("/workspace/project"),
          resolveSnapshotCwd("/workspace/other"),
        ].sort(),
      );
    } finally {
      manager.destroy();
    }
  });

  test("shuts down clients replaced by mutable provider configuration", async () => {
    configureSuccessfulProvider("codex", []);
    const manager = createManager();
    try {
      await manager.getAgentManagerProviderState();
      const previous = testState.createdClients[0];
      expect(previous).toBeDefined();
      manager.applyMutableProviderConfig({ codex: { enabled: false } });
      await vi.waitFor(() => expect(previous?.shutdown).toHaveBeenCalledTimes(1));
    } finally {
      manager.destroy();
    }
  });

  test("moves providers through disabled and configuration_changed states", async () => {
    configureSuccessfulProvider("codex", []);
    const manager = createManager();
    try {
      await manager.listProviders({ cwd: "/workspace/project", wait: true });
      manager.applyMutableProviderConfig({ codex: { enabled: false } });
      expect(
        (await manager.listProviders({ cwd: "/workspace/project" })).find(
          (entry) => entry.provider === "codex",
        ),
      ).toMatchObject({
        status: "unavailable",
        statusReason: "disabled",
        enabled: false,
      });
      manager.applyMutableProviderConfig({ codex: { enabled: true } });
      expect(
        (await manager.listProviders({ cwd: "/workspace/project" })).find(
          (entry) => entry.provider === "codex",
        ),
      ).toMatchObject({
        status: "loading",
        statusReason: "configuration_changed",
        enabled: true,
      });
      await manager.warmUpSnapshotForCwd({ cwd: "/workspace/project", providers: ["codex"] });
      expect(
        (await manager.listProviders({ cwd: "/workspace/project" })).find(
          (entry) => entry.provider === "codex",
        ),
      ).toMatchObject({
        status: "ready",
        models: [],
      });
    } finally {
      manager.destroy();
    }
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
