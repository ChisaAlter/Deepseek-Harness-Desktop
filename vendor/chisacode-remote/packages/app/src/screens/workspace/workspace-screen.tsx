import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused, useRouter, type Href } from "expo-router";

import { StyleSheet } from "react-native-unistyles";
import { resolveThemeWorkbenchSurfaceRoles } from "@/styles/workbench-surface-roles";
import { useTranslation } from "react-i18next";
import { ErrorBoundary, SectionErrorFallback } from "@/components/error-boundary";
import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
import { ExplorerSidebar } from "@/components/explorer-sidebar";
import { useGitActions } from "@/git/use-actions";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { ExplorerSidebarAnimationProvider } from "@/contexts/explorer-sidebar-animation-context";
import { useToast } from "@/contexts/toast-context";
import { usePanelStore } from "@/stores/panel-store";
import { useWorkspaceLayoutChrome } from "@/screens/workspace/use-workspace-layout-chrome";
import { WorkspaceRightPanel } from "@/screens/workspace/workspace-right-panel";
import { WorkspaceTerminalDrawer } from "@/screens/workspace/workspace-terminal-drawer";
import { WorkspaceDesktopSoftTopbar } from "@/screens/workspace/workspace-header";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
  useWorkspaceLayoutStoreHydrated,
} from "@/stores/workspace-layout-store";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useWorkspaceTerminalSessionRetention } from "@/terminal/hooks/use-workspace-terminal-session-retention";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import { checkoutStatusQueryKey } from "@/git/query-keys";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useBrowserStore } from "@/stores/browser-store";
import { createWorkspaceBrowser } from "@/stores/browser-store";
import { getDesktopHost } from "@/desktop/host";
import { WorkspaceTabPresentationResolver } from "@/screens/workspace/workspace-tab-presentation";
import {
  getWorkspaceExecutionAuthority,
  resolveWorkspaceRouteId,
  type WorkspaceExecutionAuthorityResult,
} from "@/utils/workspace-execution";
import { useWorkspaceKeyboardActions } from "@/screens/workspace/use-workspace-keyboard-actions";
import { useWorkspacePersistenceHydration } from "@/screens/workspace/use-workspace-persistence-hydration";
import { useWorkspaceDockActions } from "@/screens/workspace/use-workspace-dock-actions";
import { useWorkspacePaneContentModels } from "@/screens/workspace/use-workspace-pane-content-models";
import { useWorkspaceEnvironmentPanelState } from "@/screens/workspace/use-workspace-environment-panel-state";
import { useWorkspaceEnvironmentData } from "@/screens/workspace/use-workspace-environment-data";
import { useWorkspaceUtilityActions } from "@/screens/workspace/use-workspace-utility-actions";
import { WORKSPACE_ENVIRONMENT_PANEL_WIDTH } from "@/screens/workspace/workspace-environment-panel";
import {
  WorkspaceCenterColumn,
  WorkspaceScreenGateShell,
} from "@/screens/workspace/workspace-center-column";
import { useWorkspaceExplorerActions } from "@/screens/workspace/use-workspace-explorer-actions";
import { useWorkspaceOpenIntent } from "@/screens/workspace/use-workspace-open-intent";
import {
  resolveWorkspaceHeaderRenderState,
  type WorkspaceHeaderCheckoutState,
} from "@/screens/workspace/workspace-header-source";
import {
  resolveWorkspaceRouteState,
  selectWorkspaceRouteContent,
  type WorkspaceRouteState,
} from "@/screens/workspace/workspace-route-state";
import { useWorkspaceRouteLoadingTimedOut } from "@/screens/workspace/use-workspace-route-loading-timeout";
import {
  renderWorkspaceRouteGate,
  WorkspaceReconnectingBanner,
} from "@/screens/workspace/workspace-route-state-views";
import { WorkspaceFocusProvider } from "@/workspace/focus";
import { generateDraftId } from "@/stores/draft-keys";
import type { WorkspaceFileLocation } from "@/workspace/file-open";

import { useIsCompactFormFactor } from "@/constants/layout";
import { getIsElectron, isNative, isWeb } from "@/constants/platform";
import { buildHostRootRoute, buildSettingsHostRoute } from "@/utils/host-routes";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { canCreateWorkspaceTerminal } from "@/screens/workspace/terminals/state";
import { useWorkspaceTerminals } from "@/screens/workspace/terminals/use-workspace-terminals";
import { shouldEnableWorkspaceReviewArchiveAction } from "@/screens/workspace/workspace-environment-panel-model";
import {
  buildBrowserContextSummary,
  type BrowserContextSummary,
} from "@/screens/workspace/workspace-environment-dock-model";

const WORKSPACE_FLOATING_PANEL_PORTAL_HOST_PREFIX = "workspace-floating-panels";
const EMPTY_WORKSPACE_SCRIPTS: WorkspaceDescriptor["scripts"] = [];

const EMPTY_GIT_ACTION_ICON = <View />;
const REVIEW_CALLOUT_GIT_ACTION_ICONS = {
  commit: EMPTY_GIT_ACTION_ICON,
  pull: EMPTY_GIT_ACTION_ICON,
  push: EMPTY_GIT_ACTION_ICON,
  pullAndPush: EMPTY_GIT_ACTION_ICON,
  viewPr: EMPTY_GIT_ACTION_ICON,
  createPr: EMPTY_GIT_ACTION_ICON,
  mergePrSquash: EMPTY_GIT_ACTION_ICON,
  mergePrMerge: EMPTY_GIT_ACTION_ICON,
  mergePrRebase: EMPTY_GIT_ACTION_ICON,
  merge: EMPTY_GIT_ACTION_ICON,
  mergeFromBase: EMPTY_GIT_ACTION_ICON,
  archive: EMPTY_GIT_ACTION_ICON,
};

