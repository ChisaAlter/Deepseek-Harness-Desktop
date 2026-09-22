/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";

const {
  theme,
  snapshotState,
  configState,
  patchConfigMock,
  openProviderSettingsMock,
  compactState,
  connectionState,
} = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, "1.5": 6, 2: 8, 3: 12, 4: 16, 6: 24 },
    iconSize: { sm: 14, md: 20 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400" },
    borderRadius: { lg: 8 },
    opacity: { 50: 0.5 },
    glass: { enabled: false },
    shadow: { sm: {}, md: {}, lg: {} },
    colors: {
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      accent: "#0a84ff",
      statusSuccess: "#00ff00",
      statusWarning: "#ff9500",
      statusDanger: "#ff0000",
      palette: { red: { 300: "#ff6b6b" }, white: "#fff" },
    },
  },
  snapshotState: {
    entries: undefined as ProviderSnapshotEntry[] | undefined,
    isLoading: false,
    isFetching: false,
    isRefreshing: false,
    error: null as string | null,
    refreshError: null as string | null,
    supportsSnapshot: true,
    refresh: vi.fn(async () => {}),
  },
  configState: {
    config: null as MutableDaemonConfig | null,
  },
  patchConfigMock: vi.fn(async () => undefined),
  openProviderSettingsMock: vi.fn(),
  compactState: {
    value: false,
  },
  connectionState: {
    value: true,
  },
}));

vi.mock("react-native", () => {
  function flatten(input: unknown): Record<string, unknown> {
    if (!input) return {};
    if (Array.isArray(input)) {
      return input.reduce<Record<string, unknown>>((acc, item) => {
        Object.assign(acc, flatten(item));
        return acc;
      }, {});
    }
    if (typeof input === "object") return input as Record<string, unknown>;
    return {};
  }
  function stringifyStyle(style: unknown): string {
    return JSON.stringify(flatten(style));
  }
  return {
    Platform: { OS: "web" },
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
        { "data-testid": testID, "data-style": stringifyStyle(style) },
        children,
      ),
    Text: ({ children, style }: { children?: React.ReactNode; style?: unknown }) =>
      React.createElement("span", { "data-style": stringifyStyle(style) }, children),
    Pressable: ({
      children,
      onPress,
      onHoverIn,
      onHoverOut,
      accessibilityRole,
      accessibilityLabel,
      disabled,
      testID,
      style,
    }: {
      children?:
        | React.ReactNode
        | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
      onPress?: (event: React.MouseEvent) => void;
      onHoverIn?: () => void;
      onHoverOut?: () => void;
      accessibilityRole?: string;
      accessibilityLabel?: string;
      disabled?: boolean;
      testID?: string;
      style?: unknown;
    }) =>
      React.createElement(
        "div",
        {
          role: accessibilityRole,
          "aria-label": accessibilityLabel,
          "aria-disabled": disabled ? "true" : undefined,
          "data-testid": testID,
          "data-style": stringifyStyle(
            typeof style === "function" ? style({ pressed: false, hovered: false }) : style,
          ),
          onClick: disabled ? undefined : onPress,
          onMouseEnter: onHoverIn,
          onMouseLeave: onHoverOut,
        },
        typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
      ),
    ActivityIndicator: () => React.createElement("span", { "data-testid": "activity-indicator" }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === "providers.detailsLabel") return `${params?.provider} provider details`;
      if (key === "providers.enableLabel") return `Enable ${params?.provider}`;
      if (key === "providers.ready") return "Available";
      if (key === "providers.disabled") return "Disabled";
      if (key === "providers.missing") return "Missing";
      if (key === "providers.loading") return "Loading";
      if (key === "providers.error") return "Error";
      if (key === "providers.modelCount") return `${params?.count} models`;
      if (key === "providers.install") return "Install";
      if (key === "providers.update") return "Update";
      if (key === "providers.installFailed") return "Install failed";
      if (key === "providers.updateFailed") return "Unable to update provider";
      if (key === "settings.integrations.reinstall") return "Reinstall";
      if (key === "settings.integrations.reinstallAgentTool")
        return `Reinstall ${params?.provider}`;
      return key;
    },
  }),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  UnistylesRuntime: {
    pixelRatio: 2,
  },
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: React.ComponentType) => Component,
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    ChevronRight: icon("ChevronRight"),
    Download: icon("Download"),
    RefreshCw: icon("RefreshCw"),
  };
});

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    disabled,
    accessibilityLabel,
    testID,
  }: {
    value: boolean;
    onValueChange?: (next: boolean) => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement("div", {
      role: "switch",
      "aria-checked": value ? "true" : "false",
      "aria-disabled": disabled ? "true" : undefined,
      "aria-label": accessibilityLabel,
      "data-testid": testID ?? "provider-switch",
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation();
        if (disabled) return;
        onValueChange?.(!value);
      },
    }),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", { "data-testid": "loading-spinner" }),
}));

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: (provider: string) => () =>
    React.createElement("span", { "data-icon": `provider-${provider}` }),
}));

