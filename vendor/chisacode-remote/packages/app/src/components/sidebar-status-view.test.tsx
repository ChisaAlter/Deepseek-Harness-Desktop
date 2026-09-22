/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-perf/jsx-no-new-array-as-prop -- test fixtures pass local arrays */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { SidebarStatusView } from "@/components/sidebar-status-view";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const {
  theme,
  setSettledShelfExpandedMock,
  setSnoozedShelfExpandedMock,
  setSettledVisibleCountMock,
  setScopeProjectKeyMock,
  getServerUiStateMock,
} = vi.hoisted(() => ({
  theme: {
    spacing: { 0.5: 2, 1: 4, 2: 8, 3: 12, 4: 16, 8: 32 },
    borderRadius: { sm: 8, md: 6 },
    fontWeight: { medium: "500" },
    borderWidth: { 1: 1 },
    colors: {
      foreground: "#111",
      foregroundMuted: "#666",
      foregroundFaint: "#999",
      accent: "#2a6cf0",
      accentBright: "#3d7dff",
      destructive: "#ef4444",
      success: "#18a34a",
      border: "#ddd",
      surface0: "#fff",
      surface1: "#eee",
      surface3: "#e2e5ec",
      surfaceSidebar: "#f0f1f5",
      surfaceSidebarHover: "#e8eaef",
      statusWarning: "#d97706",
      statusWarningBg: "rgba(217,119,6,0.12)",
    },
    shadow: { sm: {} },
  },
  setSettledShelfExpandedMock: vi.fn(),
  setSnoozedShelfExpandedMock: vi.fn(),
  setSettledVisibleCountMock: vi.fn(),
  setScopeProjectKeyMock: vi.fn(),
  getServerUiStateMock: vi.fn(() => ({
    scopeProjectKey: null,
    settledShelfExpanded: true,
    snoozedShelfExpanded: true,
    settledVisibleCount: 10,
  })),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ rt: { breakpoint: "lg" } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        "sidebar.noHost": "No host connected",
        "sidebar.sessions": "Sessions",
        "sidebarV2.snoozed": "Snoozed",
        "sidebarV2.settled": "Settled",
        "sidebarV2.showMore": `Show ${values?.count ?? 0} more`,
        "sidebarV2.noSearchResults": "No threads found",
        "sidebarV2.noThreadsYet": "No threads yet",
        "sidebarV2.noThreadsInScope": "No threads in this scope yet",
        "sidebarV2.addProject": "Add project",
        "sidebarV2.allProjects": "All projects",
        "sidebarV2.settle": "Settle",
        "sidebarV2.unsettle": "Unsettle",
        "sidebarV2.wake": "Wake",
        "sidebarV2.snooze": "Snooze",
        "sidebarV2.rename": "Rename",
        "sidebarV2.regenerateTitle": "Regenerate title",
        "sidebarV2.markUnread": "Mark unread",
        "sidebarV2.delete": "Delete",
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("@/components/themed-icon-host", () => ({
  ThemedIconHost: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({
    children,
    testID,
    onPress,
  }: {
    children: React.ReactNode;
    testID?: string;
    onPress?: () => void;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuSeparator: () => <div role="separator" />,
  ContextMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    testID,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div role="separator" />,
}));

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: () => () => null,
}));

vi.mock("@/sidebar-v2/store", () => ({
  sidebarV2ThreadKey: (serverId: string, threadId: string) => `${serverId}:${threadId}`,
  useSidebarV2Store: (
    selector: (state: {
      getServerUiState: typeof getServerUiStateMock;
      setSettledShelfExpanded: typeof setSettledShelfExpandedMock;
      setSnoozedShelfExpanded: typeof setSnoozedShelfExpandedMock;
      setSettledVisibleCount: typeof setSettledVisibleCountMock;
      setScopeProjectKey: typeof setScopeProjectKeyMock;
      localUnreadCompletedAtByKey: Record<string, string>;
      selectedThreadKeys: string[];
      toggleThreadSelected: (key: string) => void;
      rangeSelectThreads: (key: string, ordered: readonly string[]) => void;
      clearSelection: () => void;
    }) => unknown,
  ) =>
    selector({
      getServerUiState: getServerUiStateMock,
      setSettledShelfExpanded: setSettledShelfExpandedMock,
      setSnoozedShelfExpanded: setSnoozedShelfExpandedMock,
      setSettledVisibleCount: setSettledVisibleCountMock,
      setScopeProjectKey: setScopeProjectKeyMock,
      localUnreadCompletedAtByKey: {},
      selectedThreadKeys: [],
      toggleThreadSelected: vi.fn(),
      rangeSelectThreads: vi.fn(),
      clearSelection: vi.fn(),
    }),
}));

vi.mock("@/utils/navigate-to-agent", () => ({
  navigateToAgent: vi.fn(),
}));

vi.mock("@/utils/agent-history-navigation", () => ({
  rememberArchivedAgentDetail: vi.fn(),
}));

vi.mock("lucide-react-native", () => ({
  AlarmClock: () => null,
  Check: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  Folder: () => null,
  FolderPlus: () => null,
  Plus: () => null,
  Undo2: () => null,
}));

function agent(input: Partial<AggregatedAgent> & { id: string; cwd: string }): AggregatedAgent {
  const updatedAt = input.lastActivityAt ?? new Date();
  return {
    id: input.id,
    serverId: input.serverId ?? "server-1",
    serverLabel: input.serverLabel ?? "Local",
    title: input.title ?? "Thread",
    status: input.status ?? "closed",
    lastActivityAt: updatedAt,
    cwd: input.cwd,
    provider: input.provider ?? "codex",
    pendingPermissionCount: input.pendingPermissionCount ?? 0,
    requiresAttention: input.requiresAttention ?? false,
    attentionReason: input.attentionReason ?? null,
    attentionTimestamp: input.attentionTimestamp ?? null,
    archivedAt: input.archivedAt ?? null,
    createdAt: input.createdAt ?? updatedAt,
    labels: input.labels ?? {},
    projectPlacement: input.projectPlacement ?? null,
  };
}

describe("SidebarStatusView", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    setSettledShelfExpandedMock.mockReset();
    setSnoozedShelfExpandedMock.mockReset();
    setSettledVisibleCountMock.mockReset();
    setScopeProjectKeyMock.mockReset();
    getServerUiStateMock.mockReturnValue({
      scopeProjectKey: null,
      settledShelfExpanded: true,
      snoozedShelfExpanded: true,
      settledVisibleCount: 10,
    });
    vi.mocked(navigateToAgent).mockReset();
  });

  it("renders active and settled shelves and navigates on row press", () => {
    const recent = new Date();
    const settledAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const agents = [
      agent({
        id: "agent-active",
        cwd: "/repo/a",
        title: "Active thread",
        lastActivityAt: recent,
        createdAt: recent,
      }),
      agent({
        id: "agent-settled",
        cwd: "/repo/a",
        title: "Settled thread",
        lastActivityAt: settledAt,
        createdAt: settledAt,
        labels: {
          "chisacode.sidebarSettledAt": settledAt.toISOString(),
          "chisacode.sidebarSettledOverride": "settled",
        },
      }),
    ];

    render(
      <SidebarStatusView
        agents={agents}
        serverId="server-1"
        selectedAgentId="server-1:agent-active"
        onSnooze={vi.fn()}
        onWake={vi.fn()}
        onSettle={vi.fn()}
        onUnsettle={vi.fn()}
        onRegenerateTitle={vi.fn()}
        onMarkUnread={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    expect(screen.getByTestId("sidebar-status-view")).toBeTruthy();
    expect(screen.getByTestId("sidebar-v2-thread-agent-active")).toBeTruthy();
    expect(screen.getByTestId("sidebar-v2-thread-agent-settled")).toBeTruthy();
    expect(screen.getByText("Active thread")).toBeTruthy();
    expect(screen.getByText("Settled thread")).toBeTruthy();

    fireEvent.click(screen.getByTestId("sidebar-v2-thread-agent-settled"));
    expect(navigateToAgent).toHaveBeenCalledWith({
      serverId: "server-1",
      agentId: "agent-settled",
      pin: false,
    });
  });

  it("filters by search query", () => {
    const recent = new Date();
    const agents = [
      agent({
        id: "agent-1",
        cwd: "/repo/a",
        title: "Gateway rewrite",
        lastActivityAt: recent,
        createdAt: recent,
      }),
      agent({
        id: "agent-2",
        cwd: "/repo/a",
        title: "Sidebar shelves",
        lastActivityAt: recent,
        createdAt: recent,
      }),
    ];

    render(
      <SidebarStatusView
        agents={agents}
        serverId="server-1"
        searchQuery="gateway"
        onSnooze={vi.fn()}
        onWake={vi.fn()}
        onSettle={vi.fn()}
        onUnsettle={vi.fn()}
        onRegenerateTitle={vi.fn()}
        onMarkUnread={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    expect(screen.getByText("Gateway rewrite")).toBeTruthy();
    expect(screen.queryByText("Sidebar shelves")).toBeNull();
  });

  it("shows the repo basename (not owner/repo) in the project scope dropdown", () => {
    const recent = new Date();
    const agents = [
      agent({
        id: "agent-owner",
        cwd: "/repo/ChisaTerminal",
        title: "Owner repo thread",
        lastActivityAt: recent,
        createdAt: recent,
        projectPlacement: {
          projectKey: "remote:github.com/ayasealter/ChisaTerminal",
          projectName: "ayasealter/ChisaTerminal",
          checkout: {
            cwd: "/repo/ChisaTerminal",
            isGit: false,
            currentBranch: null,
            remoteUrl: null,
            worktreeRoot: null,
            isChisaCodeOwnedWorktree: false,
            mainRepoRoot: null,
          },
        },
      }),
    ];

    render(
      <SidebarStatusView
        agents={agents}
        serverId="server-1"
        onSnooze={vi.fn()}
        onWake={vi.fn()}
        onSettle={vi.fn()}
        onUnsettle={vi.fn()}
        onRegenerateTitle={vi.fn()}
        onMarkUnread={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    // Scope dropdown label + option use the short basename (card also shows it).
    const shortLabels = screen.getAllByText("ChisaTerminal");
    expect(shortLabels.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("ayasealter/ChisaTerminal")).toBeNull();
  });
});