function getWorkspaceScripts(
  workspaceDescriptor: WorkspaceDescriptor | null | undefined,
): WorkspaceDescriptor["scripts"] {
  return workspaceDescriptor?.scripts ?? EMPTY_WORKSPACE_SCRIPTS;
}

interface WorkspaceScreenProps {
  serverId: string;
  workspaceId: string;
  isRouteFocused?: boolean;
}

type WorkspaceScreenContentProps = WorkspaceScreenProps & {
  isRouteFocused: boolean;
};

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function useSyncWorkspaceActiveBrowser(input: {
  activeTarget: WorkspaceTabTarget | null;
  isRouteFocused: boolean;
}) {
  const focusedBrowserId =
    input.activeTarget?.kind === "browser" ? input.activeTarget.browserId : null;
  const desktopActiveBrowserId = input.isRouteFocused ? focusedBrowserId : null;

  useEffect(() => {
    if (!getIsElectron()) {
      return;
    }
    void getDesktopHost()?.browser?.setWorkspaceActiveBrowser?.(desktopActiveBrowserId);
  }, [desktopActiveBrowserId]);
}

function useWorkspaceBrowserContextSummary(input: {
  activeTarget: WorkspaceTabTarget | null;
}): BrowserContextSummary | null {
  const focusedBrowserId =
    input.activeTarget?.kind === "browser" ? input.activeTarget.browserId : null;
  const browser = useBrowserStore((state) =>
    focusedBrowserId ? (state.browsersById[focusedBrowserId] ?? null) : null,
  );
  return useMemo(() => buildBrowserContextSummary({ browser }), [browser]);
}

function WorkspaceDocumentTitleEffect({
  label,
  titleState,
}: {
  label: string;
  titleState: "ready" | "loading";
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (isNative || typeof document === "undefined") {
      return;
    }
    const resolvedLabel = label.trim();
    document.title =
      titleState === "loading"
        ? t("workspace.screen.loading")
        : resolvedLabel || t("workspace.title");
  }, [label, t, titleState]);

  return null;
}

export function WorkspaceScreen({ serverId, workspaceId, isRouteFocused }: WorkspaceScreenProps) {
  const navigationFocused = useIsFocused();
  const effectiveRouteFocused = isRouteFocused ?? navigationFocused;
  const { t: wsT } = useTranslation();

  const renderErrorFallback = useCallback(
    (error: unknown, resetError: () => void) => (
      <SectionErrorFallback
        error={error}
        onReset={resetError}
        sectionLabel={wsT("errors.sectionWorkspace")}
      />
    ),
    [wsT],
  );

  return (
    <ExplorerSidebarAnimationProvider>
      <ErrorBoundary fallback={renderErrorFallback}>
        <WorkspaceScreenContent
          serverId={serverId}
          workspaceId={workspaceId}
          isRouteFocused={effectiveRouteFocused}
        />
      </ErrorBoundary>
    </ExplorerSidebarAnimationProvider>
  );
}

interface WorkspaceHeaderFields {
  isWorkspaceHeaderLoading: boolean;
  workspaceHeaderTitle: string;
  workspaceHeaderSubtitle: string;
  shouldShowWorkspaceHeaderSubtitle: boolean;
  isGitCheckout: boolean;
  currentBranchName: string | null;
}

function buildWorkspaceHeaderCheckoutState(input: {
  isCheckoutStatusLoading: boolean;
  isError: boolean;
  data: CheckoutStatusPayload | undefined;
}): WorkspaceHeaderCheckoutState {
  if (input.isCheckoutStatusLoading) {
    return { kind: "pending" };
  }
  if (input.isError || !input.data) {
    return { kind: "error" };
  }
  return {
    kind: "ready",
    checkout: {
      isGit: input.data.isGit,
      currentBranch: input.data.currentBranch,
    },
  };
}

function deriveWorkspaceHeaderFields(input: {
  workspace: WorkspaceDescriptor | null;
  checkoutState: WorkspaceHeaderCheckoutState;
}): WorkspaceHeaderFields {
  const renderState = resolveWorkspaceHeaderRenderState(input);
  if (renderState.kind !== "ready") {
    return {
      isWorkspaceHeaderLoading: true,
      workspaceHeaderTitle: "",
      workspaceHeaderSubtitle: "",
      shouldShowWorkspaceHeaderSubtitle: false,
      isGitCheckout: false,
      currentBranchName: null,
    };
  }
  return {
    isWorkspaceHeaderLoading: false,
    workspaceHeaderTitle: renderState.title,
    workspaceHeaderSubtitle: renderState.subtitle,
    shouldShowWorkspaceHeaderSubtitle: renderState.shouldShowSubtitle,
    isGitCheckout: renderState.isGitCheckout,
    currentBranchName: renderState.currentBranchName,
  };
}

interface WorkspaceAuthorityState {
  workspaceDirectory: string | null;
  isMissingWorkspaceExecutionAuthority: boolean;
}

function resolveWorkspaceAuthorityState(
  workspaceAuthority: WorkspaceExecutionAuthorityResult,
  workspaceDescriptor: WorkspaceDescriptor | null | undefined,
): WorkspaceAuthorityState {
  const authority = workspaceAuthority.ok ? workspaceAuthority.authority : null;
  return {
    workspaceDirectory: authority?.workspaceDirectory ?? null,
    isMissingWorkspaceExecutionAuthority: Boolean(workspaceDescriptor && !authority),
  };
}

function getHostDisplayName(host: { label?: string | null } | null, fallback: string): string {
  const trimmed = host?.label?.trim();
  return trimmed ? trimmed : fallback;
}

