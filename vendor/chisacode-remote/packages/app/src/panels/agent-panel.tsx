import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { SquarePen } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import ReanimatedAnimated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { shallow, useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AgentStreamView, type AgentStreamViewHandle } from "@/agent-stream/view";
import { ArchivedAgentCallout } from "@/components/archived-agent-callout";
import { Composer } from "@/composer";
import { AgentModeControl } from "@/composer/agent-controls/mode-control";
import { FileDropZone } from "@/components/file-drop-zone";
import { RewindComposerRestoreProvider } from "@/components/rewind/composer-restore";
import type { ImageAttachment } from "@/composer/types";
import { getProviderIcon } from "@/components/provider-icons";
import { ToastViewport, useToastHost } from "@/components/toast-host";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  useWorkspaceAttachments,
  useWorkspaceAttachmentScopeKey,
} from "@/attachments/workspace-attachments-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { useAgentAttentionClear } from "@/hooks/use-agent-attention-clear";
import { useAgentInitialization } from "@/hooks/use-agent-initialization";
import { useAgentInputDraft, type AgentInputDraft } from "@/composer/draft/input-draft";
import {
  type AgentScreenAgent,
  type AgentScreenContinuity,
  type AgentScreenMissingState,
  type AgentScreenViewState,
  useAgentScreenStateMachine,
} from "@/hooks/use-agent-screen-state-machine";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { buildDraftPanelDescriptor } from "@/panels/draft-panel-descriptor";
import {
  type HostRuntimeConnectionStatus,
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHostRuntimeIsConnected,
  useHostRuntimeLastError,
  useHosts,
} from "@/runtime/host-runtime";
import {
  deriveRouteBottomAnchorIntent,
  deriveRouteBottomAnchorRequest,
} from "@/screens/agent/agent-ready-screen-bottom-anchor";
import type { ProjectPlacementPayload } from "@chisacode/protocol/messages";
import { WorkspaceDraftAgentTab } from "@/composer/draft/workspace-tab";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { usePanelStore } from "@/stores/panel-store";
import { type Agent, useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { resolveThemeWorkbenchSurfaceRoles } from "@/styles/workbench-surface-roles";
import { useArchiveSubagent, useSubagentsForParent } from "@/subagents";
import { SubagentsTrack } from "@/subagents/track";
import { loadCachedAgentStreamTail } from "@/timeline/agent-stream-tail-cache";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import { getInitDeferred, getInitKey } from "@/utils/agent-initialization";
import { derivePendingPermissionKey, normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { resolveProjectPlacement } from "@/utils/project-placement";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { buildDraftAgentSetup, type ClientSlashCommand } from "@/client-slash-commands";
import { useQueryClient } from "@tanstack/react-query";
import { agentHistoryQueryKeys } from "@/hooks/agent-history-query-key";

interface ChatAgentStateShape {
  serverId: string | null;
  id: string | null;
  status: Agent["status"] | null;
  cwd: string | null;
  capabilities?: Agent["capabilities"];
  lastError?: Agent["lastError"] | null;
}

interface ChatAgentSelectedState extends ChatAgentStateShape {
  archivedAt: Date | null;
  requiresAttention: boolean;
  attentionReason: Agent["attentionReason"] | null;
}

function resolveChatAgentFromSession(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string | undefined,
): Agent | null {
  if (!agentId) return null;
  const session = state.sessions[serverId];
  return session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
}

const EMPTY_CHAT_AGENT_STATE: ChatAgentSelectedState = {
  serverId: null,
  id: null,
  status: null,
  cwd: null,
  lastError: null,
  archivedAt: null,
  requiresAttention: false,
  attentionReason: null,
};

function selectChatAgentState(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string | undefined,
): ChatAgentSelectedState {
  const agent = resolveChatAgentFromSession(state, serverId, agentId);
  if (!agent) return EMPTY_CHAT_AGENT_STATE;
  return {
    serverId: agent.serverId,
    id: agent.id,
    status: agent.status,
    cwd: agent.cwd,
    capabilities: agent.capabilities,
    lastError: agent.lastError ?? null,
    archivedAt: agent.archivedAt ?? null,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
  };
}

function buildChatAgentFromState(
  state: ChatAgentStateShape,
  projectPlacement: Agent["projectPlacement"] | null,
): AgentScreenAgent | null {
  if (!state.serverId || !state.id || !state.status || !state.cwd) {
    return null;
  }
  return {
    serverId: state.serverId,
    id: state.id,
    status: state.status,
    cwd: state.cwd,
    capabilities: state.capabilities,
    lastError: state.lastError ?? null,
    projectPlacement,
  };
}

function renderChatAgentNonReadyView(args: {
  viewState: AgentScreenViewState;
  effectiveAgent: AgentScreenAgent | null;
  copy: { notFound: string; loadFailed: string };
}): React.ReactElement | null {
  const { copy, viewState, effectiveAgent } = args;
  if (viewState.tag === "not_found") {
    return (
      <View style={styles.container} testID="agent-not-found">
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{copy.notFound}</Text>
        </View>
      </View>
    );
  }
  if (viewState.tag === "error") {
    return (
      <View style={styles.container} testID="agent-load-error">
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{copy.loadFailed}</Text>
          <Text style={styles.statusText}>{viewState.message}</Text>
        </View>
      </View>
    );
  }
  if (viewState.tag === "boot" || !effectiveAgent) {
    return (
      <View style={styles.container} testID="agent-loading">
        <View style={styles.errorContainer}>
          <ThemedActivityIndicator size="large" uniProps={foregroundMutedColorMapping} />
        </View>
      </View>
    );
  }
  return null;
}

function formatProviderLabel(provider: Agent["provider"]): string {
  if (!provider) {
    return "智能体";
  }
  return provider
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveWorkspaceAgentTabLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

function shouldStoreFetchedAgentInActiveDirectory(agent: Agent): boolean {
  return !agent.archivedAt && Boolean(agent.projectPlacement);
}

type FetchAgentResult = Awaited<ReturnType<DaemonClient["fetchAgent"]>>;

function storeFetchedAgentDetail(input: {
  serverId: string;
  result: NonNullable<FetchAgentResult>;
}): Agent {
  const normalized = normalizeAgentSnapshot(input.result.agent, input.serverId);
  const hydrated: Agent = {
    ...normalized,
    projectPlacement: input.result.project,
  };
  const store = useSessionStore.getState();

  if (shouldStoreFetchedAgentInActiveDirectory(hydrated)) {
    store.setAgents(input.serverId, (previous) => {
      const next = new Map(previous);
      next.set(hydrated.id, hydrated);
      return next;
    });
  } else {
    store.setAgentDetails(input.serverId, (previous) => {
      const next = new Map(previous);
      next.set(hydrated.id, hydrated);
      return next;
    });
  }

  store.setPendingPermissions(input.serverId, (previous) => {
    const next = new Map(previous);
    for (const [key, pending] of next.entries()) {
      if (pending.agentId === hydrated.id) {
        next.delete(key);
      }
    }
    for (const request of hydrated.pendingPermissions) {
      const key = derivePendingPermissionKey(hydrated.id, request);
      next.set(key, { key, agentId: hydrated.id, request });
    }
    return next;
  });

  return hydrated;
}

function useAgentPanelDescriptor(
  target: { kind: "agent"; agentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const descriptorState = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[context.serverId];
      const agent =
        session?.agents?.get(target.agentId) ?? session?.agentDetails?.get(target.agentId) ?? null;
      return {
        provider: agent?.provider ?? "codex",
        title: agent?.title ?? null,
        status: agent?.status ?? null,
        pendingPermissionCount: agent?.pendingPermissions.length ?? 0,
        requiresAttention: agent?.requiresAttention ?? false,
        attentionReason: agent?.attentionReason ?? null,
      };
    }),
  );
  const provider = descriptorState.provider;
  const label = resolveWorkspaceAgentTabLabel(descriptorState.title);
  const icon = getProviderIcon(provider);

  return {
    label: label ?? "",
    subtitle: `${formatProviderLabel(provider)} agent`,
    titleState: label ? "ready" : "loading",
    icon,
    statusBucket: descriptorState.status
      ? deriveSidebarStateBucket({
          status: descriptorState.status,
          pendingPermissionCount: descriptorState.pendingPermissionCount,
          requiresAttention: descriptorState.requiresAttention,
          attentionReason: descriptorState.attentionReason,
        })
      : null,
  };
}

function AgentPanel() {
  const { serverId, target, openFileInWorkspace } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  invariant(target.kind === "agent", "AgentPanel requires agent target");

  return (
    <AgentPanelContent
      serverId={serverId}
      agentId={target.agentId}
      isPaneFocused={isInteractive}
      onOpenWorkspaceFile={openFileInWorkspace}
    />
  );
}

function DraftPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace, openImportSheet } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  invariant(target.kind === "draft", "DraftPanel requires draft target");
  const queryClient = useQueryClient();

  const handleCreated = useCallback(
    (agentSnapshot: Parameters<typeof normalizeAgentSnapshot>[0]) => {
      const normalized = normalizeAgentSnapshot(agentSnapshot, serverId);
      // Prefer the placement the daemon attached to the create response, then
      // the registered workspace's placement, then fall back to a cwd-derived
      // one. The optimistic row already used the workspace placement, so the
      // real row lands in the same sidebar directory (no fake new directory).
      const workspaceProject =
        useSessionStore.getState().sessions[serverId]?.workspaces?.get(workspaceId)?.project ??
        null;
      const createProject = (agentSnapshot as { project?: ProjectPlacementPayload | null }).project;
      const projectPlacement = resolveProjectPlacement({
        projectPlacement: createProject ?? workspaceProject,
        cwd: normalized.cwd,
      });
      const hydrated = {
        ...normalized,
        projectPlacement,
      };
      useSessionStore.getState().setAgents(serverId, (prev) => {
        const next = new Map(prev);
        // The optimistic row is keyed by the same client-minted agent id, so
        // setting the real snapshot in place replaces it (no second row).
        next.set(agentSnapshot.id, hydrated);
        return next;
      });
      // Invalidate agent history so the sidebar picks up the new conversation
      // immediately, without waiting for the 30s staleTime or an agent_update push
      // that the server may silently drop (subscription null / bootstrap buffer).
      for (const queryKey of agentHistoryQueryKeys(serverId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
      const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      if (workspaceKey) {
        useWorkspaceLayoutStore.getState().convertDraftToAgent(workspaceKey, agentSnapshot.id);
      }
    },
    [queryClient, serverId, workspaceId],
  );

  return (
    <WorkspaceDraftAgentTab
      serverId={serverId}
      workspaceId={workspaceId}
      draftId={target.draftId}
      initialSetup={target.setup}
      isPaneFocused={isInteractive}
      onOpenWorkspaceFile={openFileInWorkspace}
      onCreated={handleCreated}
      onOpenImportSheet={openImportSheet}
    />
  );
}

export function AgentConversationPanel() {
  const { target } = usePaneContext();
  if (target.kind === "draft") {
    return <DraftPanel />;
  }
  if (target.kind === "agent") {
    return <AgentPanel />;
  }
  invariant(false, "AgentConversationPanel requires an agent or draft target");
}

export const agentPanelRegistration: PanelRegistration<"agent"> = {
  kind: "agent",
  component: AgentConversationPanel,
  useDescriptor: useAgentPanelDescriptor,
};

export function useDraftPanelDescriptor(
  target: { kind: "draft"; draftId: string },
  context: { serverId: string },
) {
  const { t } = useTranslation();
  const createDescriptorState = useCreateFlowStore(
    useShallow((state) => {
      const pending = state.pendingByDraftId[target.draftId];
      if (pending?.serverId !== context.serverId || pending.lifecycle !== "active") {
        return {
          isCreating: false,
          pendingPrompt: null,
        };
      }
      return {
        isCreating: true,
        pendingPrompt: pending.text,
      };
    }),
  );

  return buildDraftPanelDescriptor({
    ...createDescriptorState,
    icon: SquarePen,
    copy: {
      newAgent: t("panels.agent.newAgent"),
      creatingAgent: t("panels.agent.creatingAgent"),
    },
  });
}

const EMPTY_STREAM_ITEMS: StreamItem[] = [];
const EMPTY_PENDING_PERMISSIONS = new Map<string, PendingPermission>();
const EMPTY_PENDING_PERMISSION_LIST: PendingPermission[] = [];

type RouteBottomAnchorRequest = ReturnType<typeof deriveRouteBottomAnchorRequest>;

function findActiveCreateHandoff(input: {
  pendingByDraftId: ReturnType<typeof useCreateFlowStore.getState>["pendingByDraftId"];
  serverId: string;
  agentId?: string;
}): boolean {
  if (!input.agentId) {
    return false;
  }
  return Object.values(input.pendingByDraftId).some(
    (pending) =>
      pending.lifecycle === "sent" &&
      pending.serverId === input.serverId &&
      pending.agentId === input.agentId,
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isNotFoundErrorMessage(message: string): boolean {
  return /agent not found|not found/i.test(message);
}

type AgentLookupState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "not_found"; message: string }
  | { tag: "error"; message: string };

function AgentPanelContent({
  serverId,
  agentId,
  isPaneFocused,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId: string;
  isPaneFocused: boolean;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const resolvedAgentId = agentId.trim() || undefined;
  const resolvedServerId = serverId.trim() || undefined;
  const daemons = useHosts();
  const runtimeServerId = resolvedServerId ?? "";
  const runtimeClient = useHostRuntimeClient(runtimeServerId);
  const runtimeIsConnected = useHostRuntimeIsConnected(runtimeServerId);
  const runtimeConnectionStatus = useHostRuntimeConnectionStatus(runtimeServerId);
  const runtimeLastError = useHostRuntimeLastError(runtimeServerId);

  const connectionServerId = resolvedServerId ?? null;
  const daemon = connectionServerId
    ? (daemons.find((entry) => entry.serverId === connectionServerId) ?? null)
    : null;
  const serverLabel = daemon?.label ?? connectionServerId ?? "Selected host";
  const isUnknownDaemon = Boolean(connectionServerId && !daemon);
  const connectionStatus: HostRuntimeConnectionStatus =
    isUnknownDaemon && runtimeConnectionStatus === "connecting"
      ? "offline"
      : runtimeConnectionStatus;
  const lastConnectionError = runtimeLastError;

  if (!resolvedServerId || !runtimeClient) {
    return (
      <AgentSessionUnavailableState
        serverLabel={serverLabel}
        connectionStatus={connectionStatus}
        lastError={lastConnectionError}
        isUnknownDaemon={isUnknownDaemon}
      />
    );
  }

  return (
    <AgentPanelBody
      serverId={resolvedServerId}
      agentId={resolvedAgentId}
      isPaneFocused={isPaneFocused}
      client={runtimeClient}
      isConnected={runtimeIsConnected}
      connectionStatus={connectionStatus}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

function AgentPanelBody({
  serverId,
  agentId,
  isPaneFocused,
  client,
  isConnected,
  connectionStatus,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId?: string;
  isPaneFocused: boolean;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  isConnected: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const { isArchivingAgent: _isArchivingAgent } = useArchiveAgent();
  const hasSession = useSessionStore((state) => Boolean(state.sessions[serverId]));
  const projectPlacement = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return null;
      }
      const session = state.sessions[serverId];
      return (
        session?.agents?.get(agentId)?.projectPlacement ??
        session?.agentDetails?.get(agentId)?.projectPlacement ??
        null
      );
    },
    (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  );
  const agentState = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      const agent = agentId
        ? (session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null)
        : null;
      return {
        serverId: agent?.serverId ?? null,
        id: agent?.id ?? null,
        status: agent?.status ?? null,
        cwd: agent?.cwd ?? null,
        lastError: agent?.lastError ?? null,
        archivedAt: agent?.archivedAt ?? null,
      };
    }),
  );
  const [lookupState, setLookupState] = useState<AgentLookupState>({ tag: "idle" });
  const lookupAttemptTokenRef = useRef(0);

  useEffect(() => {
    lookupAttemptTokenRef.current += 1;
    setLookupState({ tag: "idle" });
  }, [agentId, serverId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (agentState.id) {
      if (lookupState.tag !== "idle") {
        setLookupState({ tag: "idle" });
      }
      return;
    }
    if (!isConnected || !hasSession) {
      return;
    }
    if (lookupState.tag === "loading" || lookupState.tag === "not_found") {
      return;
    }

    setLookupState({ tag: "loading" });
    const attemptToken = ++lookupAttemptTokenRef.current;

    client
      .fetchAgent(agentId)
      .then((result) => {
        if (attemptToken !== lookupAttemptTokenRef.current) {
          return;
        }
        if (!result) {
          setLookupState({
            tag: "not_found",
            message: `找不到智能体：${agentId}`,
          });
          return;
        }

        storeFetchedAgentDetail({ serverId, result });
        setLookupState({ tag: "idle" });
        return;
      })
      .catch((error) => {
        if (attemptToken !== lookupAttemptTokenRef.current) {
          return;
        }
        const message = toErrorMessage(error);
        if (isNotFoundErrorMessage(message)) {
          setLookupState({ tag: "not_found", message });
          return;
        }
        setLookupState({ tag: "error", message });
      });
  }, [agentId, agentState.id, client, hasSession, isConnected, lookupState.tag, serverId]);

  if (lookupState.tag === "not_found") {
    return (
      <View style={styles.container} testID="agent-not-found">
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("panels.agent.notFound")}</Text>
        </View>
      </View>
    );
  }

  if (lookupState.tag === "error") {
    return (
      <View style={styles.container} testID="agent-load-error">
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("panels.agent.loadFailed")}</Text>
          <Text style={styles.statusText}>{lookupState.message}</Text>
        </View>
      </View>
    );
  }

  const agent: AgentScreenAgent | null =
    agentState.serverId && agentState.id && agentState.status && agentState.cwd
      ? {
          serverId: agentState.serverId,
          id: agentState.id,
          status: agentState.status,
          cwd: agentState.cwd,
          lastError: agentState.lastError ?? null,
          projectPlacement,
        }
      : null;

  if (!agent) {
    return (
      <View style={styles.container} testID="agent-loading">
        <View style={styles.errorContainer}>
          <ThemedActivityIndicator size="large" uniProps={foregroundMutedColorMapping} />
        </View>
      </View>
    );
  }

  return (
    <ChatAgentContent
      serverId={serverId}
      agentId={agentId}
      isPaneFocused={isPaneFocused}
      client={client}
      isConnected={isConnected}
      connectionStatus={connectionStatus}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

function ChatAgentContent({
  serverId,
  agentId,
  isPaneFocused,
  client,
  isConnected,
  connectionStatus,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId?: string;
  isPaneFocused: boolean;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  isConnected: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const panelToast = useToastHost();
  const { isArchivingAgent } = useArchiveAgent();
  const streamViewRef = useRef<AgentStreamViewHandle>(null);
  const addImagesRef = useRef<((images: ImageAttachment[]) => void) | null>(null);
  const clearOnAgentBlurRef = useRef<() => void>(() => {});
  const wasPaneFocusedRef = useRef(isPaneFocused);
  const reconnectToastArmedRef = useRef(false);
  const initAttemptTokenRef = useRef(0);
  const routeBottomAnchorRequestRef = useRef<{
    routeKey: string;
    reason: "initial-entry" | "resume";
  } | null>(null);
  const handleFilesDropped = useCallback((files: ImageAttachment[]) => {
    addImagesRef.current?.(files);
  }, []);

  const handleAddImagesCallback = useCallback((addImages: (images: ImageAttachment[]) => void) => {
    addImagesRef.current = addImages;
  }, []);

  const agentState = useSessionStore(
    useShallow((state) => selectChatAgentState(state, serverId, agentId)),
  );
  const projectPlacement = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return null;
      }
      const session = state.sessions[serverId];
      return (
        session?.agents?.get(agentId)?.projectPlacement ??
        session?.agentDetails?.get(agentId)?.projectPlacement ??
        null
      );
    },
    (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  );
  const isInitializingFromMap = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.initializingAgents?.get(agentId) ?? false) : false,
  );
  const historySyncGeneration = useSessionStore(
    (state) => state.sessions[serverId]?.historySyncGeneration ?? 0,
  );
  const hasAppliedAuthoritativeHistory = useSessionStore((state) =>
    agentId
      ? state.sessions[serverId]?.agentAuthoritativeHistoryApplied?.get(agentId) === true
      : false,
  );
  const hasCachedStreamItems = useSessionStore((state) => {
    if (!agentId) {
      return false;
    }
    const streamItems = state.sessions[serverId]?.agentStreamTail?.get(agentId);
    return Boolean(streamItems && streamItems.length > 0);
  });
  const agentHistorySyncGeneration = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agentHistorySyncGeneration?.get(agentId) ?? -1) : -1,
  );
  const hasActiveCreateHandoff = useCreateFlowStore((state) =>
    findActiveCreateHandoff({ pendingByDraftId: state.pendingByDraftId, serverId, agentId }),
  );
  const hasSession = useSessionStore((state) => Boolean(state.sessions[serverId]));
  const { ensureAgentIsInitialized } = useAgentInitialization({
    serverId,
    client: hasSession ? client : null,
  });
  const [missingAgentState, setMissingAgentState] = useState<AgentScreenMissingState>({
    kind: "idle",
  });

  const hasHydratedHistoryBefore = hasAppliedAuthoritativeHistory;

  const attentionController = useAgentAttentionClear({
    agentId,
    client,
    isConnected,
    requiresAttention: agentState.requiresAttention,
    attentionReason: agentState.attentionReason,
    isScreenFocused: isPaneFocused,
  });
  useEffect(() => {
    clearOnAgentBlurRef.current = attentionController.clearOnAgentBlur;
  }, [attentionController.clearOnAgentBlur]);

  const { style: animatedKeyboardStyle } = useKeyboardShiftStyle({
    mode: "translate",
  });

  const handleHistorySyncFailure = useCallback(
    ({ origin, error }: { origin: "focus" | "entry"; error: unknown }) => {
      if (agentId) {
        console.warn("[AgentPanel] history sync failed", {
          origin,
          agentId,
          error,
        });
      }
      const message = toErrorMessage(error);
      setMissingAgentState((previous) => {
        if (previous.kind === "error" && previous.message === message) {
          return previous;
        }
        return { kind: "error", message };
      });
    },
    [agentId],
  );

  const ensureInitializedWithSyncErrorHandling = useCallback(
    (origin: "focus" | "entry") => {
      if (!agentId) {
        return;
      }
      ensureAgentIsInitialized(agentId).catch((error) => {
        handleHistorySyncFailure({ origin, error });
      });
    },
    [agentId, ensureAgentIsInitialized, handleHistorySyncFailure],
  );

  useEffect(() => {
    if (connectionStatus === "online") {
      if (reconnectToastArmedRef.current) {
        reconnectToastArmedRef.current = false;
        panelToast.dismiss();
      }
      return;
    }
    if (connectionStatus === "idle") {
      return;
    }
    if (!reconnectToastArmedRef.current) {
      reconnectToastArmedRef.current = true;
      panelToast.api.show(t("connection.reconnecting"), {
        durationMs: null,
        testID: "agent-reconnecting-toast",
      });
    }
  }, [connectionStatus, panelToast, t]);

  useEffect(() => {
    if (!isPaneFocused || !agentId || !isConnected || !hasSession) {
      return;
    }
    ensureInitializedWithSyncErrorHandling("focus");
  }, [agentId, ensureInitializedWithSyncErrorHandling, hasSession, isConnected, isPaneFocused]);

  const isArchivingCurrentAgent = Boolean(agentId && isArchivingAgent({ serverId, agentId }));

  useEffect(() => {
    if (wasPaneFocusedRef.current && !isPaneFocused) {
      clearOnAgentBlurRef.current();
    }
    wasPaneFocusedRef.current = isPaneFocused;
  }, [isPaneFocused]);

  useEffect(() => {
    return () => {
      if (wasPaneFocusedRef.current) {
        clearOnAgentBlurRef.current();
      }
    };
  }, []);

  const isInitializing = agentId ? isInitializingFromMap : false;
  const isHistorySyncing = useMemo(() => {
    if (!agentId || !isInitializing) {
      return false;
    }
    const initKey = getInitKey(serverId, agentId);
    return Boolean(getInitDeferred(initKey));
  }, [agentId, isInitializing, serverId]);
  const needsAuthoritativeSync = useMemo(() => {
    if (!agentId) {
      return false;
    }
    return agentHistorySyncGeneration < historySyncGeneration;
  }, [agentHistorySyncGeneration, agentId, historySyncGeneration]);

  const agent = useMemo<AgentScreenAgent | null>(
    () => buildChatAgentFromState(agentState, projectPlacement),
    [agentState, projectPlacement],
  );
  const continuity = useMemo<AgentScreenContinuity>(() => {
    if (!hasActiveCreateHandoff || !agentId) {
      return { kind: "none" };
    }
    // Prefer the live agent status once available so post-create run-start
    // failures (agent status error) are not masked as forever-running.
    const status =
      agent?.status === "error" || agent?.status === "idle" || agent?.status === "running"
        ? agent.status
        : "running";
    return {
      kind: "optimistic-create",
      agent: {
        serverId,
        id: agentId,
        status,
        cwd: agent?.cwd ?? ".",
        projectPlacement: agent?.projectPlacement ?? null,
      },
    };
  }, [agent, agentId, hasActiveCreateHandoff, serverId]);

  const viewState = useAgentScreenStateMachine({
    routeKey: `${serverId}:${agentId ?? ""}`,
    input: {
      agent: agent ?? null,
      missingAgentState,
      isConnected,
      isArchivingCurrentAgent,
      isHistorySyncing,
      needsAuthoritativeSync,
      continuity,
      hasHydratedHistoryBefore,
      hasCachedStreamItems,
    },
  });

  const effectiveAgent = viewState.tag === "ready" ? viewState.agent : null;
  const routeEntryKey = agentId ? `${serverId}:${agentId}` : null;
  routeBottomAnchorRequestRef.current = deriveRouteBottomAnchorIntent({
    cachedIntent: routeBottomAnchorRequestRef.current,
    routeKey: routeEntryKey,
    hasAppliedAuthoritativeHistoryAtEntry: hasAppliedAuthoritativeHistory,
  });
  const routeBottomAnchorRequest = useMemo(
    () =>
      deriveRouteBottomAnchorRequest({
        intent: routeBottomAnchorRequestRef.current,
        effectiveAgentId: effectiveAgent?.id ?? null,
      }),
    [effectiveAgent?.id],
  );

  const handleComposerHeightChange = useCallback(
    (_height: number) => {
      if (!agentId) {
        return;
      }
      streamViewRef.current?.prepareForViewportChange();
    },
    [agentId],
  );

  const handleMessageSent = useCallback(() => {
    if (!agentId) {
      return;
    }
    // The optimistic user message is written to the stream store after this
    // callback fires (the delivery controller emits it before dispatching),
    // so anchoring is driven declaratively by the optimistic-message effect
    // in AgentStreamSection instead of here.
  }, [agentId]);

  useEffect(() => {
    if (!agentId || !hasSession) {
      return;
    }

    const cachedAgentId = agentId;
    const currentTail = useSessionStore
      .getState()
      .sessions[serverId]?.agentStreamTail.get(cachedAgentId);
    if (currentTail && currentTail.length > 0) {
      return;
    }

    let cancelled = false;
    async function hydrateCachedStreamTail(): Promise<void> {
      try {
        const cachedItems = await loadCachedAgentStreamTail({ serverId, agentId: cachedAgentId });
        if (cancelled || cachedItems.length === 0) {
          return;
        }
        useSessionStore.getState().setAgentStreamTail(serverId, (prev) => {
          const latestTail = prev.get(cachedAgentId);
          if (latestTail && latestTail.length > 0) {
            return prev;
          }
          const next = new Map(prev);
          next.set(cachedAgentId, cachedItems);
          return next;
        });
      } catch (error) {
        console.warn("[AgentPanel] failed to hydrate cached agent stream tail", {
          serverId,
          agentId: cachedAgentId,
          error,
        });
      }
    }

    void hydrateCachedStreamTail();

    return () => {
      cancelled = true;
    };
  }, [agentId, hasSession, serverId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (!isConnected || !hasSession) {
      return;
    }
    const shouldSyncOnEntry = needsAuthoritativeSync || isNative;
    if (!shouldSyncOnEntry) {
      return;
    }

    ensureInitializedWithSyncErrorHandling("entry");
  }, [
    agentId,
    ensureInitializedWithSyncErrorHandling,
    hasSession,
    isConnected,
    needsAuthoritativeSync,
  ]);

  useEffect(() => {
    initAttemptTokenRef.current += 1;
    setMissingAgentState({ kind: "idle" });
  }, [agentId, serverId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (agentState.id) {
      if (missingAgentState.kind === "resolving" || missingAgentState.kind === "not_found") {
        setMissingAgentState({ kind: "idle" });
      }
      return;
    }
    if (!isConnected || !hasSession) {
      return;
    }
    if (missingAgentState.kind === "resolving" || missingAgentState.kind === "not_found") {
      return;
    }

    setMissingAgentState({ kind: "resolving" });
    const attemptToken = ++initAttemptTokenRef.current;

    ensureAgentIsInitialized(agentId)
      .then(async () => {
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        const currentSession = useSessionStore.getState().sessions[serverId];
        const currentAgent =
          currentSession?.agents.get(agentId) ?? currentSession?.agentDetails.get(agentId);
        if (!currentAgent) {
          const result = await client.fetchAgent(agentId);
          if (attemptToken !== initAttemptTokenRef.current) {
            return;
          }
          if (!result) {
            setMissingAgentState({
              kind: "not_found",
              message: `找不到智能体：${agentId}`,
            });
            return;
          }
          storeFetchedAgentDetail({ serverId, result });
        }
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        setMissingAgentState({ kind: "idle" });
        return;
      })
      .catch((error) => {
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        const message = toErrorMessage(error);
        if (isNotFoundErrorMessage(message)) {
          setMissingAgentState({ kind: "not_found", message });
          return;
        }
        setMissingAgentState({ kind: "error", message });
      });
  }, [
    agentState.id,
    agentId,
    client,
    ensureAgentIsInitialized,
    hasSession,
    isConnected,
    missingAgentState.kind,
    serverId,
  ]);

  useEffect(() => {
    if (missingAgentState.kind === "error" && hasAppliedAuthoritativeHistory) {
      setMissingAgentState({ kind: "idle" });
    }
  }, [hasAppliedAuthoritativeHistory, missingAgentState.kind]);

  const animatedContentStyle = useMemo(
    () => [staticStyles.content, animatedKeyboardStyle],
    [animatedKeyboardStyle],
  );

  const nonReadyView = renderChatAgentNonReadyView({
    viewState,
    effectiveAgent,
    copy: {
      notFound: t("panels.agent.notFound"),
      loadFailed: t("panels.agent.loadFailed"),
    },
  });
  if (nonReadyView) return nonReadyView;
  invariant(agentId, "agent id is defined when agent content is ready");
  invariant(effectiveAgent, "effectiveAgent is defined when the non-ready view is absent");
  const agentCwd = agentState.cwd;
  invariant(agentCwd, "agent cwd is defined when agent content is ready");
  const showHistorySyncOverlay =
    viewState.tag === "ready" &&
    viewState.sync.status === "catching_up" &&
    viewState.sync.ui === "overlay";
  const historySyncErrorMessage =
    viewState.tag === "ready" && viewState.sync.status === "sync_error"
      ? viewState.sync.message
      : null;

  return (
    <ChatAgentReadyContent
      serverId={serverId}
      agentId={agentId}
      isPaneFocused={isPaneFocused}
      isArchivingCurrentAgent={isArchivingCurrentAgent}
      agentState={agentState}
      effectiveAgent={effectiveAgent}
      routeBottomAnchorRequest={routeBottomAnchorRequest}
      hasAppliedAuthoritativeHistory={hasAppliedAuthoritativeHistory}
      panelToast={panelToast}
      streamViewRef={streamViewRef}
      animatedContentStyle={animatedContentStyle}
      handleFilesDropped={handleFilesDropped}
      handleAddImagesCallback={handleAddImagesCallback}
      handleComposerHeightChange={handleComposerHeightChange}
      handleMessageSent={handleMessageSent}
      showHistorySyncOverlay={showHistorySyncOverlay}
      historySyncErrorMessage={historySyncErrorMessage}
      cwd={agentCwd}
      attentionController={attentionController}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

function ChatAgentReadyContent({
  serverId,
  agentId,
  isPaneFocused,
  isArchivingCurrentAgent,
  agentState,
  effectiveAgent,
  routeBottomAnchorRequest,
  hasAppliedAuthoritativeHistory,
  panelToast,
  streamViewRef,
  animatedContentStyle,
  handleFilesDropped,
  handleAddImagesCallback,
  handleComposerHeightChange,
  handleMessageSent,
  showHistorySyncOverlay,
  historySyncErrorMessage,
  cwd,
  attentionController,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  agentId: string;
  isPaneFocused: boolean;
  isArchivingCurrentAgent: boolean;
  agentState: ChatAgentSelectedState;
  effectiveAgent: AgentScreenAgent;
  routeBottomAnchorRequest: RouteBottomAnchorRequest;
  hasAppliedAuthoritativeHistory: boolean;
  panelToast: ReturnType<typeof useToastHost>;
  streamViewRef: React.RefObject<AgentStreamViewHandle | null>;
  animatedContentStyle: object[];
  handleFilesDropped: (files: ImageAttachment[]) => void;
  handleAddImagesCallback: (addImages: (images: ImageAttachment[]) => void) => void;
  handleComposerHeightChange: (height: number) => void;
  handleMessageSent: () => void;
  showHistorySyncOverlay: boolean;
  historySyncErrorMessage: string | null;
  cwd: string;
  attentionController: ReturnType<typeof useAgentAttentionClear>;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const agentInputDraft = useAgentInputDraft({
    draftKey: buildDraftStoreKey({
      serverId,
      agentId,
    }),
  });

  // Anchor the just-sent row near the top so the reply grows below it. The
  // composer dispatches the optimistic user message id (stable across server
  // adoption), which avoids racing the daemon: the optimistic entry can be
  // adopted before it ever renders, so watching the stream for optimistic
  // entries is unreliable.
  const handleOptimisticMessageDispatched = useCallback(
    (messageId: string) => {
      streamViewRef.current?.requestTurnAnchor({
        reason: "message-sent",
        anchorMessageId: messageId,
        requestKey: `${agentId}:${messageId}`,
      });
    },
    [agentId, streamViewRef],
  );

  return (
    <RewindComposerRestoreProvider text={agentInputDraft.text} setText={agentInputDraft.setText}>
      <View style={styles.root} testID={agentId ? `agent-panel-${agentId}` : undefined}>
        <FileDropZone onFilesDropped={handleFilesDropped} disabled={isArchivingCurrentAgent}>
          {/* The centered ConversationAspectColumn lives on the center-column shell
              (workspace-center-column.tsx), not here — it stays mounted across agent
              switches so the conversation width never re-measures and never flashes. */}
          <View style={styles.contentContainer}>
            <ReanimatedAnimated.View style={animatedContentStyle}>
              <AgentStreamSection
                streamViewRef={streamViewRef}
                serverId={serverId}
                agentId={agentId}
                agent={effectiveAgent}
                routeBottomAnchorRequest={routeBottomAnchorRequest}
                hasAppliedAuthoritativeHistory={hasAppliedAuthoritativeHistory}
                toast={panelToast.api}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
              />
            </ReanimatedAnimated.View>

            {showHistorySyncOverlay ? (
              <HistorySyncProgressBanner
                title={t("panels.agent.historySyncingTitle")}
                subtitle={t("panels.agent.historySyncingSubtitle")}
              />
            ) : null}
          </View>

          {historySyncErrorMessage ? (
            <HistorySyncErrorBanner
              title={t("panels.agent.historySyncFailed")}
              message={historySyncErrorMessage}
            />
          ) : null}

          {agentState.status === "error" && agentState.lastError ? (
            <HistorySyncErrorBanner
              title={t("panels.agent.runFailed")}
              message={agentState.lastError}
            />
          ) : null}

          <AgentComposerSection
            agentId={agentId}
            serverId={serverId}
            isPaneFocused={isPaneFocused}
            isArchivingCurrentAgent={isArchivingCurrentAgent}
            archivedAt={agentState.archivedAt}
            cwd={cwd}
            isSubmitLoading={false}
            agentInputDraft={agentInputDraft}
            onAttentionInputFocus={attentionController.clearOnInputFocus}
            onAttentionPromptSend={attentionController.clearOnPromptSend}
            onAddImages={handleAddImagesCallback}
            onComposerHeightChange={handleComposerHeightChange}
            onMessageSent={handleMessageSent}
            onOptimisticMessageDispatched={handleOptimisticMessageDispatched}
          />

          <ToastViewport
            toasts={panelToast.toasts}
            onDismiss={panelToast.dismiss}
            placement="panel"
          />
        </FileDropZone>
      </View>
    </RewindComposerRestoreProvider>
  );
}

function HistorySyncErrorBanner({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.historySyncErrorBanner} testID="agent-history-sync-error">
      <Text style={styles.historySyncErrorTitle}>{title}</Text>
      <Text style={styles.historySyncErrorMessage} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
}

function HistorySyncProgressBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View
      pointerEvents="none"
      style={styles.historySyncProgressBanner}
      testID="agent-history-syncing-banner"
    >
      <ThemedActivityIndicator size="small" uniProps={foregroundMutedColorMapping} />
      <View style={styles.historySyncProgressText}>
        <Text style={styles.historySyncProgressTitle} testID="agent-history-syncing-banner-title">
          {title}
        </Text>
        <Text style={styles.historySyncProgressSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

function AgentStreamSection({
  streamViewRef,
  serverId,
  agentId,
  agent,
  routeBottomAnchorRequest,
  hasAppliedAuthoritativeHistory,
  toast,
  onOpenWorkspaceFile,
}: {
  streamViewRef: React.RefObject<AgentStreamViewHandle | null>;
  serverId: string;
  agentId?: string;
  agent: AgentScreenAgent;
  routeBottomAnchorRequest: RouteBottomAnchorRequest;
  hasAppliedAuthoritativeHistory: boolean;
  toast: ReturnType<typeof useToastHost>["api"];
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const streamItemsRaw = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agentStreamTail?.get(agentId) : undefined,
  );
  const streamItems = streamItemsRaw ?? EMPTY_STREAM_ITEMS;
  const pendingPermissionList = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return EMPTY_PENDING_PERMISSION_LIST;
      }
      const allPendingPermissions = state.sessions[serverId]?.pendingPermissions;
      if (!allPendingPermissions) {
        return EMPTY_PENDING_PERMISSION_LIST;
      }
      const filtered: PendingPermission[] = [];
      for (const permission of allPendingPermissions.values()) {
        if (permission.agentId === agentId) {
          filtered.push(permission);
        }
      }
      return filtered.length > 0 ? filtered : EMPTY_PENDING_PERMISSION_LIST;
    },
    shallow,
  );
  const pendingPermissions = useMemo(() => {
    if (pendingPermissionList.length === 0) {
      return EMPTY_PENDING_PERMISSIONS;
    }
    return new Map(pendingPermissionList.map((permission) => [permission.key, permission]));
  }, [pendingPermissionList]);

  return (
    <AgentStreamView
      ref={streamViewRef}
      agentId={agent.id}
      serverId={serverId}
      agent={agent}
      streamItems={streamItems}
      pendingPermissions={pendingPermissions}
      routeBottomAnchorRequest={routeBottomAnchorRequest}
      isAuthoritativeHistoryReady={hasAppliedAuthoritativeHistory}
      toast={toast}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
      isTurnAnchorEnabled={isWeb}
    />
  );
}

