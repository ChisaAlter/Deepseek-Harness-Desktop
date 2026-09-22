/**
 * Session context interfaces exposed to handlers.
 *
 * "The big SessionContext" (Domain 0) is broken down into per-domain
 * sub-interfaces so handlers only import the subset they need.  Domain 0
 * still exists as the intersection of all sub-interfaces because the
 * Session class must construct a single object that satisfies every handler.
 */

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { AgentPresetStore } from "../agent/agent-preset-store.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import type { ProjectRegistry } from "../workspace-registry.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { CheckoutDiffManager } from "../checkout-diff-manager.js";
import type { GitHubService } from "../../services/github-service.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type { WorkspaceUpdatesFilter } from "../workspace-directory.js";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import type { FileBackedChatService } from "../chat/chat-service.js";
import type { ScheduleService } from "../schedule/service.js";
import type { LoopService } from "../loop-service.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import type { TerminalSessionController } from "../../terminal/terminal-session-controller.js";
import type { ScriptRouteStore } from "../script-proxy.js";
import type { WorkspaceScriptRuntimeStore } from "../workspace-script-runtime-store.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import type { GitMutationRefreshReason } from "../session-helpers.js";
import type { DownloadTokenStore } from "../file-download/token-store.js";
import type { PushTokenStore } from "../push/token-store.js";
import type { UsageStore } from "../usage/usage-store.js";
import type {
  WorkspaceSetupSnapshot,
  WorkspaceDescriptorPayload,
  EditorTargetDescriptorPayload,
  EditorTargetId,
} from "../messages.js";
import type { PersistedWorkspaceRecord, PersistedProjectRecord } from "../workspace-registry.js";
import type {
  CreateChisaCodeWorktreeInput,
  CreateChisaCodeWorktreeResult,
} from "../chisacode-worktree-service.js";
import type { StructuredGenerationDaemonConfig } from "../agent/structured-generation-providers.js";
import type {
  CreateChisaCodeWorktreeSetupContinuationInput,
  CreateChisaCodeWorktreeWorkflowResult,
} from "../worktree-session.js";
import type { CreateAgentLifecycleDispatch } from "../agent/create-agent-lifecycle-dispatch.js";
import type pino from "pino";

// ---------------------------------------------------------------------------
// Domain A — Core identity / transport (every handler needs these)
// ---------------------------------------------------------------------------

export interface SessionIdentityContext {
  readonly clientId: string;
  readonly sessionId: string;
  readonly sessionLogger: pino.Logger;
  readonly chisacodeHome: string;
  readonly appVersion: string | null;

  /** Emit a downstream message to the client. */
  emit(message: SessionOutboundMessage): void;
  /** Whether the transport has a binary channel. */
  hasBinaryChannel(): boolean;
  /** Emit raw binary data on the secondary channel. */
  emitBinary(frame: Uint8Array): void;
  /** Check whether the connected client supports a capability. */
  supports(capability: string): boolean;

  /** Returns the current operation signal at operation start. */
  getOperationAbortSignal(): AbortSignal;
}

// ---------------------------------------------------------------------------
// Domain B — Workspace / Project / Git
// (WorkspaceProjectHandler + CheckoutGitHandler overlap)
// ---------------------------------------------------------------------------

export interface WorkspaceProjectContext {
  readonly projectRegistry: ProjectRegistry;
  readonly workspaceRegistry: WorkspaceRegistry;
  readonly workspaceGitService: WorkspaceGitService;
  readonly github: GitHubService;
  readonly checkoutDiffManager: CheckoutDiffManager;
  readonly workspaceSetupSnapshots: Map<string, WorkspaceSetupSnapshot>;

  // Git mutation helpers
  notifyGitMutation(
    cwd: string,
    reason: GitMutationRefreshReason,
    options?: { invalidateGithub?: boolean },
  ): Promise<void>;
  emitWorkspaceUpdateForCwd(cwd: string): Promise<void>;
  emitWorkspaceUpdateForWorkspaceId(workspaceId: string): Promise<void>;
  emitWorkspaceUpdatesForWorkspaceIds(
    workspaceIds: Iterable<string>,
    options?: { skipReconcile?: boolean; dedupeGitState?: boolean },
  ): Promise<void>;
  handleWorkspaceGitBranchSnapshot(cwd: string, branchName: string | null): void;

