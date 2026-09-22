/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";

const { theme, configState, snapshotState, patchConfigMock, refreshMock, errorLogger, clientMock } =
  vi.hoisted(() => ({
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
      iconSize: { sm: 14, md: 18 },
      fontSize: { xs: 11, sm: 13 },
      fontWeight: { medium: "500" },
      borderRadius: { full: 999, lg: 8 },
      opacity: { 50: 0.5 },
      glass: { enabled: false },
      shadow: { sm: {}, md: {}, lg: {} },
      colors: {
        surface1: "#111",
        surface2: "#222",
        foreground: "#fff",
        foregroundMuted: "#aaa",
        border: "#555",
        destructive: "#f00",
        success: "#0f0",
      },
    },
    configState: {
      config: null as MutableDaemonConfig | null,
    },
    snapshotState: {
      entries: undefined as ProviderSnapshotEntry[] | undefined,
    },
    patchConfigMock: vi.fn<(patch?: unknown) => Promise<MutableDaemonConfig | undefined>>(
      async () => undefined,
    ),
    refreshMock: vi.fn<(providerIds?: string[]) => Promise<void>>(async () => undefined),
    errorLogger: { error: vi.fn() },
    clientMock: {
      runModelGatewayTest: vi.fn(async () => ({
        requestId: "test-request",
        gatewayId: "zai",
        modelId: "glm-5",
        result: { ok: true, durationMs: 42, status: 200, error: null },
        error: null,
      })),
    },
  }));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string; style?: unknown }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  TextInput: ({
    value,
    onChangeText,
    placeholder,
  }: {
    value?: string;
    onChangeText?: (value: string) => void;
    placeholder?: string;
  }) =>
    React.createElement("input", {
      value,
      placeholder,
      onInput: (event: React.FormEvent<HTMLInputElement>) =>
        onChangeText?.((event.target as HTMLInputElement).value),
    }),
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityLabel,
    testID,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    onPress?: (event: React.MouseEvent) => void;
    disabled?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        role: accessibilityRole,
        "aria-label": accessibilityLabel,
        "data-testid": testID,
        disabled,
        onClick: disabled ? undefined : onPress,
      },
      typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
    ),
  Alert: { alert: vi.fn() },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: React.ComponentType<Record<string, unknown>>) => {
    return function ThemedComponent(props: Record<string, unknown>) {
      const mapped =
        typeof props.uniProps === "function"
          ? (props.uniProps as (value: typeof theme) => Record<string, unknown>)(theme)
          : {};
      return React.createElement(Component, { ...props, ...mapped });
    };
  },
  UnistylesRuntime: { pixelRatio: 1 },
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    Brain: icon("Brain"),
    Pencil: icon("Pencil"),
    Plus: icon("Plus"),
    Trash2: icon("Trash2"),
    Zap: icon("Zap"),
  };
});

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => clientMock,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: { sessions: Record<string, unknown> }) => unknown) =>
    selector({
      sessions: {
        "server-1": { serverInfo: { features: { modelGatewaySupplyScope: true } } },
      },
    }),
}));