function AgentComposerSection({
  agentId,
  serverId,
  isPaneFocused,
  isArchivingCurrentAgent,
  archivedAt,
  cwd,
  isSubmitLoading,
  agentInputDraft,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onAddImages,
  onComposerHeightChange,
  onMessageSent,
  onOptimisticMessageDispatched,
}: {
  agentId?: string;
  serverId: string;
  isPaneFocused: boolean;
  isArchivingCurrentAgent: boolean;
  archivedAt: Date | null;
  cwd: string;
  isSubmitLoading: boolean;
  agentInputDraft: AgentInputDraft;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onAddImages: (addImages: (images: ImageAttachment[]) => void) => void;
  onComposerHeightChange: (height: number) => void;
  onMessageSent: () => void;
  onOptimisticMessageDispatched: (messageId: string) => void;
}) {
  if (!agentId) {
    return null;
  }
  if (archivedAt) {
    return <ArchivedAgentCallout serverId={serverId} agentId={agentId} />;
  }
  if (isArchivingCurrentAgent) {
    return null;
  }

  return (
    <ActiveAgentComposer
      agentId={agentId}
      serverId={serverId}
      isPaneFocused={isPaneFocused}
      cwd={cwd}
      isSubmitLoading={isSubmitLoading}
      agentInputDraft={agentInputDraft}
      onAttentionInputFocus={onAttentionInputFocus}
      onAttentionPromptSend={onAttentionPromptSend}
      onAddImages={onAddImages}
      onComposerHeightChange={onComposerHeightChange}
      onMessageSent={onMessageSent}
      onOptimisticMessageDispatched={onOptimisticMessageDispatched}
    />
  );
}

