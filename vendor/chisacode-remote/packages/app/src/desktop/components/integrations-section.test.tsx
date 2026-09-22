/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";

const {
  theme,
  providerEntriesState,
  refreshProvidersMock,
  runProviderToolingActionMock,
  localServerIdState,
} = vi.hoisted(() => ({
  theme: {
    spacing: { 0: 0, 1: 4, "1.5": 6, 2: 8, 3: 12, 4: 16 },
    iconSize: { sm: 14, md: 20 },
    fontSize: { xs: 11, sm: 13 },
    fontWeight: { normal: "400", medium: "500" },
    borderRadius: { lg: 8 },
    opacity: { 50: 0.5 },
    glass: { enabled: false },
    colors: {
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      borderAccent: "#666",
      accent: "#0a84ff",
      destructive: "#ff3b30",
      palette: { white: "#fff" },
    },
    shadow: { sm: {} },
  },
  providerEntriesState: {
    entries: [] as ProviderSnapshotEntry[],
    isLoading: false,
  },
  refreshProvidersMock: vi.fn(async () => undefined),
  runProviderToolingActionMock: vi.fn(async () => ({
    provider: "claude",
    action: "install",
    exitCode: 0,
    stdout: "",
    stderr: "",
    success: true,
  })),
  localServerIdState: { value: "local-server" as string | null },
}));

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "web" },
  View: ({
    children,
    testID,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    testID?: string;
    accessibilityLabel?: string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": testID, "aria-label": accessibilityLabel },
      children,
    ),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Pressable: ({
    children,
    onPress,
    accessibilityRole,
    accessibilityLabel,
    disabled,
    testID,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    onPress?: (event: React.MouseEvent) => void;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        role: accessibilityRole,
        "aria-label": accessibilityLabel,
        "aria-disabled": disabled ? "true" : undefined,
        "data-testid": testID,
        disabled,
        onClick: disabled ? undefined : onPress,
      },
      typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
    ),
  ActivityIndicator: () => React.createElement("span", { "data-testid": "activity-indicator" }),
}));

vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => undefined | (() => void)) => {
    React.useEffect(() => callback(), [callback]);
  },
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
    ArrowUpRight: icon("ArrowUpRight"),
    Terminal: icon("Terminal"),
    Blocks: icon("Blocks"),
    Check: icon("Check"),
    Download: icon("Download"),
    RefreshCw: icon("RefreshCw"),
  };
});

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: (provider: string) => () =>
    React.createElement("span", { "data-icon": `provider-${provider}` }),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", { "data-testid": "loading-spinner" }),
}));

vi.mock("@/desktop/daemon/desktop-daemon", () => ({
  shouldUseDesktopDaemon: () => true,
}));

vi.mock("@/desktop/hooks/use-install-status", () => ({
  useCliInstall: () => ({
    status: { installed: true },
    isInstalling: false,
    install: vi.fn(),
    refresh: vi.fn(),
  }),
  useSkillsStatus: () => ({
    status: { state: "up-to-date", ops: [] },
    isWorking: false,
    install: vi.fn(),
    update: vi.fn(),
    uninstall: vi.fn(),
    refresh: vi.fn(async () => undefined),
  }),
}));

vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: vi.fn(async () => undefined),
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => true),
}));