vi.mock("@/stores/provider-settings-store", () => ({
  useProviderSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ open: openProviderSettingsMock }),
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: snapshotState.entries,
    isLoading: snapshotState.isLoading,
    isFetching: snapshotState.isFetching,
    isRefreshing: snapshotState.isRefreshing,
    error: snapshotState.error,
    refreshError: snapshotState.refreshError,
    supportsSnapshot: snapshotState.supportsSnapshot,
    refresh: snapshotState.refresh,
    refetchIfStale: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: configState.config,
    isLoading: false,
    patchConfig: patchConfigMock,
  }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => connectionState.value,
  useHostRuntimeClient: () => ({
    runProviderToolingAction: openProviderSettingsMock,
  }),
}));

vi.mock("@/hooks/use-user-visible-error", () => ({
  useUserVisibleErrorReporter: () => vi.fn(),
}));

vi.mock("@/constants/layout", () => ({
  SETTINGS_HINT_LINE_HEIGHT: 16,
  SETTINGS_ROW_HORIZONTAL_PADDING: 16,
  SETTINGS_ROW_TITLE_FONT_SIZE: 14,
  SETTINGS_ROW_TITLE_LINE_HEIGHT: 20,
  useIsCompactFormFactor: () => compactState.value,
}));

import { ProvidersSection } from "./providers-section";