function ActiveAgentComposer({
  agentId,
  serverId,
  isPaneFocused,
  cwd,
  isSubmitLoading,
  agentInputDraft,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onAddImages,
  onComposerHeightChange,
  onMessageSent,
  onOptimisticMessageDispatched,
}: {
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  cwd: string;
  isSubmitLoading: boolean;
  agentInputDraft: AgentInputDraft;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onAddImages: (addImages: (images: ImageAttachment[]) => void) => void;
  onComposerHeightChange: (height: number) => void;
  onMessageSent: () => void;
  onOptimisticMessageDispatched: (messageId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const isCompact = useIsCompactFormFactor();
  const paneContext = usePaneContext();
  const { workspaceId } = paneContext;
  const { archiveAgent } = useArchiveAgent();
  const unpinWorkspaceAgent = useWorkspaceLayoutStore((state) => state.unpinAgent);
  const subagentRows = useSubagentsForParent({
    serverId,
    parentAgentId: agentId,
  });
  const handleOpenSubagent = useCallback(
    (subagentId: string) => {
      navigateToAgent({ serverId, agentId: subagentId });
    },
    [serverId],
  );
  const handleArchiveSubagent = useArchiveSubagent({ serverId });
  const workspaceAttachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    cwd,
    workspaceId,
  });
  const workspaceAttachments = useWorkspaceAttachments(workspaceAttachmentScopeKey);
  const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const handleOpenWorkspaceAttachment = useCallback(
    (attachment: WorkspaceComposerAttachment) => {
      if (attachment.kind !== "review") {
        return;
      }
      const checkout = {
        serverId,
        cwd: attachment.attachment.cwd,
        isGit: true,
      };
      openFileExplorerForCheckout({
        checkout,
        isCompact,
      });
      setExplorerTabForCheckout({
        ...checkout,
        tab: "changes",
      });
    },
    [isCompact, openFileExplorerForCheckout, serverId, setExplorerTabForCheckout],
  );

  const handleClientSlashCommand = useCallback(
    async (command: ClientSlashCommand) => {
      const agent = resolveChatAgentFromSession(useSessionStore.getState(), serverId, agentId);
      if (!agent) {
        throw new Error("找不到智能体");
      }

      const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      if (workspaceKey) {
        unpinWorkspaceAgent(workspaceKey, agentId);
      }

      if (command.kind === "replace-agent-with-draft" && workspaceKey) {
        useWorkspaceLayoutStore.getState().openTarget(workspaceKey, {
          kind: "draft",
          draftId: generateDraftId(),
          setup: buildDraftAgentSetup(agent),
        });
      }

      await archiveAgent({ serverId, agentId });
    },
    [agentId, archiveAgent, serverId, unpinWorkspaceAgent, workspaceId],
  );

  const { style: composerKeyboardStyle } = useKeyboardShiftStyle({
    mode: "translate",
  });

  const inputAreaStyle = useMemo(
    () => [staticStyles.inputAreaWrapper, { paddingBottom: insets.bottom }, composerKeyboardStyle],
    [insets.bottom, composerKeyboardStyle],
  );

  const composerFooter = useMemo(
    () =>
      isCompact ? (
        <AgentModeControl serverId={serverId} agentId={agentId} placement="footer" />
      ) : undefined,
    [isCompact, serverId, agentId],
  );

  return (
    <ReanimatedAnimated.View style={inputAreaStyle}>
      <View style={isCompact ? styles.inputAreaWrapperCompact : styles.inputAreaWrapper}>
        <SubagentsTrack
          rows={subagentRows}
          onOpenSubagent={handleOpenSubagent}
          onArchiveSubagent={handleArchiveSubagent}
        />
        <Composer
          agentId={agentId}
          serverId={serverId}
          externalKeyboardShift
          isPaneFocused={isPaneFocused}
          value={agentInputDraft.text}
          onChangeText={agentInputDraft.setText}
          attachments={agentInputDraft.attachments}
          workspaceAttachments={workspaceAttachments}
          onOpenWorkspaceAttachment={handleOpenWorkspaceAttachment}
          onChangeAttachments={agentInputDraft.setAttachments}
          cwd={cwd}
          clearDraft={agentInputDraft.clear}
          autoFocus={isPaneFocused}
          isSubmitLoading={isSubmitLoading}
          onAttentionInputFocus={onAttentionInputFocus}
          onAttentionPromptSend={onAttentionPromptSend}
          onAddImages={onAddImages}
          onComposerHeightChange={onComposerHeightChange}
          onMessageSent={onMessageSent}
          onOptimisticMessageDispatched={onOptimisticMessageDispatched}
          onClientSlashCommand={handleClientSlashCommand}
          footer={composerFooter}
          inputWrapperStyle={styles.composerInputWrapper}
        />
      </View>
    </ReanimatedAnimated.View>
  );
}