vi.mock("@/constants/platform", () => ({ isWeb: true }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const model = params?.model ?? "";
      const translations: Record<string, string> = {
        "common.cancel": "Cancel",
        "common.delete": "Delete",
        "common.save": "Save",
        "customModelProviders.add": "Add",
        "customModelProviders.addCustomModel": "Add model",
        "customModelProviders.addModel": "Add model",
        "customModelProviders.advanced": "Advanced",
        "customModelProviders.apiKey": "API Key",
        "customModelProviders.apiKeyPlaceholder": "Enter your API key",
        "customModelProviders.baseUrl": "Endpoint URL",
        "customModelProviders.contextDefault": "Default",
        "customModelProviders.customBadge": "Custom",
        "customModelProviders.customProtocol": "Custom protocol",
        "customModelProviders.customProvider": "Custom",
        "customModelProviders.deleteConfirmMessage": `Delete ${model}`,
        "customModelProviders.deleteConfirmTitle": "Delete custom model?",
        "customModelProviders.deleteFailed": "Failed to delete custom model",
        "customModelProviders.deleteModel": `Delete ${model}`,
        "customModelProviders.editCustomModel": "Edit model",
        "customModelProviders.editModel": `Edit ${model}`,
        "customModelProviders.empty": "No custom models yet",
        "customModelProviders.inputContext": "Input context",
        "customModelProviders.localConfigHint":
          "Manage local custom models stored in the daemon modelGateways config.",
        "customModelProviders.localConfigTitle": "Local configuration",
        "customModelProviders.sectionHint":
          "Add models for Claude Messages, Codex Responses, or OpenAI-compatible Chat Completions.",
        "customModelProviders.modelName": "Model name",
        "customModelProviders.modelNamePlaceholder": "Model id, e.g. gpt-4o",
        "customModelProviders.openaiOnlyHint":
          "Configure the upstream API for the selected protocol",
        "customModelProviders.protocolPreset": "Upstream protocol",
        "customModelProviders.protocolPresetHint": "Primary upstream API protocol for the model.",
        "customModelProviders.protocolClaude": "Claude (Messages)",
        "customModelProviders.protocolCodex": "Codex (Responses)",
        "customModelProviders.protocolOpenai": "OpenAI-compatible (Chat)",
        "customModelProviders.protocolClaudeHint": "Anthropic Messages protocol",
        "customModelProviders.protocolCodexHint": "OpenAI Responses protocol",
        "customModelProviders.protocolOpenaiHint": "Chat Completions protocol",
        "customModelProviders.supplyScope": "Supply scope",
        "customModelProviders.supplyScopeHint":
          "Choose which agents receive this model via the gateway.",
        "customModelProviders.supplyAll": "All agents",
        "customModelProviders.supplyMatched": "Matched protocol only",
        "customModelProviders.attachToAllAgents": "Attach to all agents",
        "customModelProviders.attachToAllAgentsSubtitle":
          "Supplies Claude / Codex / OpenCode / Pi / Kimi Code / Grok Build via gateway protocol conversion",
        "customModelProviders.attachToAllAgentsHint":
          "Exposes this model to all agents via gateway conversion.",
        "customModelProviders.allAgentsBadge": "All agents",
        "customModelProviders.matchedAgentsBadge": "Matched only",
        "customModelProviders.thinkingMode": "Thinking intensity",
        "customModelProviders.thinkingModeHint": "Select one or more thinking levels.",
        "customModelProviders.thinkingLow": "Low",
        "customModelProviders.thinkingMedium": "Medium",
        "customModelProviders.thinkingHigh": "High",
        "customModelProviders.thinkingVeryHigh": "Very High",
        "customModelProviders.thinkingMax": "Max",
        "customModelProviders.testModel": `Test ${model}`,
        "customModelProviders.testLatency": "42 ms",
        "customModelProviders.testUnavailable": "Unavailable",
        "customModelProviders.supportsImagesBadge": "Images",
        "customModelProviders.supportsToolsBadge": "Tools",
        "customModelProviders.supportsThinkingBadge": "Thinking",
        "customModelProviders.provider": "Provider",
        "customModelProviders.saveFailed": "Failed to save custom model",
        "customModelProviders.saveUnavailable": "Host is not connected",
        "customModelProviders.savedModels": "Saved models",
        "customModelProviders.saving": "Saving...",
        "customModelProviders.supportsImages": "Image input",
        "customModelProviders.supportsThinking": "Thinking model",
        "customModelProviders.supportsTools": "Tool calling",
        "customModelProviders.title": "Custom models",
        "customModelProviders.anthropicEndpoint": "Anthropic endpoint",
        "customModelProviders.openaiEndpoint": "OpenAI-compatible endpoint",
        "customModelProviders.responsesEndpoint": "Responses endpoint",
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    header,
    visible,
    children,
    testID,
  }: {
    header: { title: string; subtitle?: string };
    visible: boolean;
    children?: React.ReactNode;
    testID?: string;
  }) =>
    visible
      ? React.createElement(
          "section",
          { "data-testid": testID ?? "custom-model-editor-sheet" },
          React.createElement("h2", null, header.title),
          header.subtitle ? React.createElement("p", null, header.subtitle) : null,
          children,
        )
      : null,
  AdaptiveTextInput: ({
    initialValue,
    onChangeText,
    placeholder,
    testID,
  }: {
    initialValue?: string;
    onChangeText?: (value: string) => void;
    placeholder?: string;
    testID?: string;
  }) =>
    React.createElement("input", {
      "data-testid": testID,
      defaultValue: initialValue,
      placeholder,
      onInput: (event: React.FormEvent<HTMLInputElement>) =>
        onChangeText?.((event.target as HTMLInputElement).value),
    }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        disabled,
        "data-testid": testID,
        onClick: disabled ? undefined : onPress,
      },
      children,
    ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ value, onValueChange }: { value: boolean; onValueChange?: (next: boolean) => void }) =>
    React.createElement("input", {
      type: "checkbox",
      checked: value,
      onChange: () => undefined,
      onClick: (event: React.MouseEvent<HTMLInputElement>) =>
        onValueChange?.((event.target as HTMLInputElement).checked),
    }),
}));

vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({
    title,
    trailing,
    children,
    testID,
  }: {
    title: string;
    trailing?: React.ReactNode;
    children?: React.ReactNode;
    testID?: string;
  }) =>
    React.createElement(
      "section",
      { "data-testid": testID },
      React.createElement("h1", null, title),
      trailing,
      children,
    ),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: configState.config,
    patchConfig: patchConfigMock,
  }),
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: snapshotState.entries,
    refresh: refreshMock,
  }),
}));

vi.mock("@/hooks/use-user-visible-error", () => ({
  useUserVisibleErrorReporter: () =>
    vi.fn(({ error, fallbackMessage }: { error: unknown; fallbackMessage: string }) => {
      throw error instanceof Error ? error : new Error(fallbackMessage);
    }),
}));

import { CustomModelProvidersSection } from "@/screens/settings/custom-model-providers-section";

function makeConfig(): MutableDaemonConfig {
  return {
    mcp: { injectIntoAgents: false },
    providers: {},
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
        ],
        syntheticModels: [],
        upstreams: {
          anthropic: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
          },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.z.ai/v1",
            apiKey: "secret",
          },
          responses: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
          },
        },
      },
    },
    visionFallbackModel: null,
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    appendSystemPrompt: "",
    skills: { global: { disabledSkillNames: [] }, providers: {}, agents: {}, installedSources: {} },
    mcpServers: { servers: {}, global: { disabledServerNames: [] }, providers: {}, agents: {} },
  };
}