function useWorkspaceRouteActions(normalizedServerId: string): {
  handleRetryHost: () => void;
  handleManageHost: () => void;
  handleDismissMissingWorkspace: () => void;
} {
  const router = useRouter();
  const handleRetryHost = useCallback(() => {
    if (!normalizedServerId) {
      return;
    }
    void getHostRuntimeStore().runProbeCycleNow(normalizedServerId);
  }, [normalizedServerId]);
  const handleManageHost = useCallback(() => {
    if (!normalizedServerId) {
      return;
    }
    router.push(buildSettingsHostRoute(normalizedServerId) as Href);
  }, [normalizedServerId, router]);
  const handleDismissMissingWorkspace = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (normalizedServerId) {
      router.replace(buildHostRootRoute(normalizedServerId) as Href);
      return;
    }
    router.replace("/" as Href);
  }, [normalizedServerId, router]);

  return {
    handleRetryHost,
    handleManageHost,
    handleDismissMissingWorkspace,
  };
}

function useResolvedWorkspaceRouteState(input: {
  serverId: string;
  workspaceId: string;
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
}): {
  workspaceRouteState: WorkspaceRouteState;
  connectionRecoveryTimedOut: boolean;
} {
  const hosts = useHosts();
  const host = useMemo(
    () => hosts.find((entry) => entry.serverId === input.serverId) ?? null,
    [hosts, input.serverId],
  );
  const hostSnapshot = useHostRuntimeSnapshot(input.serverId);
  const connectionStatus = hostSnapshot?.connectionStatus ?? "connecting";
  const { workspaceLookupTimedOut, connectionRecoveryTimedOut } = useWorkspaceRouteLoadingTimedOut({
    routeKey: `${input.serverId}:${input.workspaceId}`,
    connectionStatus,
    workspace: input.workspace,
    hasHydratedWorkspaces: input.hasHydratedWorkspaces,
  });
  const hostName = useMemo(() => getHostDisplayName(host, input.serverId), [host, input.serverId]);
  const routeMatchesHostName = useMemo(() => {
    const routeWorkspaceId = input.workspaceId.trim();
    const normalizedHostName = hostName.trim();
    return (
      routeWorkspaceId.length > 0 &&
      normalizedHostName.length > 0 &&
      routeWorkspaceId.toLowerCase() === normalizedHostName.toLowerCase()
    );
  }, [hostName, input.workspaceId]);

  const workspaceRouteState = useMemo(
    () =>
      resolveWorkspaceRouteState({
        hostName,
        connectionStatus,
        lastError: hostSnapshot?.lastError ?? null,
        workspace: input.workspace,
        hasHydratedWorkspaces: input.hasHydratedWorkspaces,
        workspaceLookupTimedOut,
        routeMatchesHostName,
      }),
    [
      hostName,
      connectionStatus,
      hostSnapshot?.lastError,
      input.workspace,
      input.hasHydratedWorkspaces,
      workspaceLookupTimedOut,
      routeMatchesHostName,
    ],
  );

  return { workspaceRouteState, connectionRecoveryTimedOut };
}

