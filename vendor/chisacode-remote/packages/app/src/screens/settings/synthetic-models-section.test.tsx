/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@chisacode/protocol/messages";

const {
  theme,
  configState,
  runMoaTestMock,
  patchConfigMock,
  refreshProvidersMock,
  confirmDialogMock,
} = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    iconSize: { sm: 14, md: 18 },
    fontSize: { xs: 11, sm: 13, base: 14 },
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
    },
  },
  configState: {
    config: null as MutableDaemonConfig | null,
  },
  runMoaTestMock: vi.fn(async (_input: unknown) => ({
    requestId: "request-1",
    gatewayId: "zai",
    error: null,
    result: {
      finalText: "final answer",
      durationMs: 120,
      layers: [
        {
          id: "layer-1",
          label: "Layer 1",
          nodes: [
            {
              id: "layer-1:glm-5",
              model: "glm-5",
              status: "success" as const,
              output: "glm draft",
              error: null,
              durationMs: 40,
            },
          ],
        },
        {
          id: "layer-2",
          label: "Layer 2",
          nodes: [
            {
              id: "layer-2:qwen-max",
              model: "qwen-max",
              status: "success" as const,
              output: "qwen draft",
              error: null,
              durationMs: 45,
            },
          ],
        },
      ],
      aggregator: {
        model: "glm-5",
        status: "success" as const,
        output: "final answer",
        error: null,
        durationMs: 35,
      },
    },
  })),
  patchConfigMock: vi.fn<
    (patch: MutableDaemonConfigPatch) => Promise<MutableDaemonConfig | undefined>
  >(async () => undefined),
  refreshProvidersMock: vi.fn(async (_providers?: string[]) => undefined),
  confirmDialogMock: vi.fn(async () => true),
}));