const claudeEntry: ProviderSnapshotEntry = {
  provider: "claude",
  status: "ready",
  enabled: true,
  label: "Claude",
  description: "Claude Code",
  defaultModeId: null,
  modes: [],
  models: [
    { provider: "claude", id: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { provider: "claude", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { provider: "claude", id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

const currentClaudeEntry: ProviderSnapshotEntry = {
  ...claudeEntry,
  installedVersion: "2.1.170",
  latestVersion: "2.1.170",
  versionStatus: "current",
  packageName: "@anthropic-ai/claude-code",
  installAvailable: false,
  updateAvailable: false,
};

const disabledCodexEntry: ProviderSnapshotEntry = {
  provider: "codex",
  status: "unavailable",
  enabled: false,
  label: "Codex",
  description: "OpenAI Codex",
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

function descendants(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>("*"));
}

function indexOfMatches(nodes: HTMLElement[], selector: string): number {
  return nodes.findIndex((node) => node.matches(selector));
}

function indexOfText(nodes: HTMLElement[], text: string): number {
  return nodes.findIndex((node) => node.textContent?.trim() === text);
}

describe("ProvidersSection", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    snapshotState.entries = undefined;
    snapshotState.isLoading = false;
    snapshotState.isFetching = false;
    snapshotState.isRefreshing = false;
    snapshotState.error = null;
    snapshotState.refreshError = null;
    snapshotState.supportsSnapshot = true;
    snapshotState.refresh.mockReset();
    patchConfigMock.mockReset();
    patchConfigMock.mockResolvedValue(undefined);
    openProviderSettingsMock.mockReset();
    compactState.value = false;
    connectionState.value = true;
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
      root?.render(<ProvidersSection serverId="server-1" />);
    });
  }

  function findRow(accessibilityLabel: string): HTMLElement {
    const row = container?.querySelector<HTMLElement>(
      `[role="button"][aria-label="${accessibilityLabel}"]`,
    );
    if (!row) throw new Error(`Expected row with aria-label "${accessibilityLabel}"`);
    return row;
  }

  it("shows a disconnected state when the host runtime is unavailable", () => {
    connectionState.value = false;
    snapshotState.isLoading = false;

    render();

    expect(container?.textContent).toContain("providers.connectToView");
  });

  it("shows an unsupported state instead of provider rows", () => {
    snapshotState.supportsSnapshot = false;
    snapshotState.entries = [claudeEntry];

    render();

    expect(container?.textContent).toContain("providers.unsupported");
    expect(container?.querySelector('[aria-label="Claude provider details"]')).toBeNull();
  });

  it("shows initial loading without rendering provider rows", () => {
    snapshotState.isLoading = true;

    render();

    expect(container?.textContent).toContain("common.loading");
    expect(container?.querySelector('[aria-label="Claude provider details"]')).toBeNull();
  });

  it("shows a query error with a retry action", async () => {
    snapshotState.error = "snapshot failed";
    snapshotState.refresh.mockResolvedValue(undefined);

    render();

    const retry = container?.querySelector<HTMLElement>('[aria-label="common.retry"]');
    expect(container?.textContent).toContain("snapshot failed");
    expect(retry).not.toBeNull();
    await act(async () => {
      retry?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(snapshotState.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows a refresh error with a retry action while retaining rows", async () => {
    snapshotState.entries = [claudeEntry];
    snapshotState.refreshError = "refresh failed";
    snapshotState.refresh.mockResolvedValue(undefined);
    configState.config = makeConfig();

    render();

    const retry = container?.querySelector<HTMLElement>('[aria-label="common.retry"]');
    expect(container?.textContent).toContain("refresh failed");
    expect(retry).not.toBeNull();
    expect(container?.querySelector('[aria-label="Claude provider details"]')).toBeNull();
    await act(async () => {
      retry?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(snapshotState.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["disabled", "Disabled"],
    ["command_unavailable", "providers.commandUnavailable"],
    ["runtime_unavailable", "providers.runtimeUnavailable"],
    ["model_discovery_failed", "providers.modelDiscoveryFailed"],
    ["refresh_failed", "providers.refreshFailed"],
    ["configuration_changed", "providers.configurationChanged"],
  ] as const)("renders the %s status reason", (statusReason, expectedLabel) => {
    snapshotState.entries = [
      {
        ...claudeEntry,
        status: statusReason === "configuration_changed" ? "loading" : "error",
        statusReason,
      },
    ];
    configState.config = makeConfig();

    render();

    expect(container?.textContent).toContain(expectedLabel);
  });

  it("renders a ready provider with no models without a model count", () => {
    snapshotState.entries = [{ ...claudeEntry, models: [] }];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    expect(row.textContent).toContain("Available");
    expect(row.textContent).not.toContain("0 models");
  });

  it("refreshes after a successful toggle", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();
    snapshotState.refresh.mockResolvedValue(undefined);

    render();

    const switchEl =
      findRow("Claude provider details").querySelector<HTMLElement>('[role="switch"]');
    await act(async () => {
      switchEl?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(snapshotState.refresh).toHaveBeenCalledWith(["claude"]);
  });
  it("renders the disabled provider with its server-provided label in snapshot order", () => {
    snapshotState.entries = [claudeEntry, disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();

    const rows = Array.from(
      container?.querySelectorAll<HTMLElement>('[role="button"][aria-label$="provider details"]') ??
        [],
    );
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Claude provider details",
      "Codex provider details",
    ]);

    const codexRow = findRow("Codex provider details");
    const codexNodes = descendants(codexRow);
    expect(JSON.parse(codexRow.dataset.style ?? "{}")).toMatchObject({ borderTopWidth: 0.5 });
    expect(indexOfText(codexNodes, "Codex")).toBeGreaterThanOrEqual(0);
    expect(indexOfText(codexNodes, "codex")).toBe(-1);
    expect(indexOfText(codexNodes, "Disabled")).toBeGreaterThanOrEqual(0);
  });

  it("composes the row as chevron, icon, label, status, model count, then switch", () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    const nodes = descendants(row);
    const chevron = indexOfMatches(nodes, '[data-icon="ChevronRight"]');
    const icon = indexOfMatches(nodes, '[data-icon="provider-claude"]');
    const label = indexOfText(nodes, "Claude");
    const status = indexOfText(nodes, "Available");
    const modelCount = indexOfText(nodes, "3 models");
    const switchEl = indexOfMatches(nodes, '[role="switch"]');

    expect(chevron).toBeGreaterThanOrEqual(0);
    expect(icon).toBeGreaterThan(chevron);
    expect(label).toBeGreaterThan(icon);
    expect(status).toBeGreaterThan(label);
    expect(modelCount).toBeGreaterThan(status);
    expect(switchEl).toBeGreaterThan(modelCount);
  });

  it("opens the diagnostic sheet when the outer row is pressed for a disabled provider", () => {
    snapshotState.entries = [disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();

    expect(openProviderSettingsMock).not.toHaveBeenCalled();

    const row = findRow("Codex provider details");
    act(() => {
      row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(openProviderSettingsMock).toHaveBeenCalledTimes(1);
    expect(openProviderSettingsMock).toHaveBeenCalledWith({
      serverId: "server-1",
      provider: "codex",
    });
  });

  it("toggles the provider enabled flag through patchConfig when the switch is pressed", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    const switchEl = row.querySelector<HTMLElement>('[role="switch"]');
    expect(switchEl).not.toBeNull();
    expect(switchEl?.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      switchEl?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({
      providers: { claude: { enabled: false } },
    });
  });

  it("routes provider reinstall actions through tooling requests", async () => {
    snapshotState.entries = [currentClaudeEntry];
    configState.config = makeConfig();
    openProviderSettingsMock.mockResolvedValue(undefined);

    render();

    const reinstallButton = container?.querySelector<HTMLElement>(
      '[aria-label="Reinstall Claude"]',
    );
    expect(reinstallButton).not.toBeNull();

    await act(async () => {
      reinstallButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(openProviderSettingsMock).toHaveBeenCalledWith("claude", "reinstall");
  });

  it("uses a wrapped compact layout for provider maintenance controls", () => {
    compactState.value = true;
    snapshotState.entries = [
      {
        ...currentClaudeEntry,
        updateAvailable: true,
      },
    ];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    expect(row.getAttribute("data-style")).toContain('"flexDirection":"column"');

    const updateButton = row.querySelector<HTMLElement>('[aria-label="Update"]');
    expect(updateButton).not.toBeNull();
    expect(updateButton?.parentElement?.getAttribute("data-style")).toContain('"flexWrap":"wrap"');
  });
});
