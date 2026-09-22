/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";

const state = vi.hoisted(() => ({
  snapshot: {
    entries: undefined as ProviderSnapshotEntry[] | undefined,
    isRefreshing: false,
    error: null as string | null,
    refreshError: null as string | null,
    refresh: vi.fn(async () => {}),
  },
  config: null as MutableDaemonConfig | null,
  patchConfig: vi.fn(async () => undefined),
  client: null as {
    getProviderDiagnostic: (provider: string) => Promise<{ diagnostic: string }>;
    runProviderToolingAction: (
      provider: string,
      action: "install" | "update",
    ) => Promise<{ success: boolean; stdout?: string; stderr?: string }>;
  } | null,
  clipboard: vi.fn(async (_value: string) => {}),
}));

vi.mock("react-native", () => {
  const host =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement(tag, props, children);
  return {
    Platform: {
      OS: "web",
      select: (options: { web?: unknown; default?: unknown }) => options.web ?? options.default,
    },
    ActivityIndicator: () => React.createElement("span", { "data-testid": "activity-indicator" }),
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityRole,
      testID,
    }: {
      children?:
        | React.ReactNode
        | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityRole?: string;
      testID?: string;
    }) =>
      React.createElement(
        "button",
        {
          type: "button",
          onClick: disabled ? undefined : onPress,
          disabled,
          "aria-label": accessibilityLabel,
          role: accessibilityRole,
          "data-testid": testID,
        },
        typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
      ),
    ScrollView: host("div"),
    Text: host("span"),
    View: host("div"),
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? factory({
            spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 },
            fontSize: { code: 12, xs: 11, sm: 13, base: 15 },
            fontWeight: { medium: "500" },
            borderRadius: { full: 999, lg: 12 },
            colors: {
              foreground: "#fff",
              foregroundMuted: "#aaa",
              destructive: "#f00",
              surface0: "#000",
              surface1: "#111",
              border: "#333",
              secondary: "#222",
              accent: "#0af",
            },
            shadow: { sm: {}, md: {}, lg: {} },
            glass: { enabled: false, border: "#333" },
          })
        : factory,
  },
  withUnistyles: (component: React.ComponentType) => component,
  UnistylesRuntime: { pixelRatio: 2 },
}));

vi.mock("react-i18next", () => {
  const translate = (key: string, params?: Record<string, string | number>) => {
    const values: Record<string, string> = {
      "providerDiagnostics.loadingModels": "Loading models",
      "providerDiagnostics.noModels": "No models",
      "providerDiagnostics.noSearchMatches": "No matching models",
      "providerDiagnostics.searchModels": "Search models",
      "providerDiagnostics.addModel": "Add model",
      "providerDiagnostics.diagnostic": "Diagnostic",
      "providerDiagnostics.refresh": "Refresh",
      "providerDiagnostics.refreshing": "Refreshing",
      "providerDiagnostics.installation": "Installation",
      "providerDiagnostics.install": "Install",
      "providerDiagnostics.update": "Update",
      "providerDiagnostics.toolingFailed": "Tooling failed",
      "providerDiagnostics.toolingSucceeded": "Tooling succeeded",
      "providerDiagnostics.providerUnavailable": "Provider unavailable",
      "providerDiagnostics.removeModel": `Remove ${params?.model ?? ""}`,
      "providerDiagnostics.updated": `Updated ${params?.time ?? ""}`,
      "providerDiagnostics.loadingDiagnostic": "Loading diagnostic",
      "providerDiagnostics.diagnosticFailed": "Diagnostic failed",
      "providerDiagnostics.noDiagnostic": "No diagnostic",
      "providerDiagnostics.copyDiagnostic": "Copy diagnostic",
      "providerDiagnostics.refreshDiagnostic": "Refresh diagnostic",
      "providerDiagnostics.refreshingDiagnostic": "Refreshing diagnostic",
      "modelSelector.retrying": "Retrying",
      "modelSelector.unknownError": "Unknown error",
      "common.retry": "Retry",
      "common.cancel": "Cancel",
      "providers.discovered": "Discovered",
      "providers.customModels": "Custom models",
      "providerDiagnostics.notInstalled": "Not installed",
      "providerDiagnostics.latestUnknown": "Latest unknown",
      "providerDiagnostics.installedVersion": `Installed ${params?.version ?? ""}`,
      "providerDiagnostics.latestVersion": `Latest ${params?.version ?? ""}`,
      "providerDiagnostics.addCustomModel": "Add custom model",
      "providerDiagnostics.modelId": "Model ID",
      "providerDiagnostics.adding": "Adding",
      "providerDiagnostics.add": "Add",
      "customModels.deleteFailed": "Delete failed",
      "providerDiagnostics.saveModelFailed": "Save failed",
    };
    return values[key] ?? key;
  };

  return {
    useTranslation: () => ({ t: translate }),
  };
});

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    header,
    visible,
    children,
    footer,
  }: {
    header: {
      title: string;
      actions?: React.ReactNode;
      search?: { testID?: string; placeholder?: string; onChange: (value: string) => void };
    };
    visible: boolean;
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    visible
      ? React.createElement(
          "section",
          { "data-testid": "adaptive-sheet" },
          React.createElement("h2", null, header.title),
          header.search
            ? React.createElement("input", {
                "data-testid": header.search.testID,
                placeholder: header.search.placeholder,
                onInput: (event: React.FormEvent<HTMLInputElement>) =>
                  header.search?.onChange(event.currentTarget.value),
              })
            : null,
          header.actions,
          children,
          footer,
        )
      : null,
  AdaptiveTextInput: ({
    onChangeText,
    value,
    placeholder,
  }: {
    onChangeText?: (value: string) => void;
    value?: string;
    placeholder?: string;
  }) =>
    React.createElement("input", {
      value,
      placeholder,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText?.(event.target.value),
    }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick: disabled ? undefined : onPress,
        disabled,
        "aria-label": accessibilityLabel,
      },
      children,
    ),
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => state.snapshot,
}));
vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: state.config, patchConfig: state.patchConfig }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => state.client,
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: state.clipboard }));
vi.mock("lucide-react-native", () => {
  const Icon = () => null;
  return {
    AlertTriangle: Icon,
    Copy: Icon,
    FileText: Icon,
    Plus: Icon,
    RotateCw: Icon,
    Trash2: Icon,
  };
});