vi.mock("react-native", () => ({
  View: ({
    children,
    testID,
    style,
  }: {
    children?: React.ReactNode;
    testID?: string;
    style?: unknown;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": testID,
        "data-style": style === undefined ? undefined : JSON.stringify(style),
      },
      children,
    ),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  TextInput: ({
    value,
    onChangeText,
    placeholder,
    testID,
  }: {
    value?: string;
    onChangeText?: (value: string) => void;
    placeholder?: string;
    testID?: string;
  }) =>
    React.createElement("textarea", {
      value,
      placeholder,
      "data-testid": testID,
      onInput: (event: React.FormEvent<HTMLTextAreaElement>) =>
        onChangeText?.((event.target as HTMLTextAreaElement).value),
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
  UnistylesRuntime: { pixelRatio: 1 },
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    ArrowDown: icon("ArrowDown"),
    ArrowUp: icon("ArrowUp"),
    Brain: icon("Brain"),
    FlaskConical: icon("FlaskConical"),
    Pencil: icon("Pencil"),
    Play: icon("Play"),
    Plus: icon("Plus"),
    Trash2: icon("Trash2"),
  };
});

vi.mock("@/constants/platform", () => ({ isWeb: true }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        "common.cancel": "Cancel",
        "common.delete": "Delete",
        "common.save": "Save",
        "syntheticModels.add": "Add",
        "syntheticModels.addLayer": "Add layer",
        "syntheticModels.addSyntheticModel": "Add synthetic model",
        "syntheticModels.aggregator": "Aggregator",
        "syntheticModels.aggregatorModel": "Aggregator model",
        "syntheticModels.aggregatorResult": "Aggregator result",
        "syntheticModels.deleteConfirmMessage": `Delete ${params?.model ?? ""}?`,
        "syntheticModels.deleteConfirmTitle": "Delete synthetic model?",
        "syntheticModels.deleteFailed": "Failed to delete synthetic model",
        "syntheticModels.deleteLayer": "Delete layer",
        "syntheticModels.deleteModel": `Delete ${params?.model ?? ""}`,
        "syntheticModels.description": "Description",
        "syntheticModels.descriptionPlaceholder": "Description",
        "syntheticModels.editModel": `Edit ${params?.model ?? ""}`,
        "syntheticModels.empty": "No synthetic models yet",
        "syntheticModels.finalAnswer": "Final answer",
        "syntheticModels.globalParameters": "Global parameters",
        "syntheticModels.moaAdvancedParameters": "Advanced parameters",
        "syntheticModels.moaAggregatorHint":
          "Pick one configured model to combine the previous layer.",
        "syntheticModels.moaDraftHint": "Pick configured models for first-pass answers.",
        "syntheticModels.moaFinalHint": "Pick configured models to finalize candidates.",
        "syntheticModels.moaReviewHint": "Pick configured models to review the first layer.",
        "syntheticModels.moaStageDraft": "Layer 1 · Draft",
        "syntheticModels.moaStageFinal": "Layer 3 · Final",
        "syntheticModels.moaStageReview": "Layer 2 · Review",
        "syntheticModels.hostUnavailable": "Host unavailable",
        "syntheticModels.layerModelCount": `${params?.count ?? 0} models`,
        "syntheticModels.layerTitle": `Layer ${params?.index ?? ""}`,
        "syntheticModels.layers": "Layers",
        "syntheticModels.maxTokensPlaceholder": "max tokens",
        "syntheticModels.modelCount": `${params?.count ?? 0} models`,
        "syntheticModels.modelId": "Model ID",
        "syntheticModels.modelLabel": "Display name",
        "syntheticModels.modelLabelPlaceholder": "Defaults to model ID",
        "syntheticModels.moaTest": "MoA test",
        "syntheticModels.moaTestSubtitle": "Test layered MoA",
        "syntheticModels.moaTestTitle": "MoA test",
        "syntheticModels.moveLayerDown": "Move layer down",
        "syntheticModels.moveLayerUp": "Move layer up",
        "syntheticModels.noProviders": "No providers",
        "syntheticModels.nodeFailed": "Failed",
        "syntheticModels.nodeSuccess": "Success",
        "syntheticModels.openMoaTest": "Open MoA test",
        "syntheticModels.provider": "Provider",
        "syntheticModels.referenceModels": "Reference models",
        "syntheticModels.referencesSummary": `${params?.count ?? 0} references`,
        "syntheticModels.runTest": "Run test",
        "syntheticModels.saveFailed": "Failed to save synthetic model",
        "syntheticModels.saving": "Saving...",
        "syntheticModels.systemPromptPlaceholder": "system prompt",
        "syntheticModels.temperaturePlaceholder": "temperature",
        "syntheticModels.testFailed": "MoA test failed",
        "syntheticModels.testPrompt": "Test prompt",
        "syntheticModels.testPromptPlaceholder": "Prompt",
        "syntheticModels.testing": "Testing...",
        "syntheticModels.title": "Synthetic models",
        "syntheticModels.totalDuration": `Total ${params?.duration ?? 0}ms`,
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
    desktopSurface = "plain",
  }: {
    header: { title: string; subtitle?: React.ReactNode };
    visible: boolean;
    children?: React.ReactNode;
    testID?: string;
    desktopSurface?: "glass" | "plain";
  }) =>
    visible
      ? React.createElement(
          "section",
          { "data-testid": testID, "data-desktop-surface": desktopSurface },
          React.createElement("h2", null, header.title),
          header.subtitle,
          children,
        )
      : null,
  AdaptiveTextInput: ({
    initialValue,
    onChangeText,
    placeholder,
  }: {
    initialValue?: string;
    onChangeText?: (value: string) => void;
    placeholder?: string;
  }) =>
    React.createElement("input", {
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
      { type: "button", disabled, "data-testid": testID, onClick: disabled ? undefined : onPress },
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
  }: {
    title: string;
    trailing?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      "section",
      null,
      React.createElement("h1", null, title),
      trailing,
      children,
    ),
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: confirmDialogMock,
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: configState.config,
    patchConfig: patchConfigMock,
  }),
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    refresh: refreshProvidersMock,
  }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    runModelGatewayMoaTest: runMoaTestMock,
  }),
}));

