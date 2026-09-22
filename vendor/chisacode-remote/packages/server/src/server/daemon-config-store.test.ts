import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { DaemonConfigStore, applyMutableProviderConfigToOverrides } from "./daemon-config-store.js";
import { loadPersistedConfig } from "./persisted-config.js";

describe("applyMutableProviderConfigToOverrides", () => {
  test("merges mutable provider fields onto provider overrides", () => {
    expect(
      applyMutableProviderConfigToOverrides(
        {
          gemini: {
            extends: "acp",
            label: "Gemini",
            command: ["gemini", "--acp"],
          },
        },
        {
          gemini: {
            enabled: false,
            description: "Gemini ACP",
            env: { GEMINI_AUTO_UPDATE: "0" },
          },
          claude: {
            additionalModels: [
              {
                id: "claude-custom",
                label: "claude-custom",
              },
            ],
          },
        },
      ),
    ).toEqual({
      gemini: {
        extends: "acp",
        label: "Gemini",
        description: "Gemini ACP",
        command: ["gemini", "--acp"],
        env: { GEMINI_AUTO_UPDATE: "0" },
        enabled: false,
      },
      claude: {
        additionalModels: [
          {
            id: "claude-custom",
            label: "claude-custom",
          },
        ],
      },
    });
  });
});