import { ProviderDiagnosticSheet } from "./provider-diagnostic-sheet";

const model = { provider: "claude", id: "claude-sonnet", label: "Claude Sonnet" };
const customModel = { id: "custom-model", label: "Custom model" };

function configWithModels(additionalModels = [customModel]): MutableDaemonConfig {
  return {
    mcp: { injectIntoAgents: false },
    providers: { claude: { enabled: true, additionalModels } },
    modelGateways: {},
    visionFallbackModel: null,
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    appendSystemPrompt: "",
    skills: { global: { disabledSkillNames: [] }, providers: {}, agents: {}, installedSources: {} },
    mcpServers: { servers: {}, global: { disabledServerNames: [] }, providers: {}, agents: {} },
  };
}

function entry(overrides: Partial<ProviderSnapshotEntry> = {}): ProviderSnapshotEntry {
  return {
    provider: "claude",
    status: "ready",
    enabled: true,
    label: "Claude",
    models: [model],
    ...overrides,
  };
}

describe("ProviderDiagnosticSheet", () => {
  let root: Root | null = null;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    state.snapshot.entries = [entry()];
    state.snapshot.isRefreshing = false;
    state.snapshot.error = null;
    state.snapshot.refreshError = null;
    state.snapshot.refresh.mockReset();
    state.config = configWithModels();
    state.patchConfig.mockReset();
    state.patchConfig.mockResolvedValue(undefined);
    state.client = {
      getProviderDiagnostic: vi.fn(async () => ({ diagnostic: "diagnostic output" })),
      runProviderToolingAction: vi.fn(async () => ({ success: true, stdout: "ok" })),
    };
    state.clipboard.mockReset();
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    root = null;
  });

  function render(visible = true, provider = "claude"): void {
    act(() => {
      root?.render(
        <ProviderDiagnosticSheet
          provider={provider}
          serverId="server-1"
          visible={visible}
          onClose={vi.fn()}
        />,
      );
    });
  }

  it("shows cached models while displaying a refresh error and retries", () => {
    state.snapshot.refreshError = "refresh failed";
    render();
    expect(container.textContent).toContain("refresh failed");
    expect(container.textContent).toContain("Claude Sonnet");
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());
    expect(state.snapshot.refresh).toHaveBeenCalledWith(["claude"]);
  });

  it("renders loading, unavailable, empty, and search no-match states", () => {
    state.config = configWithModels([]);
    state.snapshot.entries = [entry({ status: "loading", models: [] })];
    render();
    expect(container.textContent).toContain("Loading models");

    state.snapshot.entries = [entry({ status: "unavailable", models: [], error: "" })];
    render();
    expect(container.textContent).toContain("Provider unavailable");

    state.snapshot.entries = [entry({ models: [] })];
    render();
    expect(container.textContent).toContain("No models");

    state.snapshot.entries = [entry()];
    render();
    const search = container.querySelector<HTMLInputElement>(
      "[data-testid=provider-settings-search]",
    );
    act(() => {
      if (search) {
        search.value = "does-not-match";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(container.textContent).toContain("No matching models");
  });

  it("keeps discovered model cache isolated when switching providers", () => {
    render();
    state.snapshot.entries = [{ ...entry(), provider: "other", label: "Other", models: [] }];
    render(true, "other");
    expect(container.textContent).not.toContain("Claude Sonnet");
  });

  it("reports diagnostic success and copies it", async () => {
    render();
    const diagnosticButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Diagnostic",
    );
    act(() => diagnosticButton?.click());
    expect(state.client?.getProviderDiagnostic).toHaveBeenCalledWith("claude");
    await vi.waitFor(() => expect(container.textContent).toContain("diagnostic output"));
    const copy = container.querySelector<HTMLButtonElement>('[aria-label="Copy diagnostic"]');
    act(() => copy?.click());
    expect(state.clipboard).toHaveBeenCalledWith("diagnostic output");
  });

  it("shows diagnostic errors and retries", async () => {
    const diagnostic = vi.fn(async () => {
      throw new Error("diagnostic failed");
    });
    state.client = {
      getProviderDiagnostic: diagnostic,
      runProviderToolingAction: vi.fn(async () => ({ success: true, stdout: "ok" })),
    };
    render();
    const diagnosticButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Diagnostic",
    );
    act(() => diagnosticButton?.click());
    await vi.waitFor(() => expect(container.textContent).toContain("diagnostic failed"));
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());
    expect(diagnostic).toHaveBeenCalled();
  });

  it("surfaces tooling failure and custom-model delete failure", async () => {
    state.snapshot.entries = [entry({ installAvailable: true })];
    state.client = {
      ...state.client!,
      runProviderToolingAction: vi.fn(async () => ({ success: false, stderr: "install failed" })),
    };
    render();
    const install = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Install",
    );
    act(() => install?.click());
    await vi.waitFor(() => expect(container.textContent).toContain("install failed"));

    state.patchConfig.mockRejectedValueOnce(new Error("delete failed"));
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="Remove custom-model"]');
    act(() => remove?.click());
    await vi.waitFor(() => expect(container.textContent).toContain("delete failed"));
  });
});