vi.mock("@/hooks/use-is-local-daemon", () => ({
  useLocalDaemonServerId: () => localServerIdState.value,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    runProviderToolingAction: runProviderToolingActionMock,
  }),
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: providerEntriesState.entries,
    isLoading: providerEntriesState.isLoading,
    isFetching: false,
    isRefreshing: false,
    error: null,
    supportsSnapshot: true,
    refresh: refreshProvidersMock,
    refetchIfStale: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      const translations: Record<string, string> = {
        "common.loading": "加载中",
        "providers.notInstalled": "未安装",
        "providers.update": "更新",
        "providers.install": "安装",
        "providers.installFailed": "安装失败",
        "settings.integrations.title": "集成",
        "settings.integrations.cliDocs": "CLI 文档",
        "settings.integrations.skillsDocs": "技能文档",
        "settings.integrations.openCliDocs": "打开 CLI 文档",
        "settings.integrations.openSkillsDocs": "打开技能文档",
        "settings.integrations.commandLine": "命令行",
        "settings.integrations.commandLineHint": "从终端控制智能体并编写自动化脚本",
        "settings.integrations.orchestrationSkills": "编排技能",
        "settings.integrations.skillsUpToDateHint": "让你的智能体通过 CLI 进行编排",
        "settings.integrations.installed": "已安装",
        "settings.integrations.uninstall": "卸载",
        "settings.integrations.agentTools": "智能体工具",
        "settings.integrations.currentVersion": `当前版本：${values?.version ?? ""}`,
        "settings.integrations.latestVersion": `最新版本：${values?.version ?? ""}`,
        "settings.integrations.versionNotChecked": "未检测",
        "settings.integrations.versionUnknown": "未知",
        "settings.integrations.versionCurrent": "已是最新",
        "settings.integrations.versionOutdated": "有新版本可用",
        "settings.integrations.checkingLatestVersion": "检测中",
        "settings.integrations.checkLatestVersion": "检测最新版本",
        "settings.integrations.checkAgentLatestVersion": `检测 ${values?.provider ?? ""} 最新版本`,
        "settings.integrations.installAgentTool": `安装 ${values?.provider ?? ""}`,
        "settings.integrations.updateAgentTool": `更新 ${values?.provider ?? ""}`,
        "settings.integrations.reinstallAgentTool": `重装 ${values?.provider ?? ""}`,
        "settings.integrations.reinstall": "重装",
      };
      return translations[key] ?? key;
    },
  }),
}));

import {
  getAgentToolVersionView,
  IntegrationsSection,
  type AgentToolAction,
} from "./integrations-section";
import { openExternalUrl } from "@/utils/open-external-url";

function providerEntry(
  input: Partial<ProviderSnapshotEntry> & { provider: string },
): ProviderSnapshotEntry {
  return {
    provider: input.provider,
    status: input.status ?? "ready",
    enabled: input.enabled ?? true,
    label: input.label ?? input.provider,
    description: input.description ?? "",
    defaultModeId: null,
    modes: [],
    installedVersion: input.installedVersion,
    latestVersion: input.latestVersion,
    versionStatus: input.versionStatus,
    installAvailable: input.installAvailable,
    updateAvailable: input.updateAvailable,
    checkedAt: input.checkedAt,
  };
}

describe("getAgentToolVersionView", () => {
  it.each([
    {
      name: "not installed",
      entry: providerEntry({
        provider: "claude",
        status: "unavailable",
        installedVersion: null,
        latestVersion: "2.1.170",
        versionStatus: "not-installed",
      }),
      actions: ["check", "install"] satisfies AgentToolAction[],
      currentVersion: "not-installed",
      latestVersion: "2.1.170",
      status: "not-installed",
    },
    {
      name: "current",
      entry: providerEntry({
        provider: "codex",
        installedVersion: "0.134.0",
        latestVersion: "0.134.0",
        versionStatus: "current",
      }),
      actions: ["check", "reinstall"] satisfies AgentToolAction[],
      currentVersion: "0.134.0",
      latestVersion: "0.134.0",
      status: "current",
    },
    {
      name: "outdated",
      entry: providerEntry({
        provider: "opencode",
        installedVersion: "1.16.2",
        latestVersion: "1.16.3",
        versionStatus: "outdated",
      }),
      actions: ["check", "update", "reinstall"] satisfies AgentToolAction[],
      currentVersion: "1.16.2",
      latestVersion: "1.16.3",
      status: "outdated",
    },
    {
      name: "latest unknown",
      entry: providerEntry({
        provider: "pi",
        installedVersion: "0.78.1",
        latestVersion: null,
        versionStatus: "unknown",
      }),
      actions: ["check", "reinstall"] satisfies AgentToolAction[],
      currentVersion: "0.78.1",
      latestVersion: "unknown",
      status: "unknown",
    },
  ])(
    "maps $name state to versions and actions",
    ({ entry, actions, currentVersion, latestVersion, status }) => {
      expect(getAgentToolVersionView(entry)).toMatchObject({
        actions,
        currentVersion,
        latestVersion,
        status,
      });
    },
  );
});