import { SyntheticModelsSection } from "@/screens/settings/synthetic-models-section";

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
          { id: "glm-5", label: "GLM 5" },
          { id: "qwen-max", label: "Qwen Max" },
        ],
        syntheticModels: [],
        upstreams: {
          anthropic: {
            enabled: true,
            baseUrl: "https://api.z.ai/api/anthropic",
            apiKey: "secret",
          },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.z.ai/api/paas/v4",
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

describe("SyntheticModelsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    configState.config = makeConfig();
    patchConfigMock.mockReset();
    patchConfigMock.mockImplementation(async () => configState.config ?? undefined);
    refreshProvidersMock.mockClear();
    runMoaTestMock.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("opens the two-stage MoA tester, runs the RPC, and renders traces", async () => {
    act(() => {
      root.render(<SyntheticModelsSection serverId="server-1" />);
    });

    const openTesterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open MoA test"]',
    );
    expect(openTesterButton).not.toBeNull();

    act(() => {
      openTesterButton!.click();
    });

    expect(
      container.querySelector('[data-testid="synthetic-model-moa-tester-sheet"]'),
    ).not.toBeNull();

    expect(container.textContent).toContain("Layer 1 · Draft");
    expect(container.textContent).toContain("Layer 2 · Review");
    expect(container.textContent).not.toContain("Layer 3 · Final");
    expect(container.textContent).toContain("Aggregator model");
    expect(container.textContent).not.toContain("Add layer");
    expect(container.textContent).not.toContain("Global parameters");

    const promptInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="moa-test-prompt-input"]',
    );
    expect(promptInput).not.toBeNull();

    await act(async () => {
      promptInput!.value = "Explain MoA";
      promptInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const runButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="moa-test-run-button"]',
    );
    expect(runButton).not.toBeNull();

    await act(async () => {
      runButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runMoaTestMock).toHaveBeenCalledTimes(1);
    const request = runMoaTestMock.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      gatewayId: "zai",
      prompt: "Explain MoA",
      syntheticModel: {
        id: "moa-test",
        aggregatorModel: "glm-5",
        references: [{ model: "glm-5" }, { model: "qwen-max" }],
        moa: {
          layers: [
            {
              id: "layer-1",
              nodes: [{ model: "glm-5" }, { model: "qwen-max" }],
            },
            {
              id: "layer-2",
              nodes: [{ model: "glm-5" }, { model: "qwen-max" }],
            },
          ],
          aggregator: { model: "glm-5" },
        },
      },
    });
    expect(container.textContent).toContain("final answer");
    expect(container.textContent).toContain("glm draft");
    expect(container.textContent).toContain("qwen draft");
  });

  it("saves added synthetic models from two configurable MoA stages", async () => {
    act(() => {
      root.render(<SyntheticModelsSection serverId="server-1" />);
    });

    const addButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add synthetic model"]',
    );
    expect(addButton).not.toBeNull();

    act(() => {
      addButton!.click();
    });

    expect(container.textContent).toContain("Layer 1 · Draft");
    expect(container.textContent).toContain("Layer 2 · Review");
    expect(container.textContent).not.toContain("Layer 3 · Final");
    expect(container.textContent).toContain("Aggregator model");
    expect(container.textContent).not.toContain("Reference models");

    const idInput = container.querySelector<HTMLInputElement>('input[placeholder="moa-coder"]');
    const labelInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Defaults to model ID"]',
    );
    expect(idInput).not.toBeNull();
    expect(labelInput).not.toBeNull();

    await act(async () => {
      idInput!.value = "moa-test";
      idInput!.dispatchEvent(new Event("input", { bubbles: true }));
      labelInput!.value = "MoA Test";
      labelInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save",
    );
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(refreshProvidersMock).toHaveBeenCalledWith([
      "zai-claude",
      "zai-codex",
      "zai-opencode",
      "zai-pi",
      "zai-kimi",
    ]);
    expect(patchConfigMock.mock.calls[0]?.[0]).toMatchObject({
      modelGateways: {
        zai: {
          syntheticModels: [
            {
              id: "moa-test",
              label: "MoA Test",
              references: [{ model: "glm-5" }, { model: "qwen-max" }],
              aggregatorModel: "glm-5",
              rounds: 2,
              moa: {
                layers: [
                  {
                    id: "layer-1",
                    nodes: [{ model: "glm-5" }, { model: "qwen-max" }],
                  },
                  {
                    id: "layer-2",
                    nodes: [{ model: "glm-5" }, { model: "qwen-max" }],
                  },
                ],
                aggregator: { model: "glm-5" },
              },
            },
          ],
        },
      },
    });
  });

  it("preserves extra MoA layers when editing a saved synthetic model", async () => {
    const gateway = configState.config?.modelGateways?.zai;
    if (gateway) {
      gateway.syntheticModels = [
        {
          id: "moa-three-stage",
          label: "MoA Three Stage",
          references: [{ model: "glm-5" }, { model: "qwen-max" }],
          aggregatorModel: "glm-5",
          rounds: 3,
          moa: {
            layers: [
              {
                id: "layer-1",
                label: "Layer 1",
                nodes: [{ model: "glm-5" }, { model: "qwen-max" }],
              },
              {
                id: "layer-2",
                label: "Layer 2",
                nodes: [{ model: "qwen-max" }],
              },
              {
                id: "layer-3",
                label: "Layer 3",
                nodes: [{ model: "glm-5" }],
              },
            ],
            aggregator: { model: "glm-5" },
          },
        },
      ];
    }

    act(() => {
      root.render(<SyntheticModelsSection serverId="server-1" />);
    });

    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit MoA Three Stage"]',
    );
    expect(editButton).not.toBeNull();

    act(() => {
      editButton!.click();
    });

    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save",
    );
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    const savedModel = patchConfigMock.mock.calls[0]?.[0].modelGateways?.zai?.syntheticModels?.[0];
    expect(savedModel?.moa?.layers).toEqual([
      {
        id: "layer-1",
        label: "Layer 1",
        nodes: [
          { id: "layer-1:glm-5", model: "glm-5" },
          { id: "layer-1:qwen-max", model: "qwen-max" },
        ],
      },
      {
        id: "layer-2",
        label: "Layer 2",
        nodes: [{ id: "layer-2:qwen-max", model: "qwen-max" }],
      },
      {
        id: "layer-3",
        label: "Layer 3",
        nodes: [{ id: "layer-3:glm-5", model: "glm-5" }],
      },
    ]);
  });

  it("keeps MoA sheets on the plain themed desktop surface", () => {
    act(() => {
      root.render(<SyntheticModelsSection serverId="server-1" />);
    });

    const openTesterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open MoA test"]',
    );
    expect(openTesterButton).not.toBeNull();

    act(() => {
      openTesterButton!.click();
    });

    expect(
      container
        .querySelector('[data-testid="synthetic-model-moa-tester-sheet"]')
        ?.getAttribute("data-desktop-surface"),
    ).toBe("plain");
  });

  it("keeps vertical MoA field groups from using row flex sizing", () => {
    act(() => {
      root.render(<SyntheticModelsSection serverId="server-1" />);
    });

    const openTesterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open MoA test"]',
    );
    expect(openTesterButton).not.toBeNull();

    act(() => {
      openTesterButton!.click();
    });

    const labels = Array.from(container.querySelectorAll("span"));
    const globalParametersLabel = labels.find((label) => label.textContent === "Global parameters");
    const testPromptLabel = labels.find((label) => label.textContent === "Test prompt");

    expect(globalParametersLabel).toBeUndefined();
    expect(testPromptLabel?.parentElement?.getAttribute("data-style")).not.toContain('"flex":1');
  });

  it("allows the MoA tester to run with one configured model", async () => {
    const gateway = configState.config?.modelGateways?.zai;
    if (gateway) {
      gateway.models = [{ id: "glm-5", label: "GLM 5" }];
    }

    act(() => {
      root.render(<SyntheticModelsSection serverId="server-1" />);
    });

    const openTesterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open MoA test"]',
    );
    expect(openTesterButton).not.toBeNull();

    act(() => {
      openTesterButton!.click();
    });

    const promptInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="moa-test-prompt-input"]',
    );
    expect(promptInput).not.toBeNull();

    await act(async () => {
      promptInput!.value = "Smoke";
      promptInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const runButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="moa-test-run-button"]',
    );
    expect(runButton).not.toBeNull();
    expect(runButton!.disabled).toBe(false);
  });

  it("saves a synthetic model when all MoA stages are empty", async () => {
    act(() => {
      root.render(<SyntheticModelsSection serverId="server-1" />);
    });

    const addButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add synthetic model"]',
    );
    expect(addButton).not.toBeNull();

    act(() => {
      addButton!.click();
    });

    const switches = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    );
    expect(switches.length).toBeGreaterThanOrEqual(4);

    await act(async () => {
      for (const control of switches) {
        control.click();
      }
      await Promise.resolve();
    });

    const idInput = container.querySelector<HTMLInputElement>('input[placeholder="moa-coder"]');
    expect(idInput).not.toBeNull();

    await act(async () => {
      idInput!.value = "decision-only";
      idInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save",
    );
    expect(saveButton).not.toBeUndefined();
    expect(saveButton!.disabled).toBe(false);

    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });

    expect(patchConfigMock.mock.calls[0]?.[0]).toMatchObject({
      modelGateways: {
        zai: {
          syntheticModels: [
            {
              id: "decision-only",
              references: [{ model: "glm-5" }],
              aggregatorModel: "glm-5",
              rounds: 2,
              moa: {
                layers: [
                  { id: "layer-1", nodes: [] },
                  { id: "layer-2", nodes: [] },
                ],
                aggregator: { model: "glm-5" },
              },
            },
          ],
        },
      },
    });
  });
});