  // Workspace helpers
  resolveKnownProjectRootForConfig(repoRoot: string): Promise<string | null>;
  listFetchWorkspacesEntries(
    request: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>,
  ): Promise<{
    entries: WorkspaceDescriptorPayload[];
    pageInfo: { nextCursor: string | null; prevCursor: string | null; hasMore: boolean };
  }>;
  syncWorkspaceGitObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void;
  syncWorkspaceGitObserverForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void>;
  findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord>;
  describeWorkspaceRecord(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<WorkspaceDescriptorPayload>;
  describeCreatedWorktreeWorkspace(
    result: CreateChisaCodeWorktreeResult,
  ): Promise<WorkspaceDescriptorPayload>;
  createChisaCodeWorktreeWorkflow(
    input: CreateChisaCodeWorktreeInput,
    options?: {
      resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
      setupContinuation?: CreateChisaCodeWorktreeSetupContinuationInput;
    },
  ): Promise<CreateChisaCodeWorktreeWorkflowResult>;
  archiveWorkspaceRecord(workspaceId: string, archivedAt?: string): Promise<void>;
  markWorkspaceArchiving(workspaceIds: Iterable<string>, archivingAt: string): void;
  clearWorkspaceArchiving(workspaceIds: Iterable<string>): void;
  isPathWithinRoot(rootPath: string, candidatePath: string): boolean;

  // Workspace subscription state machine
  startWorkspaceUpdatesSubscription(subscriptionId: string, filter?: WorkspaceUpdatesFilter): void;
  completeWorkspaceUpdatesBootstrap(
    subscriptionId: string,
    entries: Iterable<WorkspaceDescriptorPayload>,
  ): boolean;
  cancelWorkspaceUpdatesSubscription(subscriptionId?: string): void;

  // Script status
  emitWorkspaceScriptStatusUpdate(workspaceId: string, workspaceDirectory: string): void;
}

// ---------------------------------------------------------------------------
// Domain C — Checkout / commit / PR (CheckoutGitHandler dedicated subset)
// Note: CheckoutGitHandler uses WorkspaceProjectContext as well — it imports
// the full SessionContext today.  The union is covered by WorkspaceProjectContext
// when the handler is migrated.
// ---------------------------------------------------------------------------

export interface CheckoutGitContext {
  /** Generate a commit message via structured generation. */
  generateCommitMessage(cwd: string): Promise<string>;
  /** Generate PR title/body via structured generation. */
  generatePullRequestText(cwd: string, baseRef?: string): Promise<{ title: string; body: string }>;
  /** Resolve an agent identifier to its canonical agent id. */
  resolveAgentIdentifier(
    identifier: string,
  ): Promise<{ ok: true; agentId: string } | { ok: false; error: string }>;