function AgentSessionUnavailableState({
  serverLabel,
  connectionStatus,
  lastError,
  isUnknownDaemon = false,
}: {
  serverLabel: string;
  connectionStatus: HostRuntimeConnectionStatus;
  lastError: string | null;
  isUnknownDaemon?: boolean;
}) {
  const { t } = useTranslation();
  if (isUnknownDaemon) {
    return (
      <View style={styles.container}>
        <View style={styles.centerState}>
          <Text style={styles.errorText}>
            {t("panels.agent.unknownDaemonTitle", { host: serverLabel })}
          </Text>
          <Text style={styles.statusText}>{t("panels.agent.unknownDaemonBody")}</Text>
        </View>
      </View>
    );
  }

  const isConnecting = connectionStatus === "connecting";
  const isPreparingSession = connectionStatus === "online";

  return (
    <View style={styles.container}>
      <View style={styles.centerState}>
        {isConnecting || isPreparingSession ? (
          <>
            <ActivityIndicator size="large" />
            <Text style={styles.loadingText}>
              {isPreparingSession
                ? t("connection.preparingSession", { host: serverLabel })
                : t("connection.connectingTo", { host: serverLabel })}
            </Text>
            <Text style={styles.statusText}>
              {isPreparingSession
                ? t("connection.preparingSessionHint")
                : t("connection.connectingHint")}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.offlineTitle}>
              {t("connection.reconnectingTo", { host: serverLabel })}
            </Text>
            <Text style={styles.offlineDescription}>{t("connection.reconnectingHint")}</Text>
            {lastError ? <Text style={styles.offlineDetails}>{lastError}</Text> : null}
          </>
        )}
      </View>
    </View>
  );
}

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minWidth: 0,
    width: "100%",
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
  },
  container: {
    flex: 1,
    minWidth: 0,
    width: "100%",
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
  },
  contentContainer: {
    flex: 1,
    minWidth: 0,
    width: "100%",
    overflow: "hidden",
    ...(isWeb ? { userSelect: "none" as const } : {}),
  },
  // Soft .composer-dock vertical only: the centered ConversationAspectColumn
  // now lives on the center-column shell, so the pen-bar matches the stream
  // column width via the shell-hosted column, not a panel-local wrapper.
  inputAreaWrapper: {
    width: "100%",
    minWidth: 0,
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
    paddingTop: 8,
    paddingHorizontal: 0,
    paddingBottom: 16,
  },
  inputAreaWrapperCompact: {
    width: "100%",
    minWidth: 0,
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
    paddingTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  // Soft docked pen-bar: short contact shadow (no long 36px trail).
  composerInputWrapper: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 18,
    backgroundColor: theme.colors.surface0,
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04), 0 4px 12px rgba(20, 23, 31, 0.06)",
        } as object)
      : {}),
  },
  historySyncProgressBanner: {
    position: "absolute",
    top: theme.spacing[4],
    alignSelf: "center",
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 12,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    zIndex: 40,
  },
  historySyncProgressText: {
    minWidth: 0,
  },
  historySyncProgressTitle: {
    color: theme.colors.foreground,
    // Soft meta chrome title: 12.5 medium.
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  historySyncProgressSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  historySyncErrorBanner: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 960,
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 12,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.destructive,
    backgroundColor: theme.colors.surface0,
  },
  historySyncErrorTitle: {
    color: theme.colors.destructive,
    // Soft meta chrome title: 12.5 medium.
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  historySyncErrorMessage: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  loadingText: {
    fontSize: 14.5,
    lineHeight: 22,
    color: theme.colors.foregroundMuted,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[3],
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // Soft empty/error copy: body-adjacent muted.
  errorText: {
    fontSize: 14.5,
    lineHeight: 22,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  statusText: {
    marginTop: theme.spacing[2],
    textAlign: "center",
    // Soft muted secondary copy: 12.5.
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  // Soft offline title: sheet-scale medium.
  offlineTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  offlineDescription: {
    // Soft muted secondary copy: 12.5.
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  offlineDetails: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));

const staticStyles = RNStyleSheet.create({
  content: {
    flex: 1,
  },
  inputAreaWrapper: {
    width: "100%",
  },
});
