import { randomUUID } from "node:crypto";
import { TTLCache } from "@isaacs/ttlcache";
import pMemoize from "p-memoize";
import { z } from "zod/v3";

import { CLIENT_CAPS, type ClientCapability } from "@chisacode/protocol/client-capabilities";
import {
  type AgentSnapshotPayload,
  type FirstAgentContext,
  type SessionInboundMessage,
  type SessionOutboundMessage,
  type GitSetupOptions,
  type EditorTargetDescriptorPayload,
  type EditorTargetId,
  type ProjectPlacementPayload,
  type WorkspaceSetupSnapshot,
  type WorkspaceDescriptorPayload,
} from "./messages.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import { TerminalSessionController } from "../terminal/terminal-session-controller.js";
import { type TerminalStreamFrame } from "@chisacode/protocol/binary-frames/index";

import type { SpeechToTextProvider, TextToSpeechProvider } from "./speech/speech-provider.js";

import { listAvailableEditorTargets, openInEditorTarget } from "./editor-targets.js";
import { isStoredAgentProviderAvailable } from "./persistence-hooks.js";
import { AgentPresetStore } from "./agent/agent-preset-store.js";
import type { ScriptHealthState } from "./script-health-monitor.js";
import type { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import { type UsageStore } from "./usage/usage-store.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

import { AgentManager } from "./agent/agent-manager.js";
import { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type { ManagedAgent } from "./agent/agent-manager.js";
import { archiveAgentCommand } from "./agent/lifecycle-command.js";
import {
  buildStoredAgentPayload,
  resolveStoredAgentPayloadUpdatedAt,
  toAgentPayload,
} from "./agent/agent-projections.js";
import {
  appendTimelineItemIfAgentKnown,
  emitLiveTimelineItemIfAgentKnown,
} from "./agent/timeline-append.js";
import {
  resolveStructuredGenerationProviders,
  type StructuredGenerationDaemonConfig,
} from "./agent/structured-generation-providers.js";
import { generateStructuredAgentResponseWithFallback } from "./agent/agent-response-loop.js";
import type { GoalCompletionJudge } from "./goal-service.js";
import type { AgentSessionConfig } from "./agent/agent-sdk-types.js";
import type { StoredAgentRecord } from "./agent/agent-storage.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import {
  normalizeWorkspaceId as normalizePersistedWorkspaceId,
  deriveProjectGroupingName,
} from "./workspace-registry-model.js";
import {
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "./workspace-registry.js";
import { DownloadTokenStore } from "./file-download/token-store.js";
import { PushTokenStore } from "./push/token-store.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import type { ScriptRouteStore } from "./script-proxy.js";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { dispatchDshdDesktopRpc } from "./session-handlers/dshd-desktop-rpc-handler.js";

import { type Resolvable } from "./speech/provider-resolver.js";
import type pino from "pino";
import type { FileBackedChatService } from "./chat/chat-service.js";
import { LoopService } from "./loop-service.js";
import { ScheduleService } from "./schedule/service.js";
import { createGitHubService, type GitHubService } from "../services/github-service.js";
import { WorkspaceDirectory } from "./workspace-directory.js";
import {
  createChisaCodeWorktree,
  type CreateChisaCodeWorktreeInput,
  type CreateChisaCodeWorktreeResult,
} from "./chisacode-worktree-service.js";
import {
  buildAgentSessionConfig as buildWorktreeAgentSessionConfig,
  createChisaCodeWorktreeWorkflow as createWorktreeWorkflow,
  type CreateChisaCodeWorktreeSetupContinuationInput,
  type CreateChisaCodeWorktreeWorkflowResult,
} from "./worktree-session.js";
import { CreateAgentLifecycleDispatch } from "./agent/create-agent-lifecycle-dispatch.js";
import {
  resolveKnownProjectRootForConfig,
  type GitMutationRefreshReason,
} from "./session-helpers.js";

// Re-export so existing imports from "./session.js" keep working.
export { resolveWaitForFinishError } from "./session-helpers.js";
export { type SessionRuntimeMetrics } from "./session-internal-types.js";

import {
  type SessionRuntimeMetrics,
  type AgentMcpTransportFactory,
} from "./session-internal-types.js";
import {
  AgentDirectoryHandler,
  AgentLifecycleHandler,
  ChatScheduleLoopHandler,
  CheckoutGitHandler,
  ConfigControlHandler,
  GenerativeUiHandler,
  ProviderHandler,
  TerminalScriptHandler,
  VoiceDictationHandler,
  WorkspaceProjectHandler,
  GoalHandler,
  TeamHandler,
  TeamManager,
  ProjectContextHandler,
  SnapshotHandler,
  MigrationHandler,
  LearnHandler,
  LearnManager,
  type SessionContext,
} from "./session-handlers/index.js";
import { summarizeUntrustedLogIdentifier } from "./log-metadata.js";
import {
  isProviderVisibleToClient as isProviderVisibleToClientFunc,
  filterEditorsForClient as filterEditorsForClientFunc,
  matchesAgentFilter as matchesAgentFilterFunc,
  resolveAgentIdentifier as resolveAgentIdentifierFunc,
  parseClientCapabilities as parseClientCapabilitiesFunc,
  getFocusedAgentSelectionForCwd as getFocusedAgentSelectionForCwdFunc,
  readStructuredGenerationDaemonConfig as readStructuredGenerationDaemonConfigFunc,
  bufferOrEmitAgentUpdate as bufferOrEmitAgentUpdateFunc,
  flushBootstrappedAgentUpdates as flushBootstrappedAgentUpdatesFunc,
  type AgentUpdatePayload,
  type AgentUpdatesSubscriptionState,
  type AgentUpdatesFilter,
} from "./agent-session-helpers.js";
import {
  isPathWithinRoot as isPathWithinRootCore,
  buildWorkspaceScriptPayloadSnapshot as buildWorkspaceScriptPayloadSnapshotCore,
  emitWorkspaceScriptStatusUpdate as emitWorkspaceScriptStatusUpdateCore,
} from "./workspace-core.js";
import { AgentEventForwarder } from "./agent-event-forwarder.js";
import { SessionMcpClientController } from "./session-mcp-client-controller.js";
import { GitMetadataGenerator } from "./git-metadata-generator.js";
import { WorkspaceDescriptorBuilder } from "./workspace-descriptor-builder.js";
import { WorkspaceGitObserverController } from "./workspace-git-observer-controller.js";
import { WorkspaceRecordController } from "./workspace-record-controller.js";
import {
  WorkspaceUpdateController,
  type WorkspaceUpdatesSubscriptionState,
} from "./workspace-update-controller.js";

type FetchWorkspacesResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_workspaces_response" }
>["payload"];
type FetchWorkspacesResponseEntry = FetchWorkspacesResponsePayload["entries"][number];
type FetchWorkspacesResponsePageInfo = FetchWorkspacesResponsePayload["pageInfo"];

const AVAILABLE_EDITOR_TARGETS_CACHE_TTL_MS = 60_000;
const AVAILABLE_EDITOR_TARGETS_CACHE_KEY = "available";

/** Configuration options passed to the Session constructor. */
export interface SessionOptions {
  clientId: string;
  appVersion?: string | null;
  clientCapabilities?: Record<string, unknown> | null;
  onMessage: (msg: SessionOutboundMessage) => void;
  onBinaryMessage?: (frame: Uint8Array) => void;
  onLifecycleIntent?: (intent: SessionLifecycleIntent) => void;
  logger: pino.Logger;
  downloadTokenStore: DownloadTokenStore;
  pushTokenStore: PushTokenStore;
  chisacodeHome: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  usageStore?: UsageStore;
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  chatService: FileBackedChatService;
  scheduleService: ScheduleService;
  loopService: LoopService;
  checkoutDiffManager: CheckoutDiffManager;
  github?: GitHubService;
  createAgentMcpTransport?: AgentMcpTransportFactory;
  workspaceGitService: WorkspaceGitService;
  daemonConfigStore: DaemonConfigStore;
  mcpBaseUrl?: string | null;
  stt: Resolvable<SpeechToTextProvider | null>;
  sttLanguage?: string;
  tts: Resolvable<TextToSpeechProvider | null>;
  terminalManager: TerminalManager | null;
  providerSnapshotManager: ProviderSnapshotManager;
  scriptRouteStore?: ScriptRouteStore;
  scriptRuntimeStore?: WorkspaceScriptRuntimeStore;
  workspaceSetupSnapshots?: Map<string, WorkspaceSetupSnapshot>;
  onBranchChanged?: (
    workspaceId: string,
    oldBranch: string | null,
    newBranch: string | null,
  ) => void;
  getDaemonTcpPort?: () => number | null;
  getDaemonTcpHost?: () => string | null;
  resolveScriptHealth?: (hostname: string) => ScriptHealthState | null;
  serverId?: string;
  daemonVersion?: string;
  daemonRuntimeConfig?: {
    listen: string | null;
    relay: {
      enabled: boolean;
      endpoint: string;
      publicEndpoint: string;
      useTls: boolean;
      publicUseTls: boolean;
    } | null;
  };
}

/** Lifecycle intent emitted by Session when the client requests a shutdown or restart. */
export type SessionLifecycleIntent =
  | {
      type: "shutdown";
      clientId: string;
      requestId: string;
    }
  | {
      type: "restart";
      clientId: string;
      requestId: string;
      reason?: string;
    };

/**
 * Session represents a single connected client session.
 * It owns all state management, orchestration logic, and message processing.
 * Session has no knowledge of WebSockets - it only emits and receives messages.
 */
export class Session {
  private readonly clientId: string;
  private appVersion: string | null;
  private clientCapabilities: ReadonlySet<ClientCapability>;
  private readonly sessionId: string;
  private readonly onMessage: (msg: SessionOutboundMessage) => void;
  private readonly onBinaryMessage: ((frame: Uint8Array) => void) | null;
  private readonly onLifecycleIntent: ((intent: SessionLifecycleIntent) => void) | null;
  private readonly sessionLogger: pino.Logger;
  private readonly chisacodeHome: string;

  // State machine
  private operationAbortController: AbortController;
  private disposed = false;

  private agentManager: AgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly usageStore: UsageStore | null;
  private readonly projectRegistry: ProjectRegistry;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly chatService: FileBackedChatService;
  private readonly scheduleService: ScheduleService;
  private readonly loopService: LoopService;
  private readonly checkoutDiffManager: CheckoutDiffManager;
  private readonly github: GitHubService;
  private readonly workspaceGitService: WorkspaceGitService;
  private readonly daemonConfigStore: DaemonConfigStore;
  private readonly mcpBaseUrl: string | null;
  private readonly downloadTokenStore: DownloadTokenStore;
  private readonly pushTokenStore: PushTokenStore;

  private agentUpdatesSubscription: AgentUpdatesSubscriptionState | null = null;

  private clientActivity: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt: Date;
  } | null = null;
  private readonly terminalManager: TerminalManager | null;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly agentPresetStore: AgentPresetStore;
  private readonly scriptRouteStore: ScriptRouteStore | null;
  private readonly scriptRuntimeStore: WorkspaceScriptRuntimeStore | null;
  private readonly getDaemonTcpPort: (() => number | null) | null;
  private readonly getDaemonTcpHost: (() => string | null) | null;
  private readonly resolveScriptHealth: ((hostname: string) => ScriptHealthState | null) | null;
  private readonly terminalController: TerminalSessionController;
  private inflightRequests = 0;
  private peakInflightRequests = 0;
  /** Agents whose team message queue is currently being drained (re-entrancy guard). */
  private readonly teamQueueFlushInProgress = new Set<string>();
  private readonly availableEditorTargetsCache = new TTLCache<
    string,
    EditorTargetDescriptorPayload[]
  >({
    ttl: AVAILABLE_EDITOR_TARGETS_CACHE_TTL_MS,
    max: 1,
    checkAgeOnGet: true,
  });
  private readonly getMemoizedAvailableEditorTargets = pMemoize(
    async () => this.resolveAvailableEditorTargets(),
    {
      cache: this.availableEditorTargetsCache,
      cacheKey: () => AVAILABLE_EDITOR_TARGETS_CACHE_KEY,
    },
  );
  private readonly workspaceSetupSnapshots: Map<string, WorkspaceSetupSnapshot>;
  private readonly gitMetadataGenerator: GitMetadataGenerator;
  private readonly workspaceDescriptorBuilder: WorkspaceDescriptorBuilder;
  private readonly workspaceDirectory: WorkspaceDirectory;
  private readonly workspaceGitObserverController: WorkspaceGitObserverController;
  private readonly workspaceRecordController: WorkspaceRecordController;
  private readonly workspaceUpdateController: WorkspaceUpdateController;
  private readonly sttLanguage: string;
  private readonly serverId: string | undefined;
  private readonly daemonVersion: string | undefined;
  private readonly daemonRuntimeConfig: SessionOptions["daemonRuntimeConfig"];
  private readonly createAgentLifecycleDispatch: CreateAgentLifecycleDispatch;
  private readonly agentEventForwarder: AgentEventForwarder;
  private readonly sessionMcpClientController: SessionMcpClientController;
  private readonly checkoutGitHandler: CheckoutGitHandler;
  private readonly chatScheduleLoopHandler: ChatScheduleLoopHandler;
  private readonly configControlHandler: ConfigControlHandler;
  private readonly providerHandler: ProviderHandler;
  private readonly terminalScriptHandler: TerminalScriptHandler;
  private readonly workspaceProjectHandler: WorkspaceProjectHandler;
  private readonly agentDirectoryHandler: AgentDirectoryHandler;
  private readonly agentLifecycleHandler: AgentLifecycleHandler;
  private readonly generativeUiHandler: GenerativeUiHandler;
  private readonly voiceDictationHandler: VoiceDictationHandler;
  private readonly goalHandler: GoalHandler;
  private readonly teamHandler: TeamHandler;
  private readonly projectContextHandler: ProjectContextHandler;
  private readonly snapshotHandler: SnapshotHandler;
  private readonly migrationHandler: MigrationHandler;
  private readonly learnHandler: LearnHandler;

  constructor(options: SessionOptions) {
    const {
      clientId,
      appVersion,
      clientCapabilities,
      onMessage,
      onBinaryMessage,
      onLifecycleIntent,
      logger,
      downloadTokenStore,
      pushTokenStore,
      chisacodeHome,
      agentManager,
      agentStorage,
      usageStore,
      projectRegistry,
      workspaceRegistry,
      chatService,
      scheduleService,
      loopService,
      checkoutDiffManager,
      github,
      workspaceGitService,
      daemonConfigStore,
      mcpBaseUrl,
      stt,
      sttLanguage,
      terminalManager,
      providerSnapshotManager,
      scriptRouteStore,
      scriptRuntimeStore,
      workspaceSetupSnapshots,
      onBranchChanged,
      getDaemonTcpPort,
      getDaemonTcpHost,
      resolveScriptHealth,
      serverId,
      daemonVersion,
      daemonRuntimeConfig,
    } = options;
    this.clientId = clientId;
    this.appVersion = appVersion ?? null;
    this.clientCapabilities = parseClientCapabilitiesFunc(clientCapabilities);
    this.sessionId = randomUUID();
    this.onMessage = onMessage;
    this.onBinaryMessage = onBinaryMessage ?? null;
    this.onLifecycleIntent = onLifecycleIntent ?? null;
    this.downloadTokenStore = downloadTokenStore;
    this.pushTokenStore = pushTokenStore;
    this.chisacodeHome = chisacodeHome;
    this.sessionLogger = logger.child({
      module: "session",
      clientId: this.clientId,
      sessionId: this.sessionId,
    });
    this.agentManager = agentManager;
    this.agentStorage = agentStorage;
    this.usageStore = usageStore ?? null;
    this.projectRegistry = projectRegistry;
    this.workspaceRegistry = workspaceRegistry;
    this.chatService = chatService;
    this.scheduleService = scheduleService;
    this.loopService = loopService;
    this.checkoutDiffManager = checkoutDiffManager;
    this.github = github ?? createGitHubService();
    this.workspaceGitService = workspaceGitService;
    this.daemonConfigStore = daemonConfigStore;
    this.mcpBaseUrl = mcpBaseUrl ?? null;
    this.terminalManager = terminalManager;
    this.agentPresetStore = new AgentPresetStore({
      chisacodeHome: this.chisacodeHome,
      logger: this.sessionLogger,
    });
    this.terminalController = new TerminalSessionController({
      terminalManager,
      emit: (msg) => this.emit(msg),
      emitBinary: (frame) => this.emitBinary(frame),
      hasBinaryChannel: () => this.onBinaryMessage !== null,
      isPathWithinRoot: (rootPath, candidatePath) => this.isPathWithinRoot(rootPath, candidatePath),
      sessionLogger: this.sessionLogger,
    });
    this.createAgentLifecycleDispatch = new CreateAgentLifecycleDispatch({
      chisacodeHome: this.chisacodeHome,
      agentManager: this.agentManager,
      agentStorage: this.agentStorage,
      github: this.github,
      workspaceGitService: this.workspaceGitService,
      createChisaCodeWorktreeWorkflow: (input, workflowOptions) =>
        this.createChisaCodeWorktreeWorkflow(input, workflowOptions),
      archiveAgentForClose: (agentId) => this.archiveAgentForClose(agentId),
      archiveWorkspaceRecord: (workspaceId) => this.archiveWorkspaceRecord(workspaceId),
      emit: (message) => this.emit(message),
      emitAgentRemove: (agentId) => this.agentDirectoryHandler.publishAgentRemoval(agentId),
      emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds) =>
        this.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds),
      markWorkspaceArchiving: (workspaceIds, archivingAt) =>
        this.markWorkspaceArchiving(workspaceIds, archivingAt),
      clearWorkspaceArchiving: (workspaceIds) => this.clearWorkspaceArchiving(workspaceIds),
      isPathWithinRoot: (rootPath, candidatePath) => this.isPathWithinRoot(rootPath, candidatePath),
      killTerminalsUnderPath: (rootPath) =>
        this.terminalController.killTerminalsUnderPath(rootPath),
      logger: this.sessionLogger,
    });
    this.providerSnapshotManager = providerSnapshotManager;
    this.scriptRouteStore = scriptRouteStore ?? null;
    this.scriptRuntimeStore = scriptRuntimeStore ?? null;
    this.workspaceSetupSnapshots = workspaceSetupSnapshots ?? new Map();
    this.getDaemonTcpPort = getDaemonTcpPort ?? null;
    this.getDaemonTcpHost = getDaemonTcpHost ?? null;
    this.resolveScriptHealth = resolveScriptHealth ?? null;
    this.sttLanguage = sttLanguage ?? "en";
    this.voiceDictationHandler = new VoiceDictationHandler({
      sessionId: this.sessionId,
      sessionLogger: this.sessionLogger,
      stt,
      sttLanguage: this.sttLanguage,
      emit: (message) => this.emit(message),
    });
    this.serverId = serverId;
    this.daemonVersion = daemonVersion;
    this.daemonRuntimeConfig = daemonRuntimeConfig;
    this.operationAbortController = new AbortController();
    this.sessionMcpClientController = new SessionMcpClientController({
      mcpBaseUrl: this.mcpBaseUrl,
      sessionLogger: this.sessionLogger,
    });
    this.gitMetadataGenerator = new GitMetadataGenerator({
      agentManager: this.agentManager,
      workspaceGitService: this.workspaceGitService,
      providerSnapshotManager: this.providerSnapshotManager,
      readDaemonConfig: () => this.readStructuredGenerationDaemonConfig(),
      getCurrentSelection: (cwd) => this.getFocusedAgentSelectionForCwd(cwd),
    });
    // LLM judge that lets the goal continuation loop stop when the objective is met.
    this.agentManager.setGoalCompletionJudge(this.buildGoalCompletionJudge());
    this.workspaceGitObserverController = new WorkspaceGitObserverController({
      workspaceGitService: this.workspaceGitService,
      sessionLogger: this.sessionLogger,
      emit: (message) => this.emit(message),
      emitWorkspaceUpdateForCwd: (cwd) => this.emitWorkspaceUpdateForCwd(cwd),
      onBranchChanged,
    });
    this.workspaceDescriptorBuilder = new WorkspaceDescriptorBuilder({
      projectRegistry: this.projectRegistry,
      workspaceGitService: this.workspaceGitService,
      buildWorkspaceScriptPayloadSnapshot: (workspaceId, workspaceDirectory) =>
        this.buildWorkspaceScriptPayloadSnapshot(workspaceId, workspaceDirectory),
    });
    this.workspaceDirectory = new WorkspaceDirectory({
      logger: this.sessionLogger,
      projectRegistry: this.projectRegistry,
      workspaceRegistry: this.workspaceRegistry,
      listAgentPayloads: () => this.listAgentPayloads(),
      isProviderVisibleToClient: (provider) => this.isProviderVisibleToClient(provider),
      buildWorkspaceDescriptor: (input) => this.buildWorkspaceDescriptor(input),
    });
    this.workspaceRecordController = new WorkspaceRecordController({
      projectRegistry: this.projectRegistry,
      workspaceRegistry: this.workspaceRegistry,
      workspaceGitService: this.workspaceGitService,
      resolveRegisteredWorkspaceIdForCwd: (cwd, workspaces) =>
        this.resolveRegisteredWorkspaceIdForCwd(cwd, workspaces),
      removeWorkspaceGitSubscription: (cwd) => this.removeWorkspaceGitSubscription(cwd),
      removeWorkspaceScriptRuntime: (cwd) => this.scriptRuntimeStore?.removeForWorkspace(cwd),
    });
    this.workspaceUpdateController = new WorkspaceUpdateController({
      sessionLogger: this.sessionLogger,
      emit: (message) => this.emit(message),
      buildDescriptorMap: (descriptorOptions) =>
        this.buildWorkspaceDescriptorMap(descriptorOptions),
      listWorkspaceRecords: () => this.workspaceRegistry.list(),
      resolveWorkspaceIdForCwd: (cwd, workspaces) =>
        this.resolveRegisteredWorkspaceIdForCwd(cwd, workspaces),
      matchesFilter: (input) => this.workspaceDirectory.matchesFilter(input),
      shouldSkipGitState: (workspaceId, workspace) =>
        this.shouldSkipWorkspaceGitWatchUpdate(workspaceId, workspace),
      recordGitState: (workspaceId, workspace) =>
        this.rememberWorkspaceGitDescriptorState(workspaceId, workspace),
      reconcileWorkspaceRecords: () => this.reconcileActiveWorkspaceRecords(),
    });

    // Initialize handlers with a shared SessionContext facade.
    const sessionContext = this.createSessionContext();
    this.checkoutGitHandler = new CheckoutGitHandler(sessionContext);
    this.chatScheduleLoopHandler = new ChatScheduleLoopHandler(sessionContext);
    this.configControlHandler = new ConfigControlHandler(sessionContext);
    this.providerHandler = new ProviderHandler(sessionContext);
    this.providerHandler.start();
    this.terminalScriptHandler = new TerminalScriptHandler(sessionContext);
    this.workspaceProjectHandler = new WorkspaceProjectHandler(sessionContext);
    this.agentDirectoryHandler = new AgentDirectoryHandler(sessionContext);
    this.agentLifecycleHandler = new AgentLifecycleHandler(
      sessionContext,
      this.agentDirectoryHandler,
    );
    this.generativeUiHandler = new GenerativeUiHandler(sessionContext);

    // Cindy-module handlers (goal, team, context, snapshot, migration, learn).
    this.goalHandler = new GoalHandler({
      sessionLogger: this.sessionLogger,
      goalStore: this.agentManager,
      emit: (message) => this.emit(message as SessionOutboundMessage),
    });
    const teamManager = new TeamManager();
    this.teamHandler = new TeamHandler({
      sessionLogger: this.sessionLogger,
      teamManager,
      sessionId: this.sessionId,
      emit: (message) => this.emit(message as SessionOutboundMessage),
      spawnWorker: async (workerOptions) => {
        // Resolve cwd from the lead agent (first available agent) instead of process.cwd()
        const resolvedCwd =
          this.agentManager.listAgents().find((a) => a.lifecycle !== "closed")?.cwd ??
          workerOptions.cwd;
        const agent = await this.agentManager.createAgent(
          {
            provider: (workerOptions.provider ?? "claude") as never,
            model: workerOptions.model ?? undefined,
            cwd: resolvedCwd,
          },
          undefined,
          {
            labels: {
              "chisacode/team-role": workerOptions.role,
              "chisacode/team-label": workerOptions.label,
            },
            initialPrompt: workerOptions.initialPrompt,
          },
        );
        return agent.id;
      },
      sendToAgent: (agentId, message) => this.deliverToTeamAgent(agentId, message),
      terminateWorker: async (agentId) => {
        // Stop any in-flight run, then close the agent session so the spawned
        // worker process (Claude/Codex CLI) is reaped instead of outliving the team.
        try {
          await this.agentManager.cancelAgentRun(agentId);
        } catch {
          // Agent may already be idle/closed; cancel is best-effort.
        }
        await this.agentManager.closeAgent(agentId);
      },
    });
    this.projectContextHandler = new ProjectContextHandler({
      sessionLogger: this.sessionLogger,
      chisacodeHome: this.chisacodeHome,
      emit: (message) => this.emit(message as SessionOutboundMessage),
    });
    this.snapshotHandler = new SnapshotHandler({
      sessionLogger: this.sessionLogger,
      emit: (message) => this.emit(message as SessionOutboundMessage),
    });
    this.migrationHandler = new MigrationHandler({
      sessionLogger: this.sessionLogger,
      emit: (message) => this.emit(message as SessionOutboundMessage),
    });
    const learnManager = new LearnManager();
    this.learnHandler = new LearnHandler({
      sessionLogger: this.sessionLogger,
      learnManager,
      emit: (message) => this.emit(message as SessionOutboundMessage),
      distill: async ({ diff, files, context }) => {
        const prompt = [
          "You are a skill extraction agent. Analyze the following code changes and extract reusable rules or skills.",
          "Return a JSON array of proposals, each with: filename (suggested .md filename), content (markdown with frontmatter), fingerprint (short hash).",
          "",
          `Files changed: ${files.join(", ")}`,
          context ? `Context: ${context}` : "",
          "",
          "```diff",
          diff,
          "```",
          "",
          "Respond with ONLY the JSON array, no other text.",
        ]
          .filter(Boolean)
          .join("\n");
        const resolvedCwd =
          this.agentManager.listAgents().find((a) => a.lifecycle !== "closed")?.cwd ??
          process.cwd();
        const agent = await this.agentManager.createAgent(
          { provider: "claude" as never, cwd: resolvedCwd },
          undefined,
          { labels: { "chisacode/learn": "distill" } },
        );
        // Run the prompt once and extract proposals from the agent's output.
        const events = this.agentManager.streamAgent(agent.id, prompt);
        let lastText = "";
        for await (const event of events) {
          if (event.type === "timeline" && event.item.type === "assistant_message") {
            lastText = event.item.text;
          }
        }
        try {
          const jsonMatch = lastText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed: unknown = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
              return parsed.filter(
                (item): item is { filename: string; content: string; fingerprint: string } =>
                  typeof item === "object" &&
                  item !== null &&
                  typeof (item as Record<string, unknown>).filename === "string" &&
                  typeof (item as Record<string, unknown>).content === "string" &&
                  typeof (item as Record<string, unknown>).fingerprint === "string",
              );
            }
          }
        } catch {
          // Fall through to empty proposals
        }
        return [];
      },
    });

    this.agentEventForwarder = new AgentEventForwarder({
      agentManager: this.agentManager,
      sessionLogger: this.sessionLogger,
      supports: (capability) => this.supports(capability as ClientCapability),
      forwardAgentUpdate: (agent) => this.forwardAgentUpdate(agent),
      emit: (message) => this.emit(message),
    });

    // Initialize asynchronous collaborators only after their handlers exist.
    void this.sessionMcpClientController.start();
    this.agentEventForwarder.start();

    this.sessionLogger.trace({}, "agent.session.lifecycle.created");
  }

  private createSessionContext(): SessionContext {
    return {
      clientId: this.clientId,
      sessionId: this.sessionId,
      sessionLogger: this.sessionLogger,
      chisacodeHome: this.chisacodeHome,
      appVersion: this.appVersion,
      agentManager: this.agentManager,
      agentStorage: this.agentStorage,
      daemonConfigStore: this.daemonConfigStore,
      projectRegistry: this.projectRegistry,
      providerSnapshotManager: this.providerSnapshotManager,
      workspaceGitService: this.workspaceGitService,
      github: this.github,
      checkoutDiffManager: this.checkoutDiffManager,
      getOperationAbortSignal: () => this.operationAbortController.signal,
      chatService: this.chatService,
      scheduleService: this.scheduleService,
      loopService: this.loopService,
      agentPresetStore: this.agentPresetStore,
      terminalManager: this.terminalManager,
      terminalController: this.terminalController,
      scriptRouteStore: this.scriptRouteStore,
      scriptRuntimeStore: this.scriptRuntimeStore,
      workspaceRegistry: this.workspaceRegistry,
      getDaemonTcpPort: this.getDaemonTcpPort,
      getDaemonTcpHost: this.getDaemonTcpHost,
      resolveScriptHealth: this.resolveScriptHealth,
      emit: (message) => this.emit(message as SessionOutboundMessage),
      notifyGitMutation: (cwd, reason, opts) => this.notifyGitMutation(cwd, reason, opts),
      emitWorkspaceUpdateForCwd: (cwd) => this.emitWorkspaceUpdateForCwd(cwd),
      emitWorkspaceUpdateForWorkspaceId: (workspaceId) =>
        this.emitWorkspaceUpdateForWorkspaceId(workspaceId),
      emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds, options) =>
        this.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds, options),
      handleWorkspaceGitBranchSnapshot: (cwd, branchName) =>
        this.handleWorkspaceGitBranchSnapshot(cwd, branchName),
      generateCommitMessage: (cwd) => this.generateCommitMessage(cwd),
      generatePullRequestText: (cwd, baseRef) => this.generatePullRequestText(cwd, baseRef),
      resolveAgentIdentifier: (identifier) => this.resolveAgentIdentifier(identifier),
      supports: (capability) => this.supports(capability as ClientCapability),
      emitWorkspaceScriptStatusUpdate: (workspaceId, workspaceDirectory) =>
        this.emitWorkspaceScriptStatusUpdate(workspaceId, workspaceDirectory),
      // New handlers (Config / Workspace / AgentLifecycle)
      emitLifecycleIntent: (intent) => this.emitLifecycleIntent(intent as SessionLifecycleIntent),
      bufferOrEmitAgentUpdate: (subscription, payload) =>
        this.bufferOrEmitAgentUpdate(
          subscription as AgentUpdatesSubscriptionState,
          payload as AgentUpdatePayload,
        ),
      startWorkspaceUpdatesSubscription: (subscriptionId, filter) =>
        this.workspaceUpdateController.startSubscription(subscriptionId, filter),
      completeWorkspaceUpdatesBootstrap: (subscriptionId, entries) =>
        this.workspaceUpdateController.completeBootstrap(subscriptionId, entries),
      cancelWorkspaceUpdatesSubscription: (subscriptionId) =>
        this.workspaceUpdateController.cancelSubscription(subscriptionId),
      getAgentUpdatesSubscription: () => this.agentUpdatesSubscription,
      setAgentUpdatesSubscription: (subscription) => {
        this.agentUpdatesSubscription = subscription as AgentUpdatesSubscriptionState | null;
      },
      flushBootstrappedAgentUpdates: (options) =>
        this.flushBootstrappedAgentUpdates(
          options as Parameters<typeof this.flushBootstrappedAgentUpdates>[0],
        ),
      matchesAgentFilter: (options) =>
        this.matchesAgentFilter(options as Parameters<typeof this.matchesAgentFilter>[0]),
      forwardAgentUpdate: (agent) =>
        this.forwardAgentUpdate(agent as Parameters<typeof this.forwardAgentUpdate>[0]),
      buildStoredAgentPayload: (record) =>
        this.buildStoredAgentPayload(record as Parameters<typeof this.buildStoredAgentPayload>[0]),
      buildProjectPlacementForCwd: (cwd, options) => this.buildProjectPlacementForCwd(cwd, options),
      buildAgentSessionConfig: (config, gitOptions, legacyWorktreeName, firstAgentContext) =>
        this.buildAgentSessionConfig(
          config as Parameters<typeof this.buildAgentSessionConfig>[0],
          gitOptions as Parameters<typeof this.buildAgentSessionConfig>[1],
          legacyWorktreeName as Parameters<typeof this.buildAgentSessionConfig>[2],
          firstAgentContext as Parameters<typeof this.buildAgentSessionConfig>[3],
        ),
      resolveCreateAgentWorkspace: (cwd, workspaceId) =>
        this.resolveCreateAgentWorkspace(
          cwd as Parameters<typeof this.resolveCreateAgentWorkspace>[0],
          workspaceId as Parameters<typeof this.resolveCreateAgentWorkspace>[1],
        ),
      createAgentLifecycleDispatch: this.createAgentLifecycleDispatch,
      listAgentPayloads: (filter) =>
        this.listAgentPayloads(filter as Parameters<typeof this.listAgentPayloads>[0]),
      getAgentPayloadById: (agentId) => this.getAgentPayloadById(agentId),
      buildAgentPayload: (agent) =>
        this.buildAgentPayload(agent as Parameters<typeof this.buildAgentPayload>[0]),
      isProviderVisibleToClient: (provider) => this.isProviderVisibleToClient(provider),
      buildWorkspaceDescriptor: (input) =>
        this.buildWorkspaceDescriptor(input as Parameters<typeof this.buildWorkspaceDescriptor>[0]),
      downloadTokenStore: this.downloadTokenStore,
      pushTokenStore: this.pushTokenStore,
      usageStore: this.usageStore,
      workspaceSetupSnapshots: this.workspaceSetupSnapshots,
      sttLanguage: this.sttLanguage,
      resolveKnownProjectRootForConfig: (repoRoot) =>
        resolveKnownProjectRootForConfig({
          repoRoot,
          projectRegistry: this.projectRegistry,
        }),
      // WorkspaceProjectHandler additions
      listFetchWorkspacesEntries: (
        request: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>,
      ) => this.listFetchWorkspacesEntries(request),
      syncWorkspaceGitObservers: (workspaces) => this.syncWorkspaceGitObservers(workspaces),
      syncWorkspaceGitObserverForWorkspace: (workspace) =>
        this.syncWorkspaceGitObserverForWorkspace(workspace),
      findOrCreateWorkspaceForDirectory: (cwd) => this.findOrCreateWorkspaceForDirectory(cwd),
      describeWorkspaceRecord: (workspace, projectRecord) =>
        this.describeWorkspaceRecord(workspace, projectRecord),
      describeCreatedWorktreeWorkspace: (result) => this.describeCreatedWorktreeWorkspace(result),
      createChisaCodeWorktreeWorkflow: (input, options) =>
        this.createChisaCodeWorktreeWorkflow(input, options),
      archiveWorkspaceRecord: (workspaceId, archivedAt) =>
        this.archiveWorkspaceRecord(workspaceId, archivedAt),
      markWorkspaceArchiving: (workspaceIds, archivingAt) =>
        this.markWorkspaceArchiving(workspaceIds, archivingAt),
      clearWorkspaceArchiving: (workspaceIds) => this.clearWorkspaceArchiving(workspaceIds),
      isPathWithinRoot: (rootPath, candidatePath) => this.isPathWithinRoot(rootPath, candidatePath),
      getAvailableEditorTargets: () => this.getAvailableEditorTargets(),
      openEditorTarget: (options) => this.openEditorTarget(options),
      hasBinaryChannel: () => this.onBinaryMessage !== null,
      emitBinary: (frame) => this.emitBinary(frame),

      // Agent selection helpers for workspace auto-name
      getFocusedAgentSelectionForCwd: (cwd) => this.getFocusedAgentSelectionForCwd(cwd),
      readStructuredGenerationDaemonConfig: () => this.readStructuredGenerationDaemonConfig(),

      serverId: this.serverId,
      daemonVersion: this.daemonVersion,
      daemonRuntimeConfig: this.daemonRuntimeConfig,
      mcpBaseUrl: this.mcpBaseUrl,

      // GenerativeUiContext uses the manager-owned queue shared by every session.
    };
  }

  /** Update the connected client's app version. */
  updateAppVersion(appVersion: string | null): void {
    if (appVersion && appVersion !== this.appVersion) {
      this.appVersion = appVersion;
    }
  }

  /** Update the connected client's capability flags. */
  updateClientCapabilities(capabilities: Record<string, unknown> | null): void {
    this.clientCapabilities = parseClientCapabilitiesFunc(capabilities);
  }

  /** Check whether the connected client supports a given capability. */
  supports(capability: ClientCapability): boolean {
    return this.clientCapabilities.has(capability);
  }

  async syncWorkspaceGitObserverForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void> {
    const descriptor = await this.describeWorkspaceRecordWithGitData(workspace);
    this.syncWorkspaceGitObservers([descriptor]);
  }

  async emitWorkspaceUpdateForWorkspaceId(workspaceId: string): Promise<void> {
    await this.emitWorkspaceUpdatesForWorkspaceIds([workspaceId], { skipReconcile: true });
  }

  async archiveWorkspaceRecordForExternalMutation(workspaceId: string): Promise<void> {
    await this.archiveWorkspaceRecord(workspaceId);
  }

  markWorkspaceArchivingForExternalMutation(
    workspaceIds: Iterable<string>,
    archivingAt: string,
  ): void {
    this.markWorkspaceArchiving(workspaceIds, archivingAt);
  }

  clearWorkspaceArchivingForExternalMutation(workspaceIds: Iterable<string>): void {
    this.clearWorkspaceArchiving(workspaceIds);
  }

  async emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void> {
    await this.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds);
  }

  async emitWorkspaceUpdatesForExternalCwds(cwds: Iterable<string>): Promise<void> {
    await Promise.all(Array.from(cwds, (cwd) => this.emitWorkspaceUpdateForCwd(cwd)));
  }

  async warmWorkspaceGitDataForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void> {
    await this.syncWorkspaceGitObserverForWorkspace(workspace);
    await this.emitWorkspaceUpdateForWorkspaceId(workspace.workspaceId);
  }

  /**
   * Get the client's current activity state
   */
  /** Get the current client activity state (device type, focused agent, visibility). */
  public getClientActivity(): {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt: Date;
  } | null {
    return this.clientActivity;
  }

  private getFocusedAgentSelectionForCwd(cwd: string):
    | {
        provider?: string | null;
        model?: string | null;
        thinkingOptionId?: string | null;
      }
    | undefined {
    return getFocusedAgentSelectionForCwdFunc(cwd, {
      clientActivity: this.clientActivity,
      agentManager: this.agentManager,
    });
  }

  private readStructuredGenerationDaemonConfig(): StructuredGenerationDaemonConfig {
    return readStructuredGenerationDaemonConfigFunc(this.daemonConfigStore);
  }

  /** Max chars of the agent's recent output fed to the goal completion judge. */
  private static readonly GOAL_JUDGE_OUTPUT_BUDGET = 8000;

  /**
   * Build the goal completion judge. Uses the shared structured-generation
   * policy (same path as commit-message / PR generation) to ask whether the
   * objective is met. Returns `null` on any failure so the continuation loop
   * falls back to its guardrails instead of stalling.
   */
  private buildGoalCompletionJudge(): GoalCompletionJudge {
    return async ({ agentId, objective, recentOutput }) => {
      const cwd = this.agentManager.getAgent(agentId)?.cwd;
      if (!cwd) return null;
      const boundedOutput =
        recentOutput.length > Session.GOAL_JUDGE_OUTPUT_BUDGET
          ? `${recentOutput.slice(-Session.GOAL_JUDGE_OUTPUT_BUDGET)}`
          : recentOutput;
      const prompt = [
        "You are judging whether an AI coding agent has fully met its objective.",
        `Objective: ${objective}`,
        "",
        "The agent's most recent output:",
        boundedOutput.length > 0 ? boundedOutput : "(no output)",
        "",
        "Based only on this, decide whether the objective is completely satisfied.",
        'Return JSON only: { "complete": boolean, "reason": string }.',
      ].join("\n");
      try {
        return await generateStructuredAgentResponseWithFallback({
          manager: this.agentManager,
          cwd,
          prompt,
          schema: z.object({ complete: z.boolean(), reason: z.string() }),
          schemaName: "GoalCompletion",
          maxRetries: 2,
          providers: await resolveStructuredGenerationProviders({
            cwd,
            providerSnapshotManager: this.providerSnapshotManager,
            daemonConfig: this.readStructuredGenerationDaemonConfig(),
            currentSelection: this.getFocusedAgentSelectionForCwd(cwd),
          }),
          persistSession: false,
          agentConfigOverrides: { title: "Goal judge", internal: true },
        });
      } catch {
        return null;
      }
    };
  }

  /** Get current runtime metrics (inflight requests, peak, subscriptions). */
  public getRuntimeMetrics(): SessionRuntimeMetrics {
    const terminalMetrics = this.terminalController.getMetrics();
    return {
      terminalDirectorySubscriptionCount: terminalMetrics.directorySubscriptionCount,
      terminalSubscriptionCount: terminalMetrics.streamSubscriptionCount,
      inflightRequests: this.inflightRequests,
      peakInflightRequests: this.peakInflightRequests,
    };
  }

  /** Emit a server-originated message to the client (used by external systems). */
  public emitServerMessage(message: SessionOutboundMessage): void {
    this.emit(message);
  }

  /**
   * Send initial state to client after connection
   */
  /** Send the initial state payload to the newly connected client. */
  public async sendInitialState(): Promise<void> {
    // No unsolicited agent list hydration. Callers must use fetch_agents_request.
  }

  private async buildAgentPayload(agent: ManagedAgent): Promise<AgentSnapshotPayload> {
    const storedRecord = await this.agentStorage.get(agent.id);
    const title = storedRecord?.title ?? null;
    const payload = toAgentPayload(agent, { title });
    const storedUpdatedAt = storedRecord ? resolveStoredAgentPayloadUpdatedAt(storedRecord) : null;
    if (storedUpdatedAt) {
      const liveUpdatedAt = Date.parse(payload.updatedAt);
      const persistedUpdatedAt = Date.parse(storedUpdatedAt);
      if (Number.isNaN(liveUpdatedAt) || persistedUpdatedAt > liveUpdatedAt) {
        payload.updatedAt = storedUpdatedAt;
      }
    }
    payload.archivedAt = storedRecord?.archivedAt ?? null;
    return payload;
  }

  private buildStoredAgentPayload(
    record: StoredAgentRecord,
    registeredProviderIds = this.providerSnapshotManager.listRegisteredProviderIds(),
  ): AgentSnapshotPayload {
    return buildStoredAgentPayload(record, registeredProviderIds);
  }

  private isProviderVisibleToClient(provider: string): boolean {
    return isProviderVisibleToClientFunc(provider, this.appVersion);
  }

  private filterEditorsForClient(
    editors: EditorTargetDescriptorPayload[],
  ): EditorTargetDescriptorPayload[] {
    return filterEditorsForClientFunc(editors, this.appVersion);
  }

  private matchesAgentFilter(options: {
    agent: AgentSnapshotPayload;
    project: ProjectPlacementPayload;
    filter?: AgentUpdatesFilter;
  }): boolean {
    return matchesAgentFilterFunc(options);
  }

  private bufferOrEmitAgentUpdate(
    subscription: AgentUpdatesSubscriptionState,
    payload: AgentUpdatePayload,
  ): void {
    return bufferOrEmitAgentUpdateFunc(subscription, payload, {
      isProviderVisibleToClient: (provider) => this.isProviderVisibleToClient(provider),
      emit: (msg) => this.emit(msg),
    });
  }

  private flushBootstrappedAgentUpdates(options?: {
    snapshotUpdatedAtByAgentId?: Map<string, number>;
  }): void {
    return flushBootstrappedAgentUpdatesFunc(
      {
        isProviderVisibleToClient: (provider) => this.isProviderVisibleToClient(provider),
        emit: (msg) => this.emit(msg),
        getAgentUpdatesSubscription: () => this.agentUpdatesSubscription,
      },
      options,
    );
  }

  private async findWorkspaceByDirectory(
    cwd: string,
    options?: { refreshGit?: boolean },
  ): Promise<PersistedWorkspaceRecord | null> {
    return this.workspaceRecordController.findWorkspaceByDirectory(cwd, options);
  }
  private async buildProjectPlacementForWorkspace(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<ProjectPlacementPayload> {
    return this.workspaceDescriptorBuilder.buildProjectPlacementForWorkspace(
      workspace,
      projectRecord,
    );
  }

  private async buildProjectPlacementForCwd(
    cwd: string,
    options?: { refreshGit?: boolean; fallback?: boolean },
  ): Promise<ProjectPlacementPayload | null> {
    const workspace = await this.findWorkspaceByDirectory(cwd, {
      refreshGit: options?.refreshGit,
    });
    if (!workspace) {
      if (!options?.fallback) {
        return null;
      }

      const normalizedCwd = normalizePersistedWorkspaceId(cwd);
      return {
        projectKey: normalizedCwd,
        projectName: deriveProjectGroupingName(normalizedCwd),
        checkout: {
          cwd: normalizedCwd,
          isGit: false,
          currentBranch: null,
          remoteUrl: null,
          worktreeRoot: null,
          isChisaCodeOwnedWorktree: false,
          mainRepoRoot: null,
        },
      };
    }
    return this.buildProjectPlacementForWorkspace(workspace);
  }

  private async forwardAgentUpdate(agent: ManagedAgent): Promise<void> {
    await this.agentDirectoryHandler.publishAgentUpdate(agent);
    // When a team worker agent goes idle, deliver any buffered lead messages.
    if (agent.lifecycle === "idle") {
      this.drainTeamWorkerQueue(agent.id);
    }
  }

  /** Send a message to a team worker agent, draining its foreground stream. */
  private async deliverToTeamAgent(agentId: string, message: string): Promise<void> {
    const events = this.agentManager.streamAgent(agentId, message);
    for await (const _event of events) {
      // Drain — events are dispatched internally
    }
  }

  /** Fire-and-forget drain of a team worker's queued messages when it goes idle. */
  private drainTeamWorkerQueue(agentId: string): void {
    if (this.teamQueueFlushInProgress.has(agentId)) return;
    this.teamQueueFlushInProgress.add(agentId);
    void this.teamHandler
      .flushWorkerQueueByAgent(agentId, (content) => this.deliverToTeamAgent(agentId, content))
      .catch((error) => {
        this.sessionLogger.warn({ err: error, agentId }, "Team queue drain failed");
      })
      .finally(() => {
        this.teamQueueFlushInProgress.delete(agentId);
      });
  }
  /**
   * Main entry point for processing session messages
   */
  /**
   * Handle an inbound message from the client.
   * Tracks inflight request count and dispatches to the appropriate handler.
   */
  public async handleMessage(msg: SessionInboundMessage): Promise<void> {
    this.inflightRequests++;
    if (this.inflightRequests > this.peakInflightRequests) {
      this.peakInflightRequests = this.inflightRequests;
    }
    try {
      this.sessionLogger.trace(
        {
          messageType: msg.type,
          payloadBytes: JSON.stringify(msg).length,
        },
        "agent.session.inbound",
      );
      try {
        await this.dispatchInboundMessage(msg);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sessionLogger.error(
          {
            requestType: msg.type,
            requestId:
              "requestId" in msg && typeof msg.requestId === "string"
                ? summarizeUntrustedLogIdentifier(msg.requestId)
                : undefined,
            category: "handler",
            code: "handler_error",
          },
          "Error handling message",
        );

        const requestId =
          "requestId" in msg && typeof msg.requestId === "string" ? msg.requestId : undefined;
        if (typeof requestId === "string") {
          try {
            this.emit({
              type: "rpc_error",
              payload: {
                requestId,
                requestType: msg.type,
                error: `Request failed: ${err.message}`,
                code: "handler_error",
              },
            });
          } catch (emitError) {
            this.sessionLogger.error({ err: emitError }, "Failed to emit rpc_error");
          }
        }

        this.emit({
          type: "activity_log",
          payload: {
            id: randomUUID(),
            timestamp: new Date(),
            type: "error",
            content: `Error: ${err.message}`,
          },
        });
      }
    } finally {
      this.inflightRequests--;
    }
  }

  private async dispatchInboundMessage(msg: SessionInboundMessage): Promise<void> {
    const promise =
      this.dispatchVoiceAndDictationMessage(msg) ??
      this.dispatchAgentLifecycleMessage(msg) ??
      (await this.dispatchGenerativeUiMessage(msg)) ??
      this.dispatchCheckoutMessage(msg) ??
      this.dispatchWorkspaceAndProjectMessage(msg) ??
      this.dispatchProviderMessage(msg) ??
      this.dispatchTerminalMessage(msg) ??
      this.dispatchChatScheduleLoopMessage(msg) ??
      this.dispatchCindyMessage(msg) ??
      this.dispatchDshdDesktopMessage(msg) ??
      this.dispatchMiscMessage(msg);
    if (promise) await promise;
  }

  private dispatchVoiceAndDictationMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    return this.voiceDictationHandler.dispatch(msg);
  }

  private dispatchAgentLifecycleMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    return this.agentLifecycleHandler.dispatch(msg);
  }

  private async dispatchGenerativeUiMessage(msg: SessionInboundMessage): Promise<undefined> {
    return this.generativeUiHandler.dispatch(msg);
  }

  // eslint-disable-next-line complexity
  private dispatchCheckoutMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "checkout_status_request":
        return this.checkoutGitHandler.handleCheckoutStatusRequest(msg);
      case "validate_branch_request":
        return this.checkoutGitHandler.handleValidateBranchRequest(msg);
      case "branch_suggestions_request":
        return this.checkoutGitHandler.handleBranchSuggestionsRequest(msg);
      case "directory_suggestions_request":
        return this.checkoutGitHandler.handleDirectorySuggestionsRequest(msg);
      case "subscribe_checkout_diff_request":
        return this.checkoutGitHandler.handleSubscribeCheckoutDiffRequest(msg);
      case "unsubscribe_checkout_diff_request":
        this.checkoutGitHandler.handleUnsubscribeCheckoutDiffRequest(msg);
        return undefined;
      case "checkout_switch_branch_request":
        return this.checkoutGitHandler.handleCheckoutSwitchBranchRequest(msg);
      case "checkout.rename_branch.request":
        return this.checkoutGitHandler.handleCheckoutRenameBranchRequest(msg);
      case "checkout_commit_request":
        return this.checkoutGitHandler.handleCheckoutCommitRequest(msg);
      case "checkout_merge_request":
        return this.checkoutGitHandler.handleCheckoutMergeRequest(msg);
      case "checkout_merge_from_base_request":
        return this.checkoutGitHandler.handleCheckoutMergeFromBaseRequest(msg);
      case "checkout_pull_request":
        return this.checkoutGitHandler.handleCheckoutPullRequest(msg);
      case "checkout_push_request":
        return this.checkoutGitHandler.handleCheckoutPushRequest(msg);
      case "checkout.refresh.request":
        return this.checkoutGitHandler.handleCheckoutRefreshRequest(msg);
      case "checkout_pr_create_request":
        return this.checkoutGitHandler.handleCheckoutPrCreateRequest(msg);
      case "checkout_pr_merge_request":
        return this.checkoutGitHandler.handleCheckoutPrMergeRequest(msg);
      case "checkout.github.set_auto_merge.request":
        return this.checkoutGitHandler.handleCheckoutGithubSetAutoMergeRequest(msg);
      case "checkout_pr_status_request":
        return this.checkoutGitHandler.handleCheckoutPrStatusRequest(msg);
      case "pull_request_timeline_request":
        return this.checkoutGitHandler.handlePullRequestTimelineRequest(msg);
      case "github_search_request":
        return this.checkoutGitHandler.handleGitHubSearchRequest(msg);
      case "stash_save_request":
        return this.checkoutGitHandler.handleStashSaveRequest(msg);
      case "stash_pop_request":
        return this.checkoutGitHandler.handleStashPopRequest(msg);
      case "stash_list_request":
        return this.checkoutGitHandler.handleStashListRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchWorkspaceAndProjectMessage(
    msg: SessionInboundMessage,
  ): Promise<void> | undefined {
    return this.workspaceProjectHandler.dispatch(msg);
  }

  private dispatchProviderMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "list_provider_models_request":
        return this.providerHandler.handleListProviderModelsRequest(msg);
      case "list_provider_modes_request":
        return this.providerHandler.handleListProviderModesRequest(msg);
      case "list_provider_features_request":
        return this.providerHandler.handleListProviderFeaturesRequest(msg);
      case "list_available_providers_request":
        return this.providerHandler.handleListAvailableProvidersRequest(msg);
      case "get_providers_snapshot_request":
        return this.providerHandler.handleGetProvidersSnapshotRequest(msg);
      case "refresh_providers_snapshot_request":
        return this.providerHandler.handleRefreshProvidersSnapshotRequest(msg);
      case "provider_diagnostic_request":
        return this.providerHandler.handleProviderDiagnosticRequest(msg);
      case "diagnostics.request":
        return this.providerHandler.handleDiagnosticsRequest(msg);
      case "provider.tooling.run.request":
        return this.providerHandler.handleProviderToolingActionRequest(msg);
      case "agent.presets.list.request":
        return this.providerHandler.handleAgentPresetsListRequest(msg);
      case "model_gateway.moa.test.request":
        return this.providerHandler.handleModelGatewayMoaTestRequest(msg);
      case "model_gateway.test.request":
        return this.providerHandler.handleModelGatewayTestRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchTerminalMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    return this.terminalScriptHandler.dispatchTerminalMessage(msg);
  }

  private dispatchChatScheduleLoopMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "chat/create":
        return this.chatScheduleLoopHandler.handleChatCreateRequest(msg);
      case "chat/list":
        return this.chatScheduleLoopHandler.handleChatListRequest(msg);
      case "chat/inspect":
        return this.chatScheduleLoopHandler.handleChatInspectRequest(msg);
      case "chat/delete":
        return this.chatScheduleLoopHandler.handleChatDeleteRequest(msg);
      case "chat/post":
        return this.chatScheduleLoopHandler.handleChatPostRequest(msg);
      case "chat/read":
        return this.chatScheduleLoopHandler.handleChatReadRequest(msg);
      case "chat/wait":
        return this.chatScheduleLoopHandler.handleChatWaitRequest(msg);
      case "loop/run":
        return this.chatScheduleLoopHandler.handleLoopRunRequest(msg);
      case "loop/list":
        return this.chatScheduleLoopHandler.handleLoopListRequest(msg);
      case "loop/inspect":
        return this.chatScheduleLoopHandler.handleLoopInspectRequest(msg);
      case "loop/logs":
        return this.chatScheduleLoopHandler.handleLoopLogsRequest(msg);
      case "loop/stop":
        return this.chatScheduleLoopHandler.handleLoopStopRequest(msg);
      default:
        return this.dispatchScheduleMessage(msg);
    }
  }

  private dispatchScheduleMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "schedule/create":
        return this.chatScheduleLoopHandler.handleScheduleCreateRequest(msg);
      case "schedule/list":
        return this.chatScheduleLoopHandler.handleScheduleListRequest(msg);
      case "schedule/inspect":
        return this.chatScheduleLoopHandler.handleScheduleInspectRequest(msg);
      case "schedule/logs":
        return this.chatScheduleLoopHandler.handleScheduleLogsRequest(msg);
      case "schedule/pause":
        return this.chatScheduleLoopHandler.handleSchedulePauseRequest(msg);
      case "schedule/resume":
        return this.chatScheduleLoopHandler.handleScheduleResumeRequest(msg);
      case "schedule/delete":
        return this.chatScheduleLoopHandler.handleScheduleDeleteRequest(msg);
      case "schedule/run-once":
        return this.chatScheduleLoopHandler.handleScheduleRunOnceRequest(msg);
      case "schedule/update":
        return this.chatScheduleLoopHandler.handleScheduleUpdateRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchCindyMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    // COMPAT(cindyModules): added in v0.1.102, remove no earlier than 2027-07-29 when client/daemon floor >= v0.1.102.
    // Old clients that never negotiated the cindy_modules capability cannot handle Cindy RPC responses
    // (the outbound union is closed); reject inbound requests with rpc_error instead of dispatching.
    if (!this.supports(CLIENT_CAPS.cindyModules)) {
      this.emitCindyUnsupported(msg);
      return undefined;
    }
    // goal/team/learn operate by agentId and do not touch arbitrary paths.
    if (msg.type.startsWith("goal/")) return this.dispatchGoalMessage(msg);
    if (msg.type.startsWith("team/")) return this.dispatchTeamMessage(msg);
    if (msg.type.startsWith("learn/")) return this.dispatchLearnMessage(msg);
    // snapshot/migration/context carry a client-controlled cwd/workDir and run git
    // or write files in it; bind them to a registered workspace before dispatch so a
    // peer cannot mutate git state or write config files in arbitrary directories.
    if (
      msg.type.startsWith("snapshot/") ||
      msg.type.startsWith("migration/") ||
      msg.type.startsWith("context/")
    ) {
      return this.dispatchCindyWorkspaceBound(msg);
    }
    return undefined;
  }

  private dispatchDshdDesktopMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    return dispatchDshdDesktopRpc(msg, (message) => this.emit(message), this);
  }

  /**
   * Emits an rpc_error indicating the Cindy feature is not negotiated by this client.
   */
  private emitCindyUnsupported(msg: SessionInboundMessage): void {
    const request = msg as { requestId?: string; type: string };
    this.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId ?? "",
        requestType: request.type,
        error: "此客户端不支持该功能",
        code: "unsupported_feature",
      },
    });
  }

  /**
   * Dispatches Cindy RPCs that carry a client-controlled cwd/workDir only after
   * confirming the directory resolves to a registered workspace. Rejects with
   * rpc_error{workspace_not_found} otherwise, preventing arbitrary-repo git ops
   * and arbitrary-dir config writes.
   */
  private async dispatchCindyWorkspaceBound(msg: SessionInboundMessage): Promise<void> {
    const dir =
      (msg as { cwd?: string; workDir?: string }).cwd ??
      (msg as { workDir?: string }).workDir ??
      "";
    if (dir.length > 0) {
      const workspace = await this.findWorkspaceByDirectory(dir);
      if (!workspace) {
        const request = msg as { requestId?: string; type: string };
        this.emit({
          type: "rpc_error",
          payload: {
            requestId: request.requestId ?? "",
            requestType: request.type,
            error: "Requested directory is not a registered workspace",
            code: "workspace_not_found",
          },
        });
        return;
      }
    }
    if (msg.type.startsWith("snapshot/")) return this.dispatchSnapshotMessage(msg);
    if (msg.type.startsWith("migration/")) return this.dispatchMigrationMessage(msg);
    if (msg.type.startsWith("context/")) return this.dispatchContextMessage(msg);
  }

  private dispatchGoalMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "goal/set":
        return this.goalHandler.handleGoalSetRequest(msg);
      case "goal/cancel":
        return this.goalHandler.handleGoalCancelRequest(msg);
      case "goal/inspect":
        return this.goalHandler.handleGoalInspectRequest(msg);
      case "goal/list":
        return this.goalHandler.handleGoalListRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchTeamMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "team/start":
        return this.teamHandler.handleTeamStartRequest(msg);
      case "team/end":
        return this.teamHandler.handleTeamEndRequest(msg);
      case "team/create-worker":
        return this.teamHandler.handleTeamCreateWorkerRequest(msg);
      case "team/list-workers":
        return this.teamHandler.handleTeamListWorkersRequest(msg);
      case "team/send-to-worker":
        return this.teamHandler.handleTeamSendToWorkerRequest(msg);
      case "team/list-queue":
        return this.teamHandler.handleTeamListQueueRequest(msg);
      case "team/cancel-message":
        return this.teamHandler.handleTeamCancelMessageRequest(msg);
      case "team/archive-worker":
        return this.teamHandler.handleTeamArchiveWorkerRequest(msg);
      case "team/switch-focus":
        return this.teamHandler.handleTeamSwitchFocusRequest(msg);
      case "team/worker-status":
        return this.teamHandler.handleTeamWorkerStatusRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchContextMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "context/build":
        return this.projectContextHandler.handleContextBuildRequest(msg);
      case "context/inspect":
        return this.projectContextHandler.handleContextInspectRequest(msg);
      case "context/invalidate":
        return this.projectContextHandler.handleContextInvalidateRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchSnapshotMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "snapshot/create":
        return this.snapshotHandler.handleSnapshotCreateRequest(msg);
      case "snapshot/list":
        return this.snapshotHandler.handleSnapshotListRequest(msg);
      case "snapshot/rewind":
        return this.snapshotHandler.handleSnapshotRewindRequest(msg);
      case "snapshot/status":
        return this.snapshotHandler.handleSnapshotStatusRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchMigrationMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "migration/detect":
        return this.migrationHandler.handleMigrationDetectRequest(msg);
      case "migration/apply":
        return this.migrationHandler.handleMigrationApplyRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchLearnMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "learn/start":
        return this.learnHandler.handleLearnStartRequest(msg);
      case "learn/list":
        return this.learnHandler.handleLearnListRequest(msg);
      case "learn/inspect":
        return this.learnHandler.handleLearnInspectRequest(msg);
      case "learn/apply":
        return this.learnHandler.handleLearnApplyRequest(msg);
      case "learn/discard":
        return this.learnHandler.handleLearnDiscardRequest(msg);
      case "learn/cancel":
        return this.learnHandler.handleLearnCancelRequest(msg);
      default:
        return undefined;
    }
  }

  private async dispatchMiscMessage(msg: SessionInboundMessage): Promise<void> {
    switch (msg.type) {
      case "abort_request":
        return this.handleAbort();
      case "client_heartbeat":
        this.handleClientHeartbeat(msg);
        return;
      case "ping": {
        const now = Date.now();
        this.emit({
          type: "pong",
          payload: {
            requestId: msg.requestId,
            clientSentAt: msg.clientSentAt,
            serverReceivedAt: now,
            serverSentAt: now,
          },
        });
        return;
      }
      default:
        return this.configControlHandler.dispatch(msg);
    }
  }

  /** Reset peak inflight count (useful after a surge). */
  public resetPeakInflight(): void {
    this.peakInflightRequests = this.inflightRequests;
  }

  /** Handle a binary frame (terminal stream) from the client. */
  public handleBinaryFrame(frame: TerminalStreamFrame): void {
    this.terminalController.handleBinaryFrame(frame);
  }

  private emitLifecycleIntent(intent: SessionLifecycleIntent): void {
    if (!this.onLifecycleIntent) {
      return;
    }
    try {
      this.onLifecycleIntent(intent);
    } catch (error) {
      this.sessionLogger.error({ err: error, intent }, "Lifecycle intent handler failed");
    }
  }

  private async archiveAgentForClose(
    agentId: string,
  ): Promise<{ agentId: string; archivedAt: string }> {
    const { archivedAt, record: archivedRecord } = await archiveAgentCommand(
      {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.sessionLogger,
      },
      agentId,
    );

    await this.agentDirectoryHandler.publishStoredAgentUpdate(archivedRecord);

    return { agentId, archivedAt };
  }

  /**
   * Handle create agent request
   */
  private async resolveCreateAgentWorkspace(
    cwd: string,
    workspaceId?: string,
  ): Promise<{ workspaceId: string }> {
    const resolvedWorkspace = workspaceId
      ? await this.workspaceRegistry.get(workspaceId)
      : ((await this.findWorkspaceByDirectory(cwd)) ??
        (await this.findOrCreateWorkspaceForDirectory(cwd)));
    if (!resolvedWorkspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return { workspaceId: resolvedWorkspace.workspaceId };
  }

  private async buildAgentSessionConfig(
    config: AgentSessionConfig,
    gitOptions?: GitSetupOptions,
    legacyWorktreeName?: string,
    firstAgentContext?: FirstAgentContext,
  ): Promise<{
    sessionConfig: AgentSessionConfig;
    setupContinuation?: CreateChisaCodeWorktreeWorkflowResult["setupContinuation"];
  }> {
    return buildWorktreeAgentSessionConfig(
      {
        chisacodeHome: this.chisacodeHome,
        sessionLogger: this.sessionLogger,
        workspaceGitService: this.workspaceGitService,
        createChisaCodeWorktree: (input, serviceOptions) =>
          this.createChisaCodeWorktreeWorkflow(input, {
            ...serviceOptions,
            setupContinuation: {
              kind: "agent",
              terminalManager: this.terminalManager,
              appendTimelineItem: ({ agentId, item }) =>
                appendTimelineItemIfAgentKnown({
                  agentManager: this.agentManager,
                  agentId,
                  item,
                }),
              emitLiveTimelineItem: ({ agentId, item }) =>
                emitLiveTimelineItemIfAgentKnown({
                  agentManager: this.agentManager,
                  agentId,
                  item,
                }),
              logger: this.sessionLogger,
            },
          }),
        checkoutExistingBranch: (cwd, branch) =>
          this.checkoutGitHandler.checkoutExistingBranch(cwd, branch),
        createBranchFromBase: (params) => this.checkoutGitHandler.createBranchFromBase(params),
        github: this.github,
      },
      config,
      gitOptions,
      legacyWorktreeName,
      firstAgentContext,
    );
  }

  private scheduleAutoNameWorkspaceBranchForFirstAgent(input: {
    workspace: PersistedWorkspaceRecord;
    firstAgentContext: FirstAgentContext;
  }): void {
    setTimeout(() => {
      void this.workspaceProjectHandler
        .maybeAutoNameWorkspaceBranchForFirstAgent(input)
        .catch((error) => {
          this.sessionLogger.warn(
            { err: error, cwd: input.workspace.cwd },
            "Failed to auto-name worktree branch",
          );
        });
    }, 0);
  }

  private isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
    return isPathWithinRootCore(rootPath, candidatePath);
  }

  private async generateCommitMessage(cwd: string): Promise<string> {
    return this.gitMetadataGenerator.generateCommitMessage(cwd);
  }

  private async generatePullRequestText(
    cwd: string,
    baseRef?: string,
  ): Promise<{ title: string; body: string }> {
    return this.gitMetadataGenerator.generatePullRequestText(cwd, baseRef);
  }
  private async notifyGitMutation(
    cwd: string,
    reason: GitMutationRefreshReason,
    options?: { invalidateGithub?: boolean },
  ): Promise<void> {
    if (options?.invalidateGithub) {
      this.github.invalidate({ cwd });
    }
    try {
      await this.workspaceGitService.getSnapshot(cwd, { force: true, reason });
    } catch (error) {
      this.sessionLogger.warn(
        { err: error, cwd, reason },
        "Failed to force-refresh workspace git snapshot after mutation",
      );
    }
  }

  /**
   * Handle client heartbeat for activity tracking
   */
  private handleClientHeartbeat(msg: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    lastActivityAt: string;
    appVisible: boolean;
    appVisibilityChangedAt?: string;
  }): void {
    const appVisibilityChangedAt = msg.appVisibilityChangedAt
      ? new Date(msg.appVisibilityChangedAt)
      : new Date(msg.lastActivityAt);
    this.clientActivity = {
      deviceType: msg.deviceType,
      focusedAgentId: msg.focusedAgentId,
      lastActivityAt: new Date(msg.lastActivityAt),
      appVisible: msg.appVisible,
      appVisibilityChangedAt,
    };
  }

  /**
   * Handle push token registration
   */
  /**
   * Handle agent permission response from user
   */

  private removeWorkspaceGitSubscription(cwd: string): void {
    this.workspaceGitObserverController.removeSubscription(cwd);
  }

  private shouldSkipWorkspaceGitWatchUpdate(
    workspaceId: string,
    workspace: WorkspaceDescriptorPayload | null,
  ): boolean {
    return this.workspaceGitObserverController.shouldSkipDescriptorUpdate(workspaceId, workspace);
  }

  private rememberWorkspaceGitDescriptorState(
    workspaceId: string,
    workspace: WorkspaceDescriptorPayload | null,
  ): void {
    this.workspaceGitObserverController.recordDescriptorUpdate(workspaceId, workspace);
  }

  private handleWorkspaceGitBranchSnapshot(cwd: string, branchName: string | null): void {
    this.workspaceGitObserverController.handleBranchSnapshot(cwd, branchName);
  }

  private syncWorkspaceGitObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void {
    this.workspaceGitObserverController.syncObservers(workspaces);
  }

  /**
   * Look up a single agent payload by ID across live + persisted storage.
   */
  private async getAgentPayloadById(agentId: string): Promise<AgentSnapshotPayload | null> {
    const live = this.agentManager.getAgent(agentId);
    if (live) {
      const payload = await this.buildAgentPayload(live);
      return this.isProviderVisibleToClient(payload.provider) ? payload : null;
    }

    const record = await this.agentStorage.get(agentId);
    if (!record || record.internal) {
      return null;
    }
    const payload = this.buildStoredAgentPayload(record);
    return this.isProviderVisibleToClient(payload.provider) ? payload : null;
  }

  /**
   * Build the current agent list payload (live + persisted), optionally filtered by labels.
   */
  private async listAgentPayloads(filter?: {
    labels?: Record<string, string>;
    includeUnavailablePersisted?: boolean;
  }): Promise<AgentSnapshotPayload[]> {
    // Get live agents with session modes
    const agentSnapshots = this.agentManager.listAgents();
    const liveAgents = await Promise.all(
      agentSnapshots.map((agent) => this.buildAgentPayload(agent)),
    );

    // Add persisted agents that have not been lazily initialized yet
    // (excluding internal agents which are for ephemeral system tasks)
    const registryRecords = await this.agentStorage.list();
    const liveIds = new Set(agentSnapshots.map((a) => a.id));
    const registeredProviderIds = this.providerSnapshotManager.listRegisteredProviderIds();
    const persistedAgents = registryRecords
      .filter((record) => !liveIds.has(record.id) && !record.internal)
      .filter(
        (record) =>
          filter?.includeUnavailablePersisted === true ||
          isStoredAgentProviderAvailable(record, registeredProviderIds),
      )
      .map((record) => this.buildStoredAgentPayload(record, registeredProviderIds));

    let agents = [...liveAgents, ...persistedAgents];

    agents = agents.filter((agent) => this.isProviderVisibleToClient(agent.provider));

    // Filter by labels if filter provided
    if (filter?.labels) {
      const filterLabels = filter.labels;
      agents = agents.filter((agent) =>
        Object.entries(filterLabels).every(([key, value]) => agent.labels[key] === value),
      );
    }

    return agents;
  }

  /**
   * Public delegation to the agent lifecycle handler for paginated agent listing.
   * The handler's implementation is the canonical one; this keeps backward
   * compatibility for tests that call the method directly on Session.
   */
  async listFetchAgentsEntries(
    request: Parameters<AgentLifecycleHandler["listFetchAgentsEntries"]>[0],
  ): ReturnType<AgentLifecycleHandler["listFetchAgentsEntries"]> {
    return this.agentDirectoryHandler.listFetchAgentsEntries(request);
  }

  /**
   * Handle archive_agent_request by dispatching through the normal message chain.
   */
  async handleArchiveAgentRequest(agentId: string, requestId: string): Promise<void> {
    await this.handleMessage({
      type: "archive_agent_request",
      agentId,
      requestId,
    } as SessionInboundMessage);
  }

  /**
   * Handle create_chisacode_worktree_request by dispatching through the normal
   * message chain.
   */
  async handleCreateChisaCodeWorktreeRequest(params: Record<string, unknown>): Promise<void> {
    await this.handleMessage(params as SessionInboundMessage);
  }

  private async resolveAgentIdentifier(
    identifier: string,
  ): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
    return resolveAgentIdentifierFunc(
      {
        listLiveAgentIds: () => this.agentManager.listAgents().map((a) => a.id),
        listStoredRecords: async () => {
          const records = await this.agentStorage.list();
          return records.filter((r) => !r.internal).map((r) => ({ id: r.id, title: r.title }));
        },
      },
      identifier,
    );
  }

  private async describeWorkspaceRecord(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<WorkspaceDescriptorPayload> {
    return this.workspaceDescriptorBuilder.describeWorkspaceRecord(workspace, projectRecord);
  }

  private async describeWorkspaceRecordWithGitData(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<WorkspaceDescriptorPayload> {
    return this.workspaceDescriptorBuilder.describeWorkspaceRecordWithGitData(
      workspace,
      projectRecord,
    );
  }

  private async describeCreatedWorktreeWorkspace(
    result: CreateChisaCodeWorktreeResult,
  ): Promise<WorkspaceDescriptorPayload> {
    return this.workspaceDescriptorBuilder.describeCreatedWorktreeWorkspace(result);
  }
  private async buildWorkspaceDescriptor(input: {
    workspace: PersistedWorkspaceRecord;
    projectRecord?: PersistedProjectRecord | null;
    includeGitData: boolean;
  }): Promise<WorkspaceDescriptorPayload> {
    if (input.includeGitData && input.projectRecord?.kind === "git") {
      return this.describeWorkspaceRecordWithGitData(input.workspace, input.projectRecord);
    }
    return this.describeWorkspaceRecord(input.workspace, input.projectRecord);
  }

  markWorkspaceArchiving(workspaceIds: Iterable<string>, archivingAt: string): void {
    this.workspaceDirectory.markArchiving(workspaceIds, archivingAt);
  }

  clearWorkspaceArchiving(workspaceIds: Iterable<string>): void {
    this.workspaceDirectory.clearArchiving(workspaceIds);
  }

  private async buildWorkspaceDescriptorMap(options: {
    includeGitData: boolean;
    workspaceIds?: Iterable<string>;
  }): Promise<Map<string, WorkspaceDescriptorPayload>> {
    return this.workspaceDirectory.buildDescriptorMap(options);
  }

  private resolveRegisteredWorkspaceIdForCwd(
    cwd: string,
    workspaces: PersistedWorkspaceRecord[],
  ): string {
    return this.workspaceDirectory.resolveRegisteredWorkspaceIdForCwd(cwd, workspaces);
  }

  private async listFetchWorkspacesEntries(
    request: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>,
  ): Promise<{
    entries: FetchWorkspacesResponseEntry[];
    pageInfo: FetchWorkspacesResponsePageInfo;
  }> {
    return this.workspaceDirectory.listFetchEntries(request);
  }

  private async findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord> {
    return this.workspaceRecordController.findOrCreateWorkspaceForDirectory(cwd);
  }
  private async createChisaCodeWorktree(
    input: CreateChisaCodeWorktreeInput,
    options?: {
      resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
    },
  ): Promise<CreateChisaCodeWorktreeResult> {
    const result = await createChisaCodeWorktree(input, {
      github: this.github,
      ...(options?.resolveDefaultBranch
        ? { resolveDefaultBranch: options.resolveDefaultBranch }
        : {}),
      projectRegistry: this.projectRegistry,
      workspaceRegistry: this.workspaceRegistry,
      workspaceGitService: this.workspaceGitService,
    });
    void Promise.all([
      this.notifyGitMutation(input.cwd, "create-worktree"),
      this.notifyGitMutation(result.worktree.worktreePath, "create-worktree"),
    ]).catch((error) => {
      this.sessionLogger.warn(
        { err: error, cwd: input.cwd, worktreePath: result.worktree.worktreePath },
        "Failed to warm git snapshots after creating worktree",
      );
    });
    return result;
  }

  private async archiveWorkspaceRecord(workspaceId: string, archivedAt?: string): Promise<void> {
    await this.workspaceRecordController.archiveWorkspaceRecord(workspaceId, archivedAt);
  }

  async reconcileAndEmitWorkspaceUpdates(): Promise<void> {
    await this.workspaceUpdateController.reconcileAndEmitUpdates();
  }

  private async reconcileActiveWorkspaceRecords(): Promise<Set<string>> {
    const service = new WorkspaceReconciliationService({
      projectRegistry: this.projectRegistry,
      workspaceRegistry: this.workspaceRegistry,
      logger: this.sessionLogger,
      workspaceGitService: this.workspaceGitService,
    });
    const result = await service.runOnce();
    const changedWorkspaceIds = new Set<string>();
    const changedProjectIds = new Set<string>();

    await Promise.all(
      result.changesApplied.map(async (change) => {
        switch (change.kind) {
          case "workspace_archived":
            this.scriptRuntimeStore?.removeForWorkspace(change.directory);
            this.removeWorkspaceGitSubscription(change.directory);
            changedWorkspaceIds.add(change.workspaceId);
            break;
          case "workspace_updated":
            changedWorkspaceIds.add(change.workspaceId);
            break;
          case "project_archived":
          case "project_updated":
            changedProjectIds.add(change.projectId);
            break;
        }
      }),
    );

    if (changedProjectIds.size > 0) {
      for (const workspace of await this.workspaceRegistry.list()) {
        if (changedProjectIds.has(workspace.projectId)) {
          changedWorkspaceIds.add(workspace.workspaceId);
        }
      }
    }

    return changedWorkspaceIds;
  }

  private async emitWorkspaceUpdatesForWorkspaceIds(
    workspaceIds: Iterable<string>,
    options?: { skipReconcile?: boolean; dedupeGitState?: boolean },
  ): Promise<void> {
    await this.workspaceUpdateController.emitUpdatesForWorkspaceIds(workspaceIds, options);
  }

  private async emitWorkspaceUpdateForCwd(
    cwd: string,
    options?: { skipReconcile?: boolean; dedupeGitState?: boolean },
  ): Promise<void> {
    await this.workspaceUpdateController.emitUpdateForCwd(cwd, options);
  }

  get workspaceUpdatesSubscription(): WorkspaceUpdatesSubscriptionState | null {
    return this.workspaceUpdateController.getSubscription();
  }

  set workspaceUpdatesSubscription(subscription: WorkspaceUpdatesSubscriptionState | null) {
    this.workspaceUpdateController.setSubscription(subscription);
  }
  private buildWorkspaceScriptPayloadSnapshot(
    workspaceId: string,
    workspaceDirectory: string,
  ): WorkspaceDescriptorPayload["scripts"] {
    return buildWorkspaceScriptPayloadSnapshotCore(workspaceId, workspaceDirectory, {
      scriptRouteStore: this.scriptRouteStore,
      scriptRuntimeStore: this.scriptRuntimeStore,
      getDaemonTcpPort: this.getDaemonTcpPort,
      resolveScriptHealth: this.resolveScriptHealth,
      workspaceGitService: this.workspaceGitService,
      sessionLogger: this.sessionLogger,
    });
  }

  private emitWorkspaceScriptStatusUpdate(workspaceId: string, workspaceDirectory: string): void {
    emitWorkspaceScriptStatusUpdateCore(workspaceId, workspaceDirectory, {
      scriptRouteStore: this.scriptRouteStore,
      scriptRuntimeStore: this.scriptRuntimeStore,
      getDaemonTcpPort: this.getDaemonTcpPort,
      resolveScriptHealth: this.resolveScriptHealth,
      workspaceGitService: this.workspaceGitService,
      sessionLogger: this.sessionLogger,
      emit: (message) => this.emit(message),
    });
  }

  async resolveAvailableEditorTargets(): Promise<EditorTargetDescriptorPayload[]> {
    return listAvailableEditorTargets();
  }

  async getAvailableEditorTargets() {
    return this.filterEditorsForClient(await this.getMemoizedAvailableEditorTargets());
  }

  async openEditorTarget(options: { editorId: EditorTargetId; path: string }): Promise<void> {
    await openInEditorTarget(options);
  }

  private async createChisaCodeWorktreeWorkflow(
    input: CreateChisaCodeWorktreeInput,
    options?: {
      resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
      setupContinuation?: CreateChisaCodeWorktreeSetupContinuationInput;
    },
  ): Promise<CreateChisaCodeWorktreeWorkflowResult> {
    return createWorktreeWorkflow(
      {
        chisacodeHome: this.chisacodeHome,
        createChisaCodeWorktree: (workflowInput, serviceOptions) =>
          this.createChisaCodeWorktree(workflowInput, serviceOptions),
        warmWorkspaceGitData: (workspace) => this.warmWorkspaceGitDataForWorkspace(workspace),
        autoNameWorkspaceBranchForFirstAgent: (autoNameInput) =>
          this.scheduleAutoNameWorkspaceBranchForFirstAgent(autoNameInput),
        emitWorkspaceUpdateForCwd: (cwd, emitOptions) =>
          this.emitWorkspaceUpdateForCwd(cwd, emitOptions),
        cacheWorkspaceSetupSnapshot: (workspaceId, snapshot) => {
          this.workspaceSetupSnapshots.set(workspaceId, snapshot);
        },
        emit: (message) => this.emit(message),
        sessionLogger: this.sessionLogger,
        terminalManager: this.terminalManager,
        archiveWorkspaceRecord: (workspaceId) => this.archiveWorkspaceRecord(workspaceId),
        scriptRouteStore: this.scriptRouteStore,
        scriptRuntimeStore: this.scriptRuntimeStore,
        getDaemonTcpPort: this.getDaemonTcpPort,
        getDaemonTcpHost: this.getDaemonTcpHost,
        onScriptsChanged: (workspaceId, workspaceDirectory) => {
          this.emitWorkspaceScriptStatusUpdate(workspaceId, workspaceDirectory);
        },
      },
      input,
      options,
    );
  }

  /**
   * Handle abort request from client
   */
  private async handleAbort(): Promise<void> {
    this.sessionLogger.info("Abort request");

    this.operationAbortController.abort();
    if (!this.disposed) {
      this.operationAbortController = new AbortController();
    }
  }

  /**
   * Emit a message to the client
   */
  private emit(msg: SessionOutboundMessage): void {
    this.sessionLogger.trace(
      {
        messageType: msg.type,
        payloadBytes: JSON.stringify(msg).length,
      },
      "agent.session.outbound",
    );
    this.onMessage(msg);
  }

  private emitBinary(frame: Uint8Array): void {
    if (!this.onBinaryMessage) {
      return;
    }
    try {
      this.onBinaryMessage(frame);
    } catch (error) {
      this.sessionLogger.error({ err: error }, "Failed to emit binary frame");
    }
  }

  /**
   * Clean up session resources
   */
  /**
   * Clean up the session: dispose handlers, tear down subscriptions,
   * abort ongoing work, and close watchers/observers.
   */
  public async cleanup(): Promise<void> {
    this.disposed = true;
    this.sessionLogger.trace({}, "agent.session.lifecycle.cleanup");

    this.agentEventForwarder.dispose();

    // Abort any ongoing operations
    this.operationAbortController.abort();
    this.voiceDictationHandler.dispose();

    await this.sessionMcpClientController.dispose();

    this.terminalController.dispose();

    this.checkoutGitHandler.dispose();
    this.chatScheduleLoopHandler.dispose();
    this.configControlHandler.dispose();
    this.providerHandler.dispose();
    this.terminalScriptHandler.dispose();
    this.workspaceProjectHandler.dispose();
    this.agentDirectoryHandler.dispose();
    this.agentLifecycleHandler.dispose();
    this.generativeUiHandler.dispose();

    this.workspaceUpdateController.dispose();
    this.workspaceGitObserverController.dispose();
  }
}