  // Editor targets
  getAvailableEditorTargets(): Promise<EditorTargetDescriptorPayload[]>;
  openEditorTarget(options: { editorId: EditorTargetId; path: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Domain D — Agent lifecycle
// ---------------------------------------------------------------------------

export interface AgentLifecycleContext {
  readonly agentManager: AgentManager;
  readonly agentStorage: AgentStorage;
  readonly agentPresetStore: AgentPresetStore;
  readonly providerSnapshotManager: ProviderSnapshotManager;
  readonly createAgentLifecycleDispatch: CreateAgentLifecycleDispatch;

  // Agent list / query
  listAgentPayloads(filter?: {
    labels?: Record<string, string>;
    includeUnavailablePersisted?: boolean;
  }): Promise<unknown[]>;
  getAgentPayloadById(agentId: string): Promise<unknown>;
  buildAgentPayload(agent: unknown): Promise<unknown>;
  buildStoredAgentPayload(record: unknown): unknown;

  // Agent creation helpers
  buildProjectPlacementForCwd(
    cwd: string,
    options?: { refreshGit?: boolean; fallback?: boolean },
  ): Promise<unknown>;
  buildAgentSessionConfig(
    config: unknown,
    gitOptions?: unknown,
    legacyWorktreeName?: string,
    firstAgentContext?: unknown,
  ): Promise<unknown>;
  resolveCreateAgentWorkspace(cwd: string, workspaceId?: string): Promise<unknown>;
  buildWorkspaceDescriptor(input: unknown): Promise<unknown>;
  isProviderVisibleToClient(provider: string): boolean;

  // Agent subscription state machine
  bufferOrEmitAgentUpdate(subscription: unknown, payload: unknown): void;
  getAgentUpdatesSubscription(): unknown;
  setAgentUpdatesSubscription(subscription: unknown | null): void;
  flushBootstrappedAgentUpdates(options?: unknown): void;
  matchesAgentFilter(options: unknown): boolean;
  forwardAgentUpdate(agent: unknown): Promise<void>;

  // Agent selection helpers
  getFocusedAgentSelectionForCwd(
    cwd: string,
  ):
    | { provider?: string | null; model?: string | null; thinkingOptionId?: string | null }
    | undefined;
  readStructuredGenerationDaemonConfig(): StructuredGenerationDaemonConfig;
}

// ---------------------------------------------------------------------------
// Domain E — Chat / Schedule / Loop
// ---------------------------------------------------------------------------

export interface ChatScheduleContext {
  readonly chatService: FileBackedChatService;
  readonly scheduleService: ScheduleService;
  readonly loopService: LoopService;
}

// ---------------------------------------------------------------------------
// Domain F — Terminal / Script
// ---------------------------------------------------------------------------

export interface TerminalScriptContext {
  readonly terminalManager: TerminalManager | null;
  readonly terminalController: TerminalSessionController;
  readonly scriptRouteStore: ScriptRouteStore | null;
  readonly scriptRuntimeStore: WorkspaceScriptRuntimeStore | null;
  readonly getDaemonTcpPort: (() => number | null) | null;
  readonly getDaemonTcpHost: (() => string | null) | null;
  readonly resolveScriptHealth: ((hostname: string) => unknown) | null;
}

// ---------------------------------------------------------------------------
// Domain G — Provider catalog
// ---------------------------------------------------------------------------

export interface ProviderCatalogContext {
  readonly daemonConfigStore: DaemonConfigStore;
  readonly downloadTokenStore: DownloadTokenStore;
  readonly pushTokenStore: PushTokenStore;
  readonly usageStore: UsageStore | null;
  readonly sttLanguage: string;
}

// ---------------------------------------------------------------------------
// Domain H — Config / daemon control
// ---------------------------------------------------------------------------

export interface ConfigControlContext {
  /** Emit a lifecycle intent (restart/shutdown). */
  emitLifecycleIntent(intent: unknown): void;

  readonly serverId: string | undefined;
  readonly daemonVersion: string | undefined;
  readonly daemonRuntimeConfig: DaemonRuntimeConfig | undefined;
  readonly mcpBaseUrl: string | null;
}

// ---------------------------------------------------------------------------
// The full SessionContext — intersection of every domain interface.
// Handlers import this type; the Session class constructs a single object
// satisfying it.  Forward migration: once your handler no longer uses a
// domain, switch it from SessionContext to the relevant sub-interfaces.
// ---------------------------------------------------------------------------

export type SessionContext = SessionIdentityContext &
  WorkspaceProjectContext &
  CheckoutGitContext &
  AgentLifecycleContext &
  ChatScheduleContext &
  TerminalScriptContext &
  ProviderCatalogContext &
  ConfigControlContext &
  GenerativeUiContext;

/** Daemon runtime configuration passed from the process launcher (listen address, relay details). */
export interface DaemonRuntimeConfig {
  listen: string | null;
  relay: {
    enabled: boolean;
    endpoint: string;
    publicEndpoint: string;
    useTls: boolean;
    publicUseTls: boolean;
  } | null;
}

/**
 * A handler that can be disposed. Session.cleanup() calls dispose() on every
 * registered handler so they can release subscriptions and timers.
 */
// ---------------------------------------------------------------------------
// Handler-specific context types
//
// Each handler receives a precise context type that describes exactly what it
// needs.  These are intersections of the domain interfaces above so the
// Session class can still construct a single SessionContext value.
// ---------------------------------------------------------------------------

/** Context needed by CheckoutGitHandler. */
export type CheckoutGitHandlerContext = SessionIdentityContext &
  WorkspaceProjectContext &
  CheckoutGitContext;

/** Context needed by ChatScheduleLoopHandler. */
export type ChatScheduleLoopHandlerContext = SessionIdentityContext &
  ChatScheduleContext &
  Pick<AgentLifecycleContext, "agentManager" | "agentStorage"> &
  Pick<CheckoutGitContext, "resolveAgentIdentifier"> &
  Pick<SessionIdentityContext, "clientId">;

/** Context needed by ConfigControlHandler. */
export type ConfigControlHandlerContext = SessionIdentityContext &
  ConfigControlContext &
  Pick<AgentLifecycleContext, "agentManager"> &
  Pick<ProviderCatalogContext, "daemonConfigStore" | "pushTokenStore"> &
  Pick<ConfigControlContext, "mcpBaseUrl"> &
  Pick<WorkspaceProjectContext, "resolveKnownProjectRootForConfig">;

/** Context needed by ProviderHandler. */
export type ProviderHandlerContext = SessionIdentityContext &
  ProviderCatalogContext &
  Pick<ConfigControlContext, "daemonVersion" | "daemonRuntimeConfig"> &
  Pick<
    AgentLifecycleContext,
    "agentManager" | "agentPresetStore" | "providerSnapshotManager" | "isProviderVisibleToClient"
  > &
  Pick<SessionIdentityContext, "supports">;

/** Context needed by TerminalScriptHandler. */
export type TerminalScriptHandlerContext = SessionIdentityContext &
  TerminalScriptContext &
  Pick<
    WorkspaceProjectContext,
    "workspaceRegistry" | "workspaceGitService" | "emitWorkspaceScriptStatusUpdate"
  >;

/** Context needed by AgentDirectoryHandler. */
export type AgentDirectoryHandlerContext = SessionIdentityContext &
  Pick<
    AgentLifecycleContext,
    | "agentManager"
    | "agentStorage"
    | "providerSnapshotManager"
    | "listAgentPayloads"
    | "getAgentPayloadById"
    | "buildAgentPayload"
    | "buildStoredAgentPayload"
    | "bufferOrEmitAgentUpdate"
    | "getAgentUpdatesSubscription"
    | "setAgentUpdatesSubscription"
    | "flushBootstrappedAgentUpdates"
    | "matchesAgentFilter"
  > &
  Pick<
    WorkspaceProjectContext,
    "workspaceRegistry" | "projectRegistry" | "emitWorkspaceUpdateForCwd"
  > &
  Pick<CheckoutGitContext, "resolveAgentIdentifier"> &
  Pick<AgentLifecycleContext, "buildProjectPlacementForCwd">;

/** Context needed by AgentLifecycleHandler. */
export type AgentLifecycleHandlerContext = SessionIdentityContext &
  Pick<
    AgentLifecycleContext,
    | "agentManager"
    | "agentStorage"
    | "providerSnapshotManager"
    | "createAgentLifecycleDispatch"
    | "buildAgentPayload"
    | "buildStoredAgentPayload"
    | "getAgentPayloadById"
    | "buildAgentSessionConfig"
    | "resolveCreateAgentWorkspace"
    | "readStructuredGenerationDaemonConfig"
    | "buildProjectPlacementForCwd"
  > &
  Pick<
    WorkspaceProjectContext,
    | "workspaceGitService"
    | "findOrCreateWorkspaceForDirectory"
    | "syncWorkspaceGitObserverForWorkspace"
    | "describeWorkspaceRecord"
    | "emitWorkspaceUpdateForCwd"
  > &
  Pick<CheckoutGitContext, "resolveAgentIdentifier"> &
  Pick<ProviderCatalogContext, "daemonConfigStore" | "usageStore"> &
  Pick<TerminalScriptContext, "terminalController">;

/** Context needed by WorkspaceProjectHandler. */
export type WorkspaceProjectHandlerContext = SessionIdentityContext &
  WorkspaceProjectContext &
  CheckoutGitContext &
  Pick<
    AgentLifecycleContext,
    | "agentManager"
    | "agentStorage"
    | "providerSnapshotManager"
    | "getFocusedAgentSelectionForCwd"
    | "readStructuredGenerationDaemonConfig"
  > &
  Pick<ProviderCatalogContext, "downloadTokenStore"> &
  Pick<TerminalScriptContext, "terminalController">;

export interface DisposableHandler {
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Domain I — Generative UI
// ---------------------------------------------------------------------------

export interface GenerativeUiContext {
  agentManager: Pick<AgentManager, "getAgent" | "enqueueGenerativeUiAction">;
}

export type GenerativeUiHandlerContext = SessionIdentityContext & GenerativeUiContext;
