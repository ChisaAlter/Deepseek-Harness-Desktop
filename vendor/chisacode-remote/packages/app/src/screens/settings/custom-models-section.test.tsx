/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";

const { theme, configState, snapshotState, patchConfigMock, refreshMock, confirmDialogMock } =
  vi.hoisted(() => ({
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
      iconSize: { sm: 14 },
      fontSize: { xs: 11, sm: 13, base: 15 },
      fontWeight: { normal: "400", medium: "500" },
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
    snapshotState: {
      entries: undefined as ProviderSnapshotEntry[] | undefined,
    },
    patchConfigMock: vi.fn(async () => undefined),
    refreshMock: vi.fn(async () => undefined),
    confirmDialogMock: vi.fn(async () => true),
  }));

vi.mock("react-native", () => ({
  View: ({
    children,
    testID,
    style: _style,
  }: {
    children?: React.ReactNode;
    testID?: string;
    style?: unknown;
  }) => React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
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
    Pencil: icon("Pencil"),
    Plus: icon("Plus"),
    Trash2: icon("Trash2"),
  };
});

vi.mock("@/constants/platform", () => ({ isWeb: true }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        "common.cancel": "Cancel",
        "common.delete": "Delete",
        "common.save": "Save",
        "customModels.add": "Add",
        "customModels.addCustomModel": "Add custom model",
        "customModels.deleteConfirmMessage": `Remove ${params?.model ?? ""}`,
        "customModels.deleteConfirmTitle": "Delete custom model?",
        "customModels.deleteFailed": "Failed to delete custom model",
        "customModels.deleteModel": `Delete ${params?.model ?? ""}`,
        "customModels.editCustomModel": "Edit custom model",
        "customModels.editModel": `Edit ${params?.model ?? ""}`,
        "customModels.empty": "No custom models yet",
        "customModels.modelId": "Model ID",
        "customModels.modelLabel": "Display name",
        "customModels.modelLabelPlaceholder": "Defaults to model ID",
        "customModels.noProviders": "No available providers",
        "customModels.providerToggleLabel": `${params?.provider ?? ""} supports this model`,
        "customModels.saveFailed": "Failed to save custom model",
        "customModels.saving": "Saving...",
        "customModels.supportedAgents": "Supported agents",
        "customModels.title": "Custom models",
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
  }: {
    header: { title: string };
    visible: boolean;
    children?: React.ReactNode;
  }) =>
    visible
      ? React.createElement(
          "section",
          { "data-testid": "custom-model-editor-sheet" },
          React.createElement("h2", null, header.title),
          children,
        )
      : null,
  AdaptiveTextInput: ({
    initialValue,
    onChangeText,
    testID,
    placeholder,
  }: {
    initialValue?: string;
    onChangeText?: (value: string) => void;
    testID?: string;
    placeholder?: string;
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
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) =>
    React.createElement(
      "button",
      { type: "button", disabled, onClick: disabled ? undefined : onPress },
      children,
    ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    accessibilityLabel,
    testID,
  }: {
    value: boolean;
    onValueChange?: (next: boolean) => void;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement("input", {
      type: "checkbox",
      checked: value,
      "aria-label": accessibilityLabel,
      "data-testid": testID,
      onChange: () => undefined,
      onClick: (event: React.MouseEvent<HTMLInputElement>) =>
        onValueChange?.((event.target as HTMLInputElement).checked),
    }),
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
    entries: snapshotState.entries,
    refresh: refreshMock,
  }),
}));

import { CustomModelsSection } from "@/screens/settings/custom-models-section";

const claudeEntry: ProviderSnapshotEntry = {
  provider: "claude",
  label: "Claude",
  status: "ready",
  enabled: true,
  defaultModeId: null,
  modes: [],
};

const codexEntry: ProviderSnapshotEntry = {
  provider: "codex",
  label: "Codex",
  status: "ready",
  enabled: true,
  defaultModeId: null,
  modes: [],
};

function makeConfig(providers: MutableDaemonConfig["providers"] = {}): MutableDaemonConfig {
  return {
    mcp: { injectIntoAgents: false },
    providers,
    modelGateways: {},
    visionFallbackModel: null,
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    appendSystemPrompt: "",
    skills: { global: { disabledSkillNames: [] }, providers: {}, agents: {}, installedSources: {} },
    mcpServers: { servers: {}, global: { disabledServerNames: [] }, providers: {}, agents: {} },
  };
}

describe("CustomModelsSection", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    configState.config = makeConfig();
    snapshotState.entries = [claudeEntry, codexEntry];
    patchConfigMock.mockReset();
    patchConfigMock.mockResolvedValue(undefined);
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(undefined);
    confirmDialogMock.mockReset();
    confirmDialogMock.mockResolvedValue(true);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  function render(): void {
    act(() => {
      root?.render(<CustomModelsSection serverId="server-1" />);
    });
  }

  it("renders configured custom models with their provider labels", () => {
    configState.config = makeConfig({
      claude: { additionalModels: [{ id: "glm-5", label: "GLM 5" }] },
      codex: { additionalModels: [{ id: "glm-5", label: "GLM 5" }] },
    });

    render();

    expect(container?.textContent).toContain("Custom models");
    expect(container?.textContent).toContain("GLM 5");
    expect(container?.textContent).toContain("glm-5");
    expect(container?.textContent).toContain("Claude, Codex");
  });

  it("adds a model to selected providers and refreshes their snapshots", async () => {
    render();

    const addButton = container?.querySelector<HTMLElement>(
      '[data-testid="add-custom-model-button"]',
    );
    expect(addButton).not.toBeNull();
    await act(async () => {
      addButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    const modelInput = container?.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-id-input"]',
    );
    const labelInput = container?.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-label-input"]',
    );
    const claudeSwitch = container?.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-provider-claude"]',
    );
    const codexSwitch = container?.querySelector<HTMLInputElement>(
      '[data-testid="custom-model-provider-codex"]',
    );

    await act(async () => {
      modelInput!.value = "glm-5";
      modelInput!.dispatchEvent(new window.Event("input", { bubbles: true }));
      labelInput!.value = "GLM 5";
      labelInput!.dispatchEvent(new window.Event("input", { bubbles: true }));
      claudeSwitch!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      codexSwitch!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    const saveButton = Array.from(
      container?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent === "Save");
    expect(saveButton).not.toBeUndefined();

    await act(async () => {
      saveButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(patchConfigMock).toHaveBeenCalledWith({
      providers: {
        claude: { additionalModels: [{ id: "glm-5", label: "GLM 5" }] },
        codex: { additionalModels: [{ id: "glm-5", label: "GLM 5" }] },
      },
    });
    expect(refreshMock).toHaveBeenCalledWith(["claude", "codex"]);
  });

  it("confirms before deleting a global custom model", async () => {
    configState.config = makeConfig({
      claude: { additionalModels: [{ id: "glm-5", label: "GLM 5" }] },
      codex: { additionalModels: [{ id: "glm-5", label: "GLM 5" }] },
    });

    render();

    const deleteButton = container?.querySelector<HTMLElement>(
      '[data-testid="delete-custom-model-glm-5"]',
    );
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(confirmDialogMock).toHaveBeenCalledWith({
      title: "Delete custom model?",
      message: "Remove GLM 5",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    expect(patchConfigMock).toHaveBeenCalledWith({
      providers: {
        claude: { additionalModels: [] },
        codex: { additionalModels: [] },
      },
    });
    expect(refreshMock).toHaveBeenCalledWith(["claude", "codex"]);
  });
});