function WorkspaceDocumentTitleEffectSlot({
  target,
  serverId,
  workspaceId,
  isRouteFocused,
}: {
  target: WorkspaceTabTarget | null;
  serverId: string;
  workspaceId: string;
  isRouteFocused: boolean;
}) {
  if (!isRouteFocused || !isWeb || !target) {
    return null;
  }

  return (
    <WorkspaceTabPresentationResolver target={target} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <WorkspaceDocumentTitleEffect
          label={presentation.label}
          titleState={presentation.titleState}
        />
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function shouldShowWorkspaceScreenHeader(input: {
  isFocusModeEnabled: boolean;
  isMobile: boolean;
}): boolean {
  return !input.isFocusModeEnabled || input.isMobile;
}

function shouldShowWorkspaceExplorerSidebar(input: {
  isRouteFocused: boolean;
  isFocusModeEnabled: boolean;
  isMobile: boolean;
}): boolean {
  return input.isRouteFocused && shouldShowWorkspaceScreenHeader(input);
}

function buildWorkspaceTerminalScopeKey(serverId: string, workspaceId: string): string | null {
  if (!serverId || !workspaceId) {
    return null;
  }
  return `${serverId}:${workspaceId}`;
}

interface WorkspaceTerminalTabActionsInput {
  persistenceKey: string | null;
  openWorkspaceTarget: (workspaceKey: string, target: WorkspaceTabTarget) => void;
  toast: {
    error: (message: string) => void;
    show: (message: string) => void;
  };
}

interface WorkspaceTerminalTabActions {
  handleTerminalCreated: (input: {
    terminalId: string;
    paneId?: string;
    openInCenterTab?: boolean;
  }) => void;
  handleScriptTerminalSelected: (terminalId: string) => void;
  handleWorkspacePathUnavailable: () => void;
  handleTerminalCreateQueued: () => void;
}

function useWorkspaceTerminalTabActions({
  persistenceKey,
  openWorkspaceTarget,
  toast,
}: WorkspaceTerminalTabActionsInput): WorkspaceTerminalTabActions {
  const { t } = useTranslation();
  const handleTerminalCreated = useCallback(
    ({
      terminalId,
      openInCenterTab = true,
    }: {
      terminalId: string;
      paneId?: string;
      openInCenterTab?: boolean;
    }) => {
      if (!persistenceKey) {
        return;
      }
      // Drawer / right-panel terminal surfaces own the session without forcing the center content.
      if (!openInCenterTab) {
        return;
      }
      openWorkspaceTarget(persistenceKey, { kind: "terminal", terminalId });
    },
    [openWorkspaceTarget, persistenceKey],
  );
  const handleScriptTerminalSelected = useCallback(
    (terminalId: string) => {
      if (!persistenceKey) {
        return;
      }
      openWorkspaceTarget(persistenceKey, { kind: "terminal", terminalId });
    },
    [openWorkspaceTarget, persistenceKey],
  );
  const handleWorkspacePathUnavailable = useCallback(() => {
    toast.error(t("workspace.pathUnavailable"));
  }, [toast, t]);
  const handleTerminalCreateQueued = useCallback(() => {
    toast.show(t("workspace.preparingTerminal"));
  }, [toast, t]);

  return {
    handleTerminalCreated,
    handleScriptTerminalSelected,
    handleWorkspacePathUnavailable,
    handleTerminalCreateQueued,
  };
}

function useWorkspaceCheckoutStatus(input: {
  client: ReturnType<typeof useHostRuntimeClient>;
  isConnected: boolean;
  isRouteFocused: boolean;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  workspaceDirectory: string | null;
}) {
  const isCheckoutQueryEnabled = useMemo(
    () =>
      canCreateWorkspaceTerminal({
        isRouteFocused: input.isRouteFocused,
        client: input.client,
        isConnected: input.isConnected,
        workspaceDirectory: input.workspaceDirectory,
      }),
    [input.isRouteFocused, input.client, input.isConnected, input.workspaceDirectory],
  );
  const checkoutQuery = useQuery({
    queryKey: checkoutStatusQueryKey(
      input.normalizedServerId,
      input.workspaceDirectory ?? `missing-workspace-directory:${input.normalizedWorkspaceId}`,
    ),
    enabled: isCheckoutQueryEnabled,
    queryFn: async () => {
      if (!input.client || !input.workspaceDirectory) {
        throw new Error("Host is not connected");
      }
      return await input.client.getCheckoutStatus(input.workspaceDirectory);
    },
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const isCheckoutStatusLoading = useMemo(
    () => isCheckoutQueryEnabled && checkoutQuery.data === undefined && !checkoutQuery.isError,
    [isCheckoutQueryEnabled, checkoutQuery.data, checkoutQuery.isError],
  );

  return { checkoutQuery, isCheckoutStatusLoading };
}

// Complexity grew by one when we wired the right-side context panel to
// subagents + todo data. The function is a long, intentional screen-level
// coordinator; extracting further would scatter the routing policy. The
// threshold is raised just for this single function.
// eslint-disable-next-line complexity
function WorkspaceScreenContent({
  serverId,
  workspaceId,
  isRouteFocused,
}: WorkspaceScreenContentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isMobile = useIsCompactFormFactor();
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const normalizedServerId = useMemo(() => trimNonEmpty(decodeSegment(serverId)) ?? "", [serverId]);
  const normalizedWorkspaceId = useMemo(
    () => resolveWorkspaceRouteId({ routeWorkspaceId: workspaceId }) ?? "",
    [workspaceId],
  );
  const workspaceDescriptor = useWorkspace(normalizedServerId, normalizedWorkspaceId);
  const workspaceScripts = getWorkspaceScripts(workspaceDescriptor);
  const { handleRetryHost, handleManageHost, handleDismissMissingWorkspace } =
    useWorkspaceRouteActions(normalizedServerId);

  const workspaceTerminalScopeKey = useMemo(
    () => buildWorkspaceTerminalScopeKey(normalizedServerId, normalizedWorkspaceId),
    [normalizedServerId, normalizedWorkspaceId],
  );
  useWorkspaceTerminalSessionRetention({
    scopeKey: workspaceTerminalScopeKey,
  });

  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const workspaceAuthority = useMemo(
    () =>
      getWorkspaceExecutionAuthority({
        workspace: workspaceDescriptor,
      }),
    [workspaceDescriptor],
  );
  const { workspaceDirectory, isMissingWorkspaceExecutionAuthority } =
    resolveWorkspaceAuthorityState(workspaceAuthority, workspaceDescriptor);
  const shouldEnableReviewCalloutGitActions = Boolean(
    isRouteFocused &&
    shouldEnableWorkspaceReviewArchiveAction({
      workspace: workspaceDescriptor,
      workspaceDirectory,
    }),
  );
  const { gitActions: reviewCalloutGitActions } = useGitActions({
    serverId: normalizedServerId,
    cwd: workspaceDirectory ?? "",
    enabled: shouldEnableReviewCalloutGitActions,
    icons: REVIEW_CALLOUT_GIT_ACTION_ICONS,
  });
  const [isImportSheetVisible, setIsImportSheetVisible] = useState(false);
  // Soft Home draft only — conversation header/menu no longer exposes import.
  const openImportSheet = useCallback(() => {
    if (![client, isConnected, workspaceDirectory].every(Boolean)) {
      return;
    }
    setIsImportSheetVisible(true);
  }, [client, isConnected, workspaceDirectory]);
  const closeImportSheet = useCallback(() => {
    setIsImportSheetVisible(false);
  }, []);

  // Warm the workspace-scoped provider snapshot so the model picker is ready when opened.
  useProvidersSnapshot(normalizedServerId, {
    cwd: workspaceDirectory,
    enabled: isRouteFocused,
  });

  const persistenceKey = useMemo(
    () =>
      buildWorkspaceTabPersistenceKey({
        serverId: normalizedServerId,
        workspaceId: normalizedWorkspaceId,
      }),
    [normalizedServerId, normalizedWorkspaceId],
  );
  const openWorkspaceTarget = useWorkspaceLayoutStore((state) => state.openTarget);
  const clearWorkspaceTarget = useWorkspaceLayoutStore((state) => state.clearTarget);
  const activeTarget = useWorkspaceLayoutStore((state) =>
    persistenceKey ? (state.activeTargetByWorkspace[persistenceKey] ?? null) : null,
  );
  const hasHydratedWorkspaceLayoutStore = useWorkspaceLayoutStoreHydrated();
  const hasHydratedWorkspaces = useSessionStore(
    (state) => state.sessions[normalizedServerId]?.hasHydratedWorkspaces ?? false,
  );

  const handleOpenTarget = useCallback(
    (target: WorkspaceTabTarget) => {
      if (persistenceKey) {
        openWorkspaceTarget(persistenceKey, target);
      }
    },
    [openWorkspaceTarget, persistenceKey],
  );
  const handleCreateDraftTab = useCallback(() => {
    handleOpenTarget({ kind: "draft", draftId: generateDraftId() });
  }, [handleOpenTarget]);
  const handleCreateBrowserTab = useCallback(() => {
    const { browserId } = createWorkspaceBrowser();
    handleOpenTarget({ kind: "browser", browserId });
  }, [handleOpenTarget]);
  const handleOpenUrlInBrowserTab = useCallback(
    (url: string) => {
      const { browserId } = createWorkspaceBrowser({ initialUrl: url });
      handleOpenTarget({ kind: "browser", browserId });
    },
    [handleOpenTarget],
  );
  const handleOpenFile = useCallback(
    (location: WorkspaceFileLocation) => {
      handleOpenTarget({ kind: "file", ...location });
    },
    [handleOpenTarget],
  );
  const handleOpenFileFromExplorer = useCallback(
    (filePath: string) => {
      handleOpenTarget({ kind: "file", path: filePath });
    },
    [handleOpenTarget],
  );
  const handleOpenFileFromChat = useCallback(
    (location: WorkspaceFileLocation) => {
      handleOpenFile(location);
    },
    [handleOpenFile],
  );
  const handleOpenSetupTab = useCallback(() => {
    const target = normalizeWorkspaceTabTarget({
      kind: "setup",
      workspaceId: normalizedWorkspaceId,
    });
    if (target) {
      handleOpenTarget(target);
    }
  }, [handleOpenTarget, normalizedWorkspaceId]);

  useSyncWorkspaceActiveBrowser({ activeTarget, isRouteFocused });
  const environmentBrowserContext = useWorkspaceBrowserContextSummary({ activeTarget });
  const hasEnvironmentBrowserContext = environmentBrowserContext !== null;
  const hasEnvironmentPullRequest = Boolean(workspaceDescriptor?.githubRuntime?.pullRequest);

  const {
    handleTerminalCreated,
    handleScriptTerminalSelected,
    handleWorkspacePathUnavailable,
    handleTerminalCreateQueued,
  } = useWorkspaceTerminalTabActions({
    persistenceKey,
    openWorkspaceTarget,
    toast,
  });
  const {
    createMutation: createTerminalMutation,
    createTerminal,
    handleScriptTerminalStarted,
    handleViewScriptTerminal,
    liveTerminalIds,
    pendingCreateInput: pendingTerminalCreateInput,
    query: terminalsQuery,
    terminals,
  } = useWorkspaceTerminals({
    client,
    isConnected,
    isRouteFocused,
    normalizedServerId,
    normalizedWorkspaceId,
    workspaceDirectory,
    workspaceScripts,
    hasHydratedWorkspaces,
    isMissingWorkspaceExecutionAuthority,
    onTerminalCreated: handleTerminalCreated,
    onScriptTerminalSelected: handleScriptTerminalSelected,
    onWorkspacePathUnavailable: handleWorkspacePathUnavailable,
    onTerminalCreateQueued: handleTerminalCreateQueued,
  });
  const { checkoutQuery, isCheckoutStatusLoading } = useWorkspaceCheckoutStatus({
    client,
    isConnected,
    isRouteFocused,
    normalizedServerId,
    normalizedWorkspaceId,
    workspaceDirectory,
  });
  const hasHydratedAgents = useSessionStore(
    (state) => state.sessions[normalizedServerId]?.hasHydratedAgents ?? false,
  );
  const { workspaceRouteState, connectionRecoveryTimedOut } = useResolvedWorkspaceRouteState({
    serverId: normalizedServerId,
    workspaceId: normalizedWorkspaceId,
    workspace: workspaceDescriptor,
    hasHydratedWorkspaces,
  });
  const workspaceHeaderCheckoutState = buildWorkspaceHeaderCheckoutState({
    isCheckoutStatusLoading,
    isError: checkoutQuery.isError,
    data: checkoutQuery.data,
  });
  const {
    isWorkspaceHeaderLoading,
    workspaceHeaderTitle,
    workspaceHeaderSubtitle,
    shouldShowWorkspaceHeaderSubtitle,
    isGitCheckout,
    currentBranchName,
  } = deriveWorkspaceHeaderFields({
    workspace: workspaceDescriptor,
    checkoutState: workspaceHeaderCheckoutState,
  });

  const {
    isExplorerOpen,
    activeExplorerCheckout,
    openFileExplorerForCheckout,
    toggleFileExplorerForCheckout,
    closeDesktopFileExplorer,
    setExplorerTabForCheckout,
    handleToggleExplorer,
    explorerToggleAccessibilityState,
    explorerOpenGesture,
  } = useWorkspaceExplorerActions({
    normalizedServerId,
    workspaceDirectory,
    isGitCheckout,
    isMobile,
    isRouteFocused,
  });
  const {
    setEnvironmentDockState,
    setEnvironmentPanelMode,
    isEnvironmentPanelVisible,
    handleCenterContentLayout,
    handleToggleEnvironmentPanel,
    handleOpenEnvironmentChanges,
  } = useWorkspaceEnvironmentPanelState({
    panelWidth: WORKSPACE_ENVIRONMENT_PANEL_WIDTH,
    isMobile,
    isExplorerOpen,
    activeExplorerCheckout,
    closeDesktopFileExplorer,
    openFileExplorerForCheckout,
    toggleFileExplorerForCheckout,
    setExplorerTabForCheckout,
  });

  const activeTargetAgentId = activeTarget?.kind === "agent" ? activeTarget.agentId : null;
  const sessionAgents = useSessionStore(
    (state) => state.sessions[normalizedServerId]?.agents ?? null,
  );
  const activeAgentStillExists = useMemo(() => {
    if (!activeTargetAgentId || !hasHydratedAgents) {
      return true;
    }
    return sessionAgents?.has(activeTargetAgentId) ?? false;
  }, [activeTargetAgentId, hasHydratedAgents, sessionAgents]);

  useEffect(() => {
    if (persistenceKey && activeTargetAgentId && hasHydratedAgents && !activeAgentStillExists) {
      clearWorkspaceTarget(persistenceKey);
    }
  }, [
    activeAgentStillExists,
    activeTargetAgentId,
    clearWorkspaceTarget,
    hasHydratedAgents,
    persistenceKey,
  ]);

  const setFocusedAgentId = useSessionStore((state) => state.setFocusedAgentId);
  useEffect(() => {
    if (!isRouteFocused) {
      return;
    }
    setFocusedAgentId(normalizedServerId, activeTargetAgentId);
  }, [activeTargetAgentId, isRouteFocused, normalizedServerId, setFocusedAgentId]);

  useEffect(() => {
    if (!isRouteFocused) {
      return;
    }
    return () => {
      setFocusedAgentId(normalizedServerId, null);
    };
  }, [isRouteFocused, normalizedServerId, setFocusedAgentId]);

  const {
    environmentPanelAgentId,
    environmentProgress,
    environmentGoal,
    environmentSubagents,
    cancelEnvironmentGoal,
    hasFloatingInspectorContent,
  } = useWorkspaceEnvironmentData({
    normalizedServerId,
    activeTargetAgentId,
    workspaceDescriptor,
    currentBranchName,
  });
  const handleOpenEnvironmentSubagent = useCallback(
    (subagentId: string) => {
      navigateToAgent({ serverId: normalizedServerId, agentId: subagentId });
    },
    [normalizedServerId],
  );
  const handleCancelEnvironmentGoal = useCallback(() => {
    if (!cancelEnvironmentGoal) {
      return;
    }
    void cancelEnvironmentGoal();
  }, [cancelEnvironmentGoal]);
  const { handleCopyEnvironmentResumeCommand, handleCopyWorkspacePath, handleCopyBranchName } =
    useWorkspaceUtilityActions({
      client,
      isConnected,
      serverId: normalizedServerId,
      workspaceDirectory,
      currentBranchName,
      environmentPanelAgentId,
    });
  const workspaceReviewArchiveAction = useMemo(() => {
    if (
      !workspaceDirectory ||
      workspaceDescriptor?.projectKind !== "git" ||
      workspaceDescriptor.workspaceKind !== "worktree"
    ) {
      return null;
    }
    const action = [
      reviewCalloutGitActions.primary,
      ...reviewCalloutGitActions.secondary,
      ...reviewCalloutGitActions.menu,
    ].find((candidate) => candidate?.id === "archive-worktree");
    if (!action || action.unavailableMessage || action.status === "pending") {
      return null;
    }
    return action;
  }, [
    reviewCalloutGitActions,
    workspaceDescriptor?.projectKind,
    workspaceDescriptor?.workspaceKind,
    workspaceDirectory,
  ]);

  const isCreateTerminalPending =
    createTerminalMutation.isPending || pendingTerminalCreateInput !== null;
  const {
    terminalDrawerOpen,
    rightPanelOpen,
    rightPanelActiveSurface,
    activeTerminalId,
    rightPanelBrowserId,
    canUseRightPanel,
    showBrowserSurface,
    handleToggleTerminalDrawer,
    handleToggleRightPanel,
    handleOpenRightPanelSurface,
    handleCloseTerminalDrawer,
  } = useWorkspaceLayoutChrome({
    isMobile,
    isGitCheckout,
    workspaceDirectory,
    liveTerminalIds,
    createTerminal,
    isCreateTerminalPending,
  });
  // Production: right surface rail and floating env card are mutually exclusive.
  useEffect(() => {
    if (rightPanelOpen) {
      setEnvironmentPanelMode("forced-closed");
    }
  }, [rightPanelOpen, setEnvironmentPanelMode]);
  const handleRightPanelOpenWorkspaceFile = useCallback(
    (request: { location: { path: string; line?: number | null; column?: number | null } }) => {
      handleOpenFileFromChat(request.location);
    },
    [handleOpenFileFromChat],
  );
  const { showWorkspaceSetup } = useWorkspacePersistenceHydration({
    client,
    isRouteFocused,
    serverId: normalizedServerId,
    workspaceId: normalizedWorkspaceId,
    persistenceKey,
    workspaceDirectory,
    hasHydratedWorkspaceLayoutStore,
    hasHydratedAgents,
    terminalsHydrated: terminalsQuery.isSuccess,
    terminalCount: terminals.length,
    activeAgentCount: sessionAgents?.size ?? 0,
    hasActiveTarget: activeTarget !== null,
    openWorkspaceDraftTab: handleCreateDraftTab,
  });

  const { contentModel } = useWorkspacePaneContentModels({
    normalizedServerId,
    normalizedWorkspaceId,
    activeTarget,
    onOpenWorkspaceFile: (request) => handleOpenFile(request.location),
    onOpenImportSheet: openImportSheet,
  });

  const handleCreateTerminal = useStableEvent(createTerminal);

  useWorkspaceOpenIntent({
    isRouteFocused,
    persistenceKey,
    normalizedServerId,
    normalizedWorkspaceId,
    hasExplorerCheckout: activeExplorerCheckout !== null,
    isTerminalCreatePending:
      createTerminalMutation.isPending || pendingTerminalCreateInput !== null,
    onOpenChanges: handleOpenEnvironmentChanges,
    onCreateTerminal: handleCreateTerminal,
  });

  const handleOpenRightPanelDiff = useCallback(() => {
    if (isMobile) {
      return;
    }
    handleOpenRightPanelSurface("diff");
  }, [handleOpenRightPanelSurface, isMobile]);

  const { handleOpenGitDock, handleOpenBrowserContextDock, handleOpenPullRequestDock } =
    useWorkspaceDockActions({
      isMobile,
      hasEnvironmentBrowserContext,
      hasEnvironmentPullRequest,
      persistenceKey,
      setEnvironmentDockState,
      setEnvironmentPanelMode,
      closeDesktopFileExplorer,
      handleOpenEnvironmentChanges,
      openRightPanelDiff: handleOpenRightPanelDiff,
      handleCreateTerminal,
      openWorkspaceTarget,
    });

  useWorkspaceKeyboardActions({
    serverId: normalizedServerId,
    workspaceId: normalizedWorkspaceId,
    enabled: Boolean(isRouteFocused && normalizedServerId && normalizedWorkspaceId),
    hasEnvironmentBrowserContext,
    hasEnvironmentPullRequest,
    onCreateTerminal: handleCreateTerminal,
    onToggleExplorer: handleToggleExplorer,
    onOpenGitDock: handleOpenGitDock,
    onOpenBrowserContextDock: handleOpenBrowserContextDock,
    onOpenPullRequestDock: handleOpenPullRequestDock,
    onOpenEnvironmentChanges: handleOpenEnvironmentChanges,
    onToggleEnvironmentPanel: handleToggleEnvironmentPanel,
    onCopyEnvironmentResumeCommand: handleCopyEnvironmentResumeCommand,
    onArchiveWorktree:
      workspaceReviewArchiveAction && !workspaceReviewArchiveAction.disabled
        ? workspaceReviewArchiveAction.handler
        : null,
  });

  const activeTargetDescriptor = activeTarget;
  useEffect(() => {
    if (!isRouteFocused || isNative || typeof document === "undefined" || activeTargetDescriptor) {
      return;
    }
    document.title = t("workspace.title");
  }, [activeTargetDescriptor, isRouteFocused, t]);

  const handleImportedAgent = useCallback(
    (agentId: string) => {
      handleOpenTarget({ kind: "agent", agentId });
    },
    [handleOpenTarget],
  );

  const containerStyle = containerWithWorkspaceBackgroundStyle;

  const workspaceScreenGate = renderWorkspaceRouteGate({
    state: workspaceRouteState,
    offerConnectionRecovery: connectionRecoveryTimedOut,
    actions: {
      onRetryHost: handleRetryHost,
      onManageHost: handleManageHost,
      onDismissMissingWorkspace: handleDismissMissingWorkspace,
    },
  });
  const gatedWorkspaceScreen = (
    <WorkspaceScreenGateShell gate={workspaceScreenGate} workspaceKey={persistenceKey} />
  );
  const reconnectingBanner =
    workspaceRouteState.kind === "reconnecting" ? (
      <WorkspaceReconnectingBanner
        state={workspaceRouteState}
        onRetry={handleRetryHost}
        onManageHost={handleManageHost}
      />
    ) : null;

  const showExplorerSidebar = useMemo(
    () => shouldShowWorkspaceExplorerSidebar({ isRouteFocused, isFocusModeEnabled, isMobile }),
    [isRouteFocused, isFocusModeEnabled, isMobile],
  );
  const workspaceFloatingPanelPortalHostName = useMemo(
    () =>
      `${WORKSPACE_FLOATING_PANEL_PORTAL_HOST_PREFIX}:${normalizedServerId}:${normalizedWorkspaceId}`,
    [normalizedServerId, normalizedWorkspaceId],
  );

  const workspaceCenterHeaderTitleBar = useMemo(
    () => ({
      isLoading: isWorkspaceHeaderLoading,
      title: workspaceHeaderTitle,
      subtitle: workspaceHeaderSubtitle,
      showSubtitle: shouldShowWorkspaceHeaderSubtitle,
      currentBranchName,
      isGitCheckout,
      workspaceScripts,
      liveTerminalIds,
      showWorkspaceSetup,
      onCreateDraftTab: handleCreateDraftTab,
      onCreateTerminal: handleCreateTerminal,
      onCreateBrowser: handleCreateBrowserTab,
      onOpenGitDock: handleOpenGitDock,
      onOpenBrowserContextDock: handleOpenBrowserContextDock,
      onCopyWorkspacePath: handleCopyWorkspacePath,
      onCopyBranchName: handleCopyBranchName,
      onOpenSetupTab: handleOpenSetupTab,
      onScriptTerminalStarted: handleScriptTerminalStarted,
      onViewScriptTerminal: handleViewScriptTerminal,
      onOpenUrlInBrowserTab: handleOpenUrlInBrowserTab,
    }),
    [
      currentBranchName,
      handleCopyBranchName,
      handleCopyWorkspacePath,
      handleCreateBrowserTab,
      handleCreateDraftTab,
      handleCreateTerminal,
      handleOpenBrowserContextDock,
      handleOpenGitDock,
      handleOpenSetupTab,
      handleOpenUrlInBrowserTab,
      handleScriptTerminalStarted,
      handleViewScriptTerminal,
      isGitCheckout,
      isWorkspaceHeaderLoading,
      liveTerminalIds,
      shouldShowWorkspaceHeaderSubtitle,
      showWorkspaceSetup,
      workspaceHeaderSubtitle,
      workspaceHeaderTitle,
      workspaceScripts,
    ],
  );
  const workspaceCenterHeaderRightControls = useMemo(
    () => ({
      isGitCheckout,
      isExplorerOpen,
      canToggleExplorer: Boolean(activeExplorerCheckout) || canUseRightPanel,
      canShowEnvironmentPanel: hasFloatingInspectorContent,
      isTerminalDrawerOpen: terminalDrawerOpen,
      isRightPanelOpen: rightPanelOpen,
      explorerToggleAccessibilityState,
      onToggleExplorer: handleToggleExplorer,
      onToggleEnvironmentPanel: handleToggleEnvironmentPanel,
      onToggleTerminalDrawer: handleToggleTerminalDrawer,
      onToggleRightPanel: handleToggleRightPanel,
    }),
    [
      activeExplorerCheckout,
      canUseRightPanel,
      explorerToggleAccessibilityState,
      handleToggleEnvironmentPanel,
      handleToggleExplorer,
      handleToggleRightPanel,
      handleToggleTerminalDrawer,
      hasFloatingInspectorContent,
      isExplorerOpen,
      isGitCheckout,
      rightPanelOpen,
      terminalDrawerOpen,
    ],
  );
  const workspaceCenterEnvironmentPanel = useMemo(
    () => ({
      goal: environmentGoal,
      progress: environmentProgress,
      subagents: environmentSubagents,
      onCancelGoal: cancelEnvironmentGoal ? handleCancelEnvironmentGoal : null,
      onOpenSubagent: handleOpenEnvironmentSubagent,
      onClose: handleToggleEnvironmentPanel,
    }),
    [
      cancelEnvironmentGoal,
      environmentGoal,
      environmentProgress,
      environmentSubagents,
      handleCancelEnvironmentGoal,
      handleOpenEnvironmentSubagent,
      handleToggleEnvironmentPanel,
    ],
  );

  const desktopSoftTopbar = !isMobile ? (
    <WorkspaceDesktopSoftTopbar
      {...workspaceCenterHeaderTitleBar}
      {...workspaceCenterHeaderRightControls}
      activeTarget={activeTarget}
      normalizedServerId={normalizedServerId}
      normalizedWorkspaceId={normalizedWorkspaceId}
      showCreateBrowserTab={getIsElectron()}
      createTerminalDisabled={isCreateTerminalPending}
      browserContextDockDisabled={!hasEnvironmentBrowserContext}
      isEnvironmentPanelVisible={isEnvironmentPanelVisible}
    />
  ) : null;

  const desktopTerminalDrawer = useMemo(() => {
    if (isMobile) {
      return null;
    }
    return (
      <WorkspaceTerminalDrawer
        visible={terminalDrawerOpen}
        serverId={normalizedServerId}
        workspaceRoot={workspaceDirectory}
        terminalId={activeTerminalId}
        isWorkspaceFocused={isRouteFocused}
        createDisabled={isCreateTerminalPending}
        onClose={handleCloseTerminalDrawer}
        onCreateTerminal={handleCreateTerminal}
        onOpenFileExplorer={handleToggleExplorer}
        onOpenWorkspaceFile={handleRightPanelOpenWorkspaceFile}
      />
    );
  }, [
    activeTerminalId,
    handleCloseTerminalDrawer,
    handleCreateTerminal,
    handleRightPanelOpenWorkspaceFile,
    handleToggleExplorer,
    isCreateTerminalPending,
    isMobile,
    isRouteFocused,
    normalizedServerId,
    terminalDrawerOpen,
    workspaceDirectory,
  ]);

  return selectWorkspaceRouteContent({
    gate: workspaceScreenGate,
    gatedContent: gatedWorkspaceScreen,
    readyContent: (
      <WorkspaceFocusProvider workspaceKey={persistenceKey}>
        <View style={containerStyle}>
          {reconnectingBanner}
          <WorkspaceDocumentTitleEffectSlot
            target={activeTarget}
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
            isRouteFocused={isRouteFocused}
          />
          {desktopSoftTopbar}
          <View style={styles.threePaneRow}>
            <FloatingPanelPortalHostNameProvider hostName={workspaceFloatingPanelPortalHostName}>
              <WorkspaceCenterColumn
                isMobile={isMobile}
                isRouteFocused={isRouteFocused}
                normalizedServerId={normalizedServerId}
                normalizedWorkspaceId={normalizedWorkspaceId}
                activeTarget={activeTarget}
                isMissingWorkspaceExecutionAuthority={isMissingWorkspaceExecutionAuthority}
                hasHydratedAgents={hasHydratedAgents}
                contentModel={contentModel}
                explorerOpenGesture={explorerOpenGesture}
                onCenterContentLayout={handleCenterContentLayout}
                isEnvironmentPanelVisible={isEnvironmentPanelVisible}
                isCreateTerminalPending={isCreateTerminalPending}
                hasEnvironmentBrowserContext={hasEnvironmentBrowserContext}
                headerTitleBar={workspaceCenterHeaderTitleBar}
                headerRightControls={workspaceCenterHeaderRightControls}
                environmentPanel={workspaceCenterEnvironmentPanel}
                terminalDrawer={desktopTerminalDrawer}
              />
            </FloatingPanelPortalHostNameProvider>

            <FloatingPanelPortalHost name={workspaceFloatingPanelPortalHostName} />

            {/* Desktop: unified right surface rail. Mobile keeps legacy explorer. */}
            {!isMobile && canUseRightPanel ? (
              <WorkspaceRightPanel
                visible={rightPanelOpen}
                activeSurface={rightPanelActiveSurface}
                serverId={normalizedServerId}
                workspaceId={normalizedWorkspaceId}
                workspaceRoot={workspaceDirectory}
                isGitCheckout={isGitCheckout}
                showBrowserSurface={showBrowserSurface}
                terminalId={activeTerminalId}
                browserId={rightPanelBrowserId}
                isWorkspaceFocused={isRouteFocused}
                onOpenSurface={handleOpenRightPanelSurface}
                onOpenFile={handleOpenFileFromExplorer}
                onOpenFileExplorer={handleToggleExplorer}
                onOpenWorkspaceFile={handleRightPanelOpenWorkspaceFile}
              />
            ) : null}
            {isMobile && showExplorerSidebar && workspaceDirectory ? (
              <ExplorerSidebar
                serverId={normalizedServerId}
                workspaceId={normalizedWorkspaceId}
                workspaceRoot={workspaceDirectory}
                isGit={isGitCheckout}
                onOpenFile={handleOpenFileFromExplorer}
              />
            ) : null}
          </View>
          <ImportSessionSheet
            visible={isImportSheetVisible}
            client={client}
            serverId={normalizedServerId}
            cwd={workspaceDirectory}
            onClose={closeImportSheet}
            onImportedAgent={handleImportedAgent}
          />
        </View>
      </WorkspaceFocusProvider>
    ),
  });
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  containerWorkspaceBackground: {
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).workspace,
  },
  threePaneRow: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    flexDirection: "row",
    alignItems: "stretch",
    gap: 0,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
}));

const containerWithWorkspaceBackgroundStyle = [
  styles.container,
  styles.containerWorkspaceBackground,
];
