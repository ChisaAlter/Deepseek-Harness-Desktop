/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSkillsListResponse } from "@chisacode/protocol/messages";

const { clientMock, connectedState, theme } = vi.hoisted(() => ({
  clientMock: {
    listAgentSkills: vi.fn(),
    patchAgentSkillPolicy: vi.fn(),
    installAgentSkills: vi.fn(),
    uninstallAgentSkill: vi.fn(),
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
  Download: () => <span />,
  FolderInput: () => <span />,
  Plus: () => <span />,
  RefreshCw: () => <span />,
  Search: () => <span />,
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
    t: (key: string) =>
      ({
        "common.cancel": "取消",
        "settings.skills.all": "全部",
        "settings.skills.create": "创建",
        "settings.skills.empty": "未发现技能",
        "settings.skills.install": "安装",
        "settings.skills.installLocal": "从本地安装",
        "settings.skills.installLocalTitle": "从本地安装技能",
        "settings.skills.installUrl": "从 URL 安装",
        "settings.skills.installUrlTitle": "从 URL 安装技能",
        "settings.skills.nextLoad": "下次加载生效",
        "settings.skills.noDescription": "无描述",
        "settings.skills.noHost": "没有可用主机",
        "settings.skills.noSearchResults": "没有匹配的技能",
        "settings.skills.refresh": "刷新",
        "settings.skills.searchPlaceholder": "搜索技能",
        "settings.skills.title": "技能",
        "settings.skills.uninstall": "卸载",
        "settings.skills.urlPlaceholder": "GitHub URL 或 owner/repo",
        "settings.skills.localPlaceholder": "本地技能目录或父目录路径",
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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({
    children,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean; open: boolean }) => React.ReactNode);
  }) => (
    <button type="button">
      {typeof children === "function"
        ? children({ pressed: false, hovered: false, open: false })
        : children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children?: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
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

const skillsPayload: AgentSkillsListResponse["payload"] = {
  requestId: "skills",
  scopes: [
    { type: "global", label: "Global" },
    { type: "provider", provider: "claude", label: "Claude" },
    { type: "provider", provider: "codex", label: "Codex" },
    { type: "provider", provider: "opencode", label: "OpenCode" },
    { type: "provider", provider: "pi", label: "Pi" },
    { type: "provider", provider: "kimi", label: "Kimi Code" },
    { type: "provider", provider: "grokbuild", label: "Grok Build" },
    { type: "agent", agentId: "agent-codex", label: "Codex workspace", status: "idle" },
    { type: "agent", agentId: "agent-claude", label: "Claude workspace", status: "running" },
  ],
  skills: [
    {
      name: "review",
      description: "Review code",
      sources: [{ id: "review", type: "codex-home", path: "/skills/review", removable: false }],
      statusByScope: {
        global: "enabled",
        providers: { codex: "enabled", claude: "enabled" },
        agents: { "agent-codex": "agent-disabled", "agent-claude": "enabled" },
      },
      errors: [],
    },
    {
      name: "security-review",
      description: "Security audit",
      sources: [
        { id: "security-review", type: "codex-home", path: "/skills/security", removable: false },
      ],
      statusByScope: {
        global: "enabled",
        providers: { codex: "enabled", claude: "enabled" },
        agents: { "agent-codex": "enabled", "agent-claude": "enabled" },
      },
      errors: [],
    },
  ],
  policy: {
    global: { disabledSkillNames: [] },
    providers: {},
    agents: {},
    installedSources: {},
  },
  errors: [],
};

describe("SkillsSection", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    clientMock.listAgentSkills.mockResolvedValue(skillsPayload);
    clientMock.patchAgentSkillPolicy.mockResolvedValue({ ok: true, policy: skillsPayload.policy });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  async function renderSection(): Promise<void> {
    const { SkillsSection } = await import("./skills-section");
    await act(async () => {
      root.render(<SkillsSection serverId="server-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("shows all provider scopes and filters skills by search", async () => {
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
    expect(host.textContent).toContain("Codex workspace");
    expect(host.textContent).toContain("Claude workspace");

    const searchInput = host.querySelector('input[placeholder="搜索技能"]');
    expect(searchInput).not.toBeNull();
    await act(async () => {
      searchInput?.dispatchEvent(new Event("input", { bubbles: true }));
      Object.defineProperty(searchInput, "value", { value: "security", configurable: true });
      searchInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(host.textContent).toContain("security-review");
    expect(host.textContent).not.toContain("Review code");
  });

  it("opens install modal from create menu and patches provider policy", async () => {
    await renderSection();

    const createButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "创建",
    );
    await act(async () => {
      createButton?.click();
    });

    expect(host.textContent).toContain("从 URL 安装");
    expect(host.textContent).toContain("从本地安装");

    const buttons = [...host.querySelectorAll("button")];
    const codexButton = buttons.find((button) => button.textContent === "Codex");
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

    expect(clientMock.patchAgentSkillPolicy).toHaveBeenCalledWith({
      scope: { type: "provider", provider: "codex" },
      policy: { enabledSkillNames: [], disabledSkillNames: ["review"] },
    });
  });

  it("patches the selected agent policy instead of reusing the shared skill scope", async () => {
    await renderSection();

    const agentButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Codex workspace",
    );
    await act(async () => {
      agentButton?.click();
    });

    expect(host.textContent).toContain("Codex workspace");
    expect(host.textContent).toContain("Agent disabled");

    const disabledSwitch = [...host.querySelectorAll('button[aria-pressed="false"]')][0] as
      | HTMLElement
      | undefined;
    await act(async () => {
      disabledSwitch?.click();
      await Promise.resolve();
    });

    expect(clientMock.patchAgentSkillPolicy).toHaveBeenCalledWith({
      scope: { type: "agent", agentId: "agent-codex" },
      policy: { enabledSkillNames: ["review"], disabledSkillNames: [] },
    });
  });
});