describe("DaemonConfigStore", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("patch persists provider enabled flags into config.json", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const initial = loadPersistedConfig(chisacodeHome);
    const configPath = path.join(chisacodeHome, "config.json");
    // Reuse the validated serializer through the store path by seeding the file directly.
    // This keeps the test focused on the merge behavior.
    const seeded =
      JSON.stringify(
        {
          ...initial,
          agents: {
            providers: {
              gemini: {
                extends: "acp",
                label: "Gemini",
                command: ["gemini", "--acp"],
              },
            },
          },
        },
        null,
        2,
      ) + "\n";
    writeFileSync(configPath, seeded);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      providers: {
        gemini: { enabled: false },
      },
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.agents?.providers?.gemini).toEqual({
      extends: "acp",
      label: "Gemini",
      command: ["gemini", "--acp"],
      enabled: false,
    });
  });

  test("patch persists append system prompt into config.json", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      appendSystemPrompt: "Prefer terse replies.",
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.daemon?.appendSystemPrompt).toBe("Prefer terse replies.");
  });

  test("patch persists provider additional models into config.json", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      providers: {
        claude: {
          additionalModels: [
            {
              id: "claude-custom",
              label: "claude-custom",
            },
          ],
        },
      },
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.agents?.providers?.claude).toEqual({
      additionalModels: [
        {
          id: "claude-custom",
          label: "claude-custom",
        },
      ],
    });
  });

  test("patch persists daemon append system prompt into config.json", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      appendSystemPrompt: "Prefer terse replies.",
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.daemon?.appendSystemPrompt).toBe("Prefer terse replies.");
  });

  test("patch persists metadata generation providers into config.json", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
      },
      undefined,
    );

    store.patch({
      metadataGeneration: {
        providers: [
          { provider: "claude", model: "haiku" },
          { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
        ],
      },
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.agents?.metadataGeneration).toEqual({
      providers: [
        { provider: "claude", model: "haiku" },
        { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
      ],
    });
  });

  test("patch persists clearing metadata generation providers into config.json", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const configPath = path.join(chisacodeHome, "config.json");
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          agents: {
            metadataGeneration: {
              providers: [{ provider: "claude", model: "haiku" }],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [{ provider: "claude", model: "haiku" }] },
      },
      undefined,
    );

    store.patch({ metadataGeneration: { providers: [] } });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.agents?.metadataGeneration).toEqual({ providers: [] });
  });

  test("patch persists model gateways into config.json", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        modelGateways: {},
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [] },
      },
      undefined,
    );

    store.patch({
      modelGateways: {
        zai: {
          id: "zai",
          label: "ZAI",
          enabled: true,
          models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
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
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.agents?.modelGateways?.zai).toEqual({
      id: "zai",
      label: "ZAI",
      syntheticModels: [],
      enabled: true,
      models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
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
    });
  });

  test("patch persists custom ACP provider overrides into config.json", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [] },
      },
      undefined,
    );

    store.patch({
      providers: {
        "chisacode-e2e-acp": {
          extends: "acp",
          label: "ChisaCode E2E ACP",
          description: "E2E ACP provider fixture",
          command: ["npx", "-y", "--version"],
          env: {},
        },
      },
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.agents?.providers?.["chisacode-e2e-acp"]).toEqual({
      extends: "acp",
      label: "ChisaCode E2E ACP",
      description: "E2E ACP provider fixture",
      command: ["npx", "-y", "--version"],
      env: {},
    });
  });

  test("deepMerge keeps existing gateway keys when the patch omits them", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        modelGateways: {},
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [] },
      },
      undefined,
    );

    store.patch({
      modelGateways: {
        zai: {
          id: "zai",
          label: "ZAI",
          enabled: true,
          supplyScope: "all",
          models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
          upstreams: {
            anthropic: { enabled: false, baseUrl: "", apiKey: "" },
            chatCompletions: { enabled: true, baseUrl: "https://api.z.ai/v1", apiKey: "sk" },
            responses: { enabled: false, baseUrl: "", apiKey: "" },
          },
        },
      },
    });

    // Patch that omits supplyScope must not resurrect or clear it.
    store.patch({
      modelGateways: {
        zai: {
          models: [
            { id: "glm-5", label: "GLM 5", isDefault: true },
            { id: "glm-5-air", label: "GLM 5 Air" },
          ],
        },
      },
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.agents?.modelGateways?.zai?.supplyScope).toBe("all");
    expect(persisted.agents?.modelGateways?.zai?.models).toHaveLength(2);
  });

  test("always-written supplyScope overrides the stale legacy value", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        modelGateways: {},
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [] },
      },
      undefined,
    );

    // Legacy config: attachToAllAgents=true with no supplyScope.
    store.patch({
      modelGateways: {
        zai: {
          id: "zai",
          label: "ZAI",
          enabled: true,
          attachToAllAgents: true,
          models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
          upstreams: {
            anthropic: { enabled: false, baseUrl: "", apiKey: "" },
            chatCompletions: { enabled: true, baseUrl: "https://api.z.ai/v1", apiKey: "sk" },
            responses: { enabled: false, baseUrl: "", apiKey: "" },
          },
        },
      },
    });

    // New write path always writes supplyScope so the scope actually flips.
    store.patch({
      modelGateways: {
        zai: {
          supplyScope: "matched",
        },
      },
    });

    const persisted = loadPersistedConfig(chisacodeHome);
    expect(persisted.agents?.modelGateways?.zai?.supplyScope).toBe("matched");
  });

  test("commit short-circuits without notifying when the patch changes nothing", () => {
    const chisacodeHome = mkdtempSync(path.join(tmpdir(), "chisacode-daemon-config-store-"));
    tempDirs.push(chisacodeHome);

    const store = new DaemonConfigStore(
      chisacodeHome,
      {
        mcp: { injectIntoAgents: false },
        providers: {},
        modelGateways: {},
        autoArchiveAfterMerge: false,
        appendSystemPrompt: "",
        metadataGeneration: { providers: [] },
      },
      undefined,
    );

    let notifications = 0;
    store.onChange(() => {
      notifications += 1;
    });

    store.patch({ appendSystemPrompt: "" });
    expect(notifications).toBe(0);

    store.patch({ appendSystemPrompt: "Prefer terse replies." });
    expect(notifications).toBe(1);

    store.patch({ appendSystemPrompt: "Prefer terse replies." });
    expect(notifications).toBe(1);
  });
});
