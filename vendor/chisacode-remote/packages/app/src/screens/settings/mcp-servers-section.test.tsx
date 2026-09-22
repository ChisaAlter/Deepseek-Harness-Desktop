/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMcpServersListResponse } from "@chisacode/protocol/messages";

const { clientMock, connectedState, theme } = vi.hoisted(() => ({
  clientMock: {
    listAgentMcpServers: vi.fn(),
    patchAgentMcpServerPolicy: vi.fn(),
    upsertAgentMcpServer: vi.fn(),
    deleteAgentMcpServer: vi.fn(),
  },
  connectedState: { value: true },
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
    iconSize: { sm: 14 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400", medium: "500" },
    borderRadius: { md: 6, lg: 8, xl: 12 },
    opacity: { 50: 0.5 },
    glass: { enabled: false },
    colors: {
      primary: "#111",
      primaryForeground: "#fff",
      surface0: "#fff",
      foreground: "#111",
      foregroundMuted: "#666",
      border: "#ddd",
      borderAccent: "#ccc",
    },
    shadow: { md: {}, lg: {} },
  },
}));

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "web" },
  Dimensions: { get: () => ({ width: 1600, height: 900 }) },
  Modal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? <div>{children}</div> : null,
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
  View: React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(({ children }, ref) => (
    <div ref={ref}>{children}</div>
  )),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TextInput: ({
    value,
    onChangeText,
    placeholder,
  }: {
    value?: string;
    onChangeText?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChangeText?.(event.currentTarget.value)}
    />
  ),
}));

vi.mock("lucide-react-native", () => ({
  Edit3: () => <span />,
  Globe2: () => <span />,
  Plus: () => <span />,
  RefreshCw: () => <span />,
  Search: () => <span />,
  Server: () => <span />,
  Terminal: () => <span />,
  Trash2: () => <span />,
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) => (typeof styles === "function" ? styles(theme) : styles),
  },
  useUnistyles: () => ({ theme }),
  UnistylesRuntime: { pixelRatio: 1 },
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      ({
        "common.cancel": "取消",
        "common.save": "保存",
        "settings.mcpServers.all": "全部",
        "settings.mcpServers.create": "创建",
        "settings.mcpServers.createStdio": "创建 stdio 服务器",
        "settings.mcpServers.createStdioTitle": "创建 stdio MCP 服务器",
        "settings.mcpServers.createUrl": "创建 URL 服务器",
        "settings.mcpServers.createUrlTitle": "创建 URL MCP 服务器",
        "settings.mcpServers.delete": "删除",
        "settings.mcpServers.deleteMessage": `删除 ${values?.name ?? ""}`,
        "settings.mcpServers.deleteTitle": "删除 MCP 服务器",
        "settings.mcpServers.descriptionPlaceholder": "描述（可选）",
        "settings.mcpServers.edit": "编辑",
        "settings.mcpServers.editTitle": "编辑 MCP 服务器",
        "settings.mcpServers.empty": "未配置 MCP 服务器",
        "settings.mcpServers.headersPlaceholder": "请求头 JSON",
        "settings.mcpServers.labelPlaceholder": "显示名称（可选）",
        "settings.mcpServers.namePlaceholder": "服务器名称，例如 github",
        "settings.mcpServers.nextLoad": "下次加载生效",
        "settings.mcpServers.noHost": "没有可用主机",
        "settings.mcpServers.noSearchResults": "没有匹配的 MCP 服务器",
        "settings.mcpServers.refresh": "刷新",
        "settings.mcpServers.searchPlaceholder": "搜索 MCP 服务器",
        "settings.mcpServers.title": "MCP 服务器",
        "settings.mcpServers.urlPlaceholder": "URL",
      })[key] ?? key,
  }),
}));

vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const callbackRef = React.useRef(callback);
    callbackRef.current = callback;
    React.useEffect(() => callbackRef.current(), [callbackRef]);
  },
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => clientMock,
  useHostRuntimeIsConnected: () => connectedState.value,
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
  }) => (
    <section>
      <h1>{title}</h1>
      {trailing}
      {children}
    </section>
  ),
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
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
  }: {
    value: boolean;
    onValueChange?: (value: boolean) => void;
  }) => (
    <button type="button" aria-pressed={value} onClick={() => onValueChange?.(!value)}>
      switch
    </button>
  ),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => <span>loading</span>,
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    header,
    children,
    footer,
  }: {
    visible: boolean;
    header: { title: string };
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    visible ? (
      <div role="dialog">
        <h2>{header.title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
}));

const mcpPayload: AgentMcpServersListResponse["payload"] = {
  requestId: "mcp",
  scopes: [
    { type: "global", label: "Global" },
    { type: "provider", provider: "claude", label: "Claude" },
    { type: "provider", provider: "codex", label: "Codex" },
    { type: "provider", provider: "opencode", label: "OpenCode" },
    { type: "provider", provider: "pi", label: "Pi" },
    { type: "provider", provider: "kimi", label: "Kimi Code" },
    { type: "provider", provider: "grokbuild", label: "Grok Build" },
  ],
  servers: [
    {
      name: "chisacode",
      label: "ChisaCode 工具",
      description: "系统内置",
      source: "system",
      removable: false,
      editable: false,
      config: { type: "http", url: "http://127.0.0.1:6767/mcp/agents" },
      statusByScope: { global: "enabled", providers: { codex: "enabled" }, agents: {} },
      errors: [],
    },
    {
      name: "github",
      label: "GitHub",
      source: "user",
      removable: true,
      editable: true,
      config: { type: "stdio", command: "npx", args: ["-y", "server"] },
      statusByScope: { global: "enabled", providers: { codex: "enabled" }, agents: {} },
      errors: [],
    },
  ],
  policy: {
    servers: {},
    global: { disabledServerNames: [] },
    providers: {},
    agents: {},
  },
  errors: [],
};

describe("McpServersSection", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    clientMock.listAgentMcpServers.mockResolvedValue(mcpPayload);
    clientMock.patchAgentMcpServerPolicy.mockResolvedValue({ ok: true, policy: mcpPayload.policy });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  async function renderSection(): Promise<void> {
    const { McpServersSection } = await import("./mcp-servers-section");
    await act(async () => {
      root.render(<McpServersSection serverId="server-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("shows all provider scopes and filters MCP servers by search", async () => {
    await renderSection();

    expect(host.textContent).toContain("全部");
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "Claude"),
    ).toBe(true);
    expect(host.textContent).toContain("Codex");
    expect(host.textContent).toContain("OpenCode");
    expect(host.textContent).toContain("Pi");
    expect(host.textContent).toContain("Kimi Code");
    expect(host.textContent).toContain("Grok Build");

    const searchInput = host.querySelector('input[placeholder="搜索 MCP 服务器"]');
    expect(searchInput).not.toBeNull();
    await act(async () => {
      Object.defineProperty(searchInput, "value", { value: "github", configurable: true });
      searchInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(host.textContent).toContain("GitHub");
    expect(host.textContent).not.toContain("ChisaCode 工具");
  });

  it("opens create menu and patches provider policy", async () => {
    await renderSection();

    const createButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "创建",
    );
    await act(async () => {
      createButton?.click();
    });

    expect(host.textContent).toContain("创建 stdio 服务器");
    expect(host.textContent).toContain("创建 URL 服务器");

    const urlButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "创建 URL 服务器",
    );
    await act(async () => {
      urlButton?.click();
    });

    expect(host.textContent).toContain("创建 URL MCP 服务器");
    expect(host.textContent).toContain("HTTP");
    expect(host.textContent).toContain("SSE");

    const codexButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Codex",
    );
    await act(async () => {
      codexButton?.click();
    });

    const switchButton = [...host.querySelectorAll('button[aria-pressed="true"]')][0] as
      | HTMLElement
      | undefined;
    await act(async () => {
      switchButton?.click();
      await Promise.resolve();
    });

    expect(clientMock.patchAgentMcpServerPolicy).toHaveBeenCalledWith({
      scope: { type: "provider", provider: "codex" },
      policy: { enabledServerNames: [], disabledServerNames: ["chisacode"] },
    });
  });
});