describe("IntegrationsSection agent tools", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    providerEntriesState.entries = [
      providerEntry({
        provider: "claude",
        installedVersion: "2.1.170",
        latestVersion: "2.1.171",
        versionStatus: "outdated",
      }),
      providerEntry({
        provider: "codex",
        installedVersion: "0.134.0",
        latestVersion: "0.134.0",
        versionStatus: "current",
      }),
      providerEntry({
        provider: "opencode",
        status: "unavailable",
        installedVersion: null,
        latestVersion: "1.16.2",
        versionStatus: "not-installed",
      }),
      providerEntry({
        provider: "pi",
        installedVersion: "0.78.1",
        latestVersion: null,
        versionStatus: "unknown",
      }),
      providerEntry({
        provider: "kimi",
        installedVersion: "1.43.0",
        latestVersion: "1.43.0",
        versionStatus: "current",
      }),
    ];
    refreshProvidersMock.mockClear();
    runProviderToolingActionMock.mockClear();
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  function render(): void {
    act(() => {
      root?.render(<IntegrationsSection />);
    });
  }

  function click(label: string): void {
    const button = container?.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    if (!button) throw new Error(`Missing button: ${label}`);
    act(() => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
  }

  it("renders detailed current and latest version text plus status actions", () => {
    render();

    expect(container?.textContent).toContain("当前版本：v2.1.170");
    expect(container?.textContent).toContain("最新版本：v2.1.171");
    expect(container?.textContent).toContain("有新版本可用");
    expect(container?.textContent).toContain("当前版本：未安装");
    expect(container?.textContent).toContain("当前版本：v0.78.1");
    expect(container?.textContent).toContain("最新版本：未知");
    expect(container?.querySelector('[aria-label="检测 Claude Code 最新版本"]')).not.toBeNull();
    expect(container?.querySelector('[aria-label="更新 Claude Code"]')).not.toBeNull();
    expect(container?.querySelector('[aria-label="重装 Codex"]')).not.toBeNull();
    expect(container?.querySelector('[aria-label="安装 OpenCode"]')).not.toBeNull();
  });

  it("opens the GitHub documentation links", () => {
    render();

    click("打开 CLI 文档");
    click("打开技能文档");

    expect(openExternalUrl).toHaveBeenNthCalledWith(
      1,
      "https://github.com/ChisaAlter/ChisaCode/blob/cn-main/docs/cli.md",
    );
    expect(openExternalUrl).toHaveBeenNthCalledWith(
      2,
      "https://github.com/ChisaAlter/ChisaCode/blob/cn-main/docs/skills.md",
    );
  });

  it("refreshes only the clicked provider when checking versions", () => {
    render();

    click("检测 Claude Code 最新版本");

    expect(refreshProvidersMock).toHaveBeenCalledWith(["claude"]);
  });

  it("routes install, update, and reinstall to the correct tooling action", async () => {
    render();

    click("更新 Claude Code");
    await act(async () => undefined);
    click("安装 OpenCode");
    await act(async () => undefined);
    click("重装 Codex");
    await act(async () => undefined);

    expect(runProviderToolingActionMock).toHaveBeenNthCalledWith(1, "claude", "update");
    expect(runProviderToolingActionMock).toHaveBeenNthCalledWith(2, "opencode", "install");
    expect(runProviderToolingActionMock).toHaveBeenNthCalledWith(3, "codex", "reinstall");
  });
});