describe("CustomModelProvidersSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    configState.config = makeConfig();
    snapshotState.entries = [];
    patchConfigMock.mockReset();
    patchConfigMock.mockResolvedValue(makeConfig());
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(undefined);
    clientMock.runModelGatewayTest.mockClear();
    errorLogger.error.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("lists one row per saved model with edit and delete actions", () => {
    act(() => {
      root.render(<CustomModelProvidersSection serverId="server-1" />);
    });

    expect(container.textContent).toContain("Custom models");
    expect(container.textContent).toContain("Saved models");
    expect(container.textContent).toContain("GLM 5");
    expect(container.textContent).toContain("Custom");
    expect(container.querySelector('[data-testid="saved-model-row-zai-glm-5"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="edit-saved-model-zai-glm-5"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="delete-saved-model-zai-glm-5"]')).not.toBeNull();
  });

  it("tests a saved model and renders measured latency", async () => {
    act(() => {
      root.render(<CustomModelProvidersSection serverId="server-1" />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="test-saved-model-zai-glm-5"]')!
        .click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(clientMock.runModelGatewayTest).toHaveBeenCalledWith({
      gatewayId: "zai",
      modelId: "glm-5",
      targetFormat: "chatCompletions",
    });
    expect(container.textContent).toContain("42 ms");
  });
  it("opens the OpenAI-compatible editor when adding a model", () => {
    act(() => {
      root.render(<CustomModelProvidersSection serverId="server-1" />);
    });

    const addButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="add-custom-model-button"]',
    );
    expect(addButton).not.toBeNull();

    act(() => {
      addButton!.click();
    });

    expect(container.querySelector('[data-testid="custom-model-editor-sheet"]')).not.toBeNull();
    expect(container.textContent).toContain("Add model");
    expect(container.textContent).toContain(
      "Supplies Claude / Codex / OpenCode / Pi / Kimi Code / Grok Build via gateway protocol conversion",
    );
    expect(container.querySelector('[data-testid="custom-model-base-url-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="custom-model-api-key-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="custom-model-id-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="protocol-preset-openai"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="supply-scope-all"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="supply-scope-matched"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="thinking-level-low"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="thinking-level-medium"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="thinking-level-high"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="thinking-level-very-high"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="thinking-level-max"]')).not.toBeNull();
    expect(container.textContent).toContain("Tool calling");
    expect(container.textContent).toContain("Image input");
    expect(container.textContent).toContain("Thinking intensity");
  });

  it("switching to matched protocol disables attach-to-all on save", async () => {
    refreshMock.mockImplementationOnce(() => new Promise(() => undefined));

    act(() => {
      root.render(<CustomModelProvidersSection serverId="server-1" />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="add-custom-model-button"]')!
        .click();
    });

    // New gateways default to "All agents"; switch to "Matched protocol only".
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="supply-scope-matched"]')!.click();
    });

    const idInput = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-id-input"]',
    )!;
    const baseUrlInput = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-base-url-input"]',
    )!;
    const apiKeyInput = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-api-key-input"]',
    )!;
    idInput.value = "gpt-4o";
    baseUrlInput.value = "https://api.example.com/v1";
    apiKeyInput.value = "sk-test";
    act(() => {
      idInput.dispatchEvent(new Event("input", { bubbles: true }));
      baseUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="custom-model-save-button"]')!
        .click();
      await Promise.resolve();
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    const patchArg = patchConfigMock.mock.calls[0]?.[0] as unknown as {
      modelGateways?: Record<string, Record<string, unknown>>;
    };
    const gateway = (patchArg.modelGateways?.gpt4o ?? patchArg.modelGateways?.["gpt-4o"]) as
      | Record<string, unknown>
      | undefined;
    expect(gateway).toBeTruthy();
    expect(gateway?.protocolPreset).toBe("openai");
    expect(gateway?.supplyScope).toBe("matched");
    expect(gateway?.attachToAllAgents).toBeUndefined();
  });

  it("saves a new gateway that defaults to attaching all agents", async () => {
    refreshMock.mockImplementationOnce(() => new Promise(() => undefined));

    act(() => {
      root.render(<CustomModelProvidersSection serverId="server-1" />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="add-custom-model-button"]')!
        .click();
    });

    // Default supply scope is "All agents" — do not touch it.
    const idInput = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-id-input"]',
    )!;
    const baseUrlInput = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-base-url-input"]',
    )!;
    const apiKeyInput = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-api-key-input"]',
    )!;
    idInput.value = "glm-air";
    baseUrlInput.value = "https://api.example.com/v1";
    apiKeyInput.value = "sk-test";
    act(() => {
      idInput.dispatchEvent(new Event("input", { bubbles: true }));
      baseUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="custom-model-save-button"]')!
        .click();
      await Promise.resolve();
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    const patchArg = patchConfigMock.mock.calls[0]?.[0] as unknown as {
      modelGateways?: Record<string, Record<string, unknown>>;
    };
    const gateway = patchArg.modelGateways?.["glm-air"] as Record<string, unknown> | undefined;
    expect(gateway).toBeTruthy();
    expect(gateway?.protocolPreset).toBe("openai");
    expect(gateway?.supplyScope).toBe("all");
    expect(gateway?.attachToAllAgents).toBeUndefined();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    const refreshProviderIds = refreshMock.mock.calls[0]?.[0] as string[] | undefined;
    expect(Array.isArray(refreshProviderIds)).toBe(true);
    expect(refreshProviderIds?.length).toBe(6);
  });

  it("saves an edited model and closes without waiting for provider refresh", async () => {
    refreshMock.mockImplementationOnce(() => new Promise(() => undefined));

    act(() => {
      root.render(<CustomModelProvidersSection serverId="server-1" />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="edit-saved-model-zai-glm-5"]')!
        .click();
    });

    expect(container.querySelector('[data-testid="custom-model-editor-sheet"]')).not.toBeNull();
    expect(container.textContent).toContain("Edit model");

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="custom-model-save-button"]',
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    const patchArg = patchConfigMock.mock.calls[0]?.[0] as unknown as {
      modelGateways?: Record<string, { models?: Array<{ id: string }> }>;
    };
    expect(patchArg.modelGateways?.zai?.models?.some((model) => model.id === "glm-5")).toBe(true);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="custom-model-editor-sheet"]')).toBeNull();
  });

  it("keeps save failures visible inside the model editor", async () => {
    const error = new Error("Gateway rejected config");
    patchConfigMock.mockRejectedValueOnce(error);

    act(() => {
      root.render(<CustomModelProvidersSection serverId="server-1" errorLogger={errorLogger} />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="edit-saved-model-zai-glm-5"]')!
        .click();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="custom-model-save-button"]')!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="custom-model-editor-sheet"]')).not.toBeNull();
    expect(container.textContent).toContain("Gateway rejected config");
    expect(errorLogger.error).toHaveBeenCalledWith(
      "[CustomModelProviders] Failed to save custom model",
      error,
    );
  });

  it("deletes a saved model after confirmation", async () => {
    act(() => {
      root.render(<CustomModelProvidersSection serverId="server-1" />);
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="delete-saved-model-zai-glm-5"]')!
        .click();
    });

    expect(
      container.querySelector('[data-testid="delete-saved-model-confirm-modal"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Delete custom model?");
    expect(container.textContent).toContain("Delete GLM 5");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="delete-saved-model-confirm"]')!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    const deletePatch = patchConfigMock.mock.calls[0]?.[0] as unknown;
    expect(deletePatch).toEqual({
      modelGateways: {
        zai: { enabled: false },
      },
    });
  });
});
