import type { Logger } from "pino";

import {
  PARENT_AGENT_ID_LABEL,
  type AgentRelation,
  type AgentRelationKind,
} from "@chisacode/protocol/agent-labels";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { CreateChisaCodeWorktreeInput } from "../../chisacode-worktree-service.js";
import { expandUserPath, resolvePathFromBase } from "../../path-utils.js";
import { toWorktreeRequestError } from "../../worktree-errors.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type {
  AgentWorktreeSetupContinuation,
  CreateChisaCodeWorktreeSetupContinuationInput,
  CreateChisaCodeWorktreeWorkflowFn,
  CreateChisaCodeWorktreeWorkflowResult,
} from "../../worktree-session.js";
import type { AgentAttachment, FirstAgentContext, GitSetupOptions } from "../../messages.js";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import { scheduleAgentMetadataGeneration } from "../agent-metadata-generator.js";
import type { StructuredGenerationDaemonConfig } from "../structured-generation-providers.js";
import type {
  AgentPromptContentBlock,
  AgentPromptInput,
  AgentRunOptions,
  AgentSessionConfig,
} from "../agent-sdk-types.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { setupFinishNotification, startCreatedAgentInitialPrompt } from "../agent-prompt.js";
import { resolveClientMessageId } from "../../client-message-id.js";
import { resolveRequiredProviderModel } from "../mcp-shared.js";
import {
  appendTimelineItemIfAgentKnown,
  emitLiveTimelineItemIfAgentKnown,
} from "../timeline-append.js";

export interface CreateAgentWorkspace {
  workspaceId: string;
}

export interface CreateAgentSessionWorktreeResult {
  sessionConfig: AgentSessionConfig;
  setupContinuation?: AgentWorktreeSetupContinuation;
}

interface CreateAgentCommandDependencies {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  chisacodeHome?: string;
  workspaceGitService?: Pick<
    WorkspaceGitService,
    "getSnapshot" | "listWorktrees" | "resolveRepoRoot"
  >;
  terminalManager?: TerminalManager | null;
  providerSnapshotManager: ProviderSnapshotManager;
  daemonConfig?: StructuredGenerationDaemonConfig | null;
  createChisaCodeWorktree?: CreateChisaCodeWorktreeWorkflowFn;
}

export interface CreateAgentFromSessionInput {
  kind: "session";
  config: AgentSessionConfig;
  workspaceId?: string;
  worktreeName?: string;
  initialPrompt?: string;
  clientMessageId?: string;
  /**
   * Client-minted agent id (UUID). Adopted verbatim so the optimistic sidebar
   * row and the authoritative agent share one key. When omitted the daemon
   * mints its own UUID.
   */
  agentId?: string;
  outputSchema?: Record<string, unknown>;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
  git?: GitSetupOptions;
  labels: Record<string, string>;
  relationKind?: AgentRelationKind;
  env?: Record<string, string>;
  provisionalTitle: string | null;
  explicitTitle: string | null;
  firstAgentContext: FirstAgentContext;
  buildSessionConfig: (
    config: AgentSessionConfig,
    gitOptions?: GitSetupOptions,
    legacyWorktreeName?: string,
    firstAgentContext?: FirstAgentContext,
  ) => Promise<CreateAgentSessionWorktreeResult>;
  resolveWorkspace: (input: { cwd: string; workspaceId?: string }) => Promise<CreateAgentWorkspace>;
}

export interface CreateAgentFromMcpInput {
  kind: "mcp";
  provider: string;
  title: string;
  initialPrompt: string;
  cwd?: string;
  thinking?: string;
  features?: Record<string, unknown>;
  labels?: Record<string, string>;
  relationKind?: AgentRelationKind;
  mode?: string;
  background: boolean;
  notifyOnFinish: boolean;
  callerAgentId?: string;
  callerContext?: {
    lockedCwd?: string;
    allowCustomCwd?: boolean;
    childAgentDefaultLabels?: Record<string, string>;
  } | null;
  worktree?: {
    worktreeName?: string;
    baseBranch?: string;
    refName?: string;
    action?: "branch-off" | "checkout";
    githubPrNumber?: number;
  };
}

export type CreateAgentCommandInput = CreateAgentFromSessionInput | CreateAgentFromMcpInput;

export interface CreateAgentCommandResult {
  snapshot: ManagedAgent;
  liveSnapshot: ManagedAgent;
  background: boolean;
  initialPromptStarted: boolean;
}

interface ResolvedCreateAgent {
  config: AgentSessionConfig;
  agentId?: string;
  createOptions?: AgentCreateOptions;
  metadataInitialPrompt?: string;
  prompt?: AgentPromptInput;
  runOptions?: AgentRunOptions;
  explicitTitle: string | null;
  setupContinuation?: AgentWorktreeSetupContinuation;
  background: boolean;
  promptFailure: "throw" | "log";
  promptLogger?: Logger;
  provisionalTitle?: string | null;
}

interface AgentCreateOptions {
  labels?: Record<string, string>;
  relation?: AgentRelation;
  workspaceId?: string;
  initialPrompt?: string;
  env?: Record<string, string>;
  initialTitle?: string | null;
}

export async function createAgentCommand(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentCommandInput,
): Promise<CreateAgentCommandResult> {
  const resolved =
    input.kind === "session"
      ? await resolveSessionCreateAgent(dependencies, input)
      : await resolveMcpCreateAgent(dependencies, input);

  const snapshot = await dependencies.agentManager.createAgent(
    resolved.config,
    resolved.agentId,
    resolved.createOptions,
  );

  resolved.setupContinuation?.startAfterAgentCreate({
    agentId: snapshot.id,
  });

  // Fire-and-forget initial prompt so create responses are not blocked on run start.
  // Session construction already registered the agent; connect/startTurn happen async.
  let initialPromptStarted = false;
  if (resolved.prompt !== undefined) {
    initialPromptStarted = true;
    void sendInitialPrompt(dependencies, resolved, snapshot).catch((error) => {
      dependencies.logger.error(
        { err: error, agentId: snapshot.id },
        "Background initial prompt failed",
      );
    });
  }

  if (input.kind === "mcp" && input.notifyOnFinish && input.callerAgentId && initialPromptStarted) {
    setupFinishNotification({
      agentManager: dependencies.agentManager,
      agentStorage: dependencies.agentStorage,
      childAgentId: snapshot.id,
      callerAgentId: input.callerAgentId,
      logger: dependencies.logger,
    });
  }

  return {
    snapshot,
    liveSnapshot: snapshot,
    background: resolved.background,
    initialPromptStarted,
  };
}

async function resolveSessionCreateAgent(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentFromSessionInput,
): Promise<ResolvedCreateAgent> {
  const trimmedPrompt = input.initialPrompt?.trim();
  const { sessionConfig, setupContinuation } = await input.buildSessionConfig(
    input.config,
    input.git,
    input.worktreeName,
    input.firstAgentContext,
  );
  const workspace = await input.resolveWorkspace({
    cwd: sessionConfig.cwd,
    workspaceId: input.workspaceId,
  });
  const prompt = buildAgentPrompt(trimmedPrompt ?? "", input.images, input.attachments);
  const hasPromptContent = Array.isArray(prompt) ? prompt.length > 0 : prompt.length > 0;

  return {
    config: sessionConfig,
    agentId: input.agentId,
    createOptions: {
      labels: input.labels,
      ...(input.relationKind ? { relation: { kind: input.relationKind, source: "user" } } : {}),
      workspaceId: workspace.workspaceId,
      initialPrompt: trimmedPrompt,
      env: input.env,
      initialTitle: input.provisionalTitle,
    },
    metadataInitialPrompt: trimmedPrompt,
    prompt: hasPromptContent ? prompt : undefined,
    runOptions: input.outputSchema ? { outputSchema: input.outputSchema } : undefined,
    explicitTitle: input.explicitTitle,
    provisionalTitle: input.provisionalTitle,
    setupContinuation,
    background: true,
    promptFailure: "throw",
    promptLogger: dependencies.logger.child({
      clientMessageId: resolveClientMessageId(input.clientMessageId),
    }),
  };
}

async function resolveMcpCreateAgent(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentFromMcpInput,
): Promise<ResolvedCreateAgent> {
  const resolvedProviderModel = resolveRequiredProviderModel(input.provider);
  const provider = resolvedProviderModel.provider;
  const parentAgent = input.callerAgentId
    ? requireParentAgent(dependencies.agentManager, input.callerAgentId)
    : null;
  const cwd = parentAgent
    ? resolveChildAgentCwd({
        parentCwd: parentAgent.cwd,
        requestedCwd: input.cwd,
        lockedCwd: input.callerContext?.lockedCwd,
        allowCustomCwd: input.callerContext?.allowCustomCwd ?? true,
      })
    : expandUserPath(input.cwd ?? process.cwd());
  const { resolvedCwd, setupContinuation } = await resolveMcpCwd({
    dependencies,
    cwd,
    worktree: input.worktree,
    initialPrompt: input.initialPrompt,
  });

  const { modeId: resolvedMode, featureValues: resolvedFeatures } =
    await dependencies.providerSnapshotManager.resolveCreateConfig({
      cwd: resolvedCwd,
      provider,
      requestedMode: input.mode,
      featureValues: input.features,
      parent: parentAgent,
    });

  const labels = mergeLabels(
    input.callerAgentId,
    input.callerContext?.childAgentDefaultLabels,
    input.labels,
  );
  const relation = resolveMcpRelation(input.callerAgentId, input.relationKind);

  const trimmedPrompt = input.initialPrompt.trim();
  return {
    config: {
      provider,
      cwd: resolvedCwd,
      modeId: resolvedMode,
      title: input.title.trim(),
      model: resolvedProviderModel.model,
      thinkingOptionId: input.thinking,
      ...(resolvedFeatures ? { featureValues: resolvedFeatures } : {}),
    },
    createOptions: labels || relation ? { labels, relation } : undefined,
    metadataInitialPrompt: trimmedPrompt,
    prompt: trimmedPrompt,
    explicitTitle: input.title.trim(),
    provisionalTitle: input.title.trim(),
    setupContinuation,
    background: input.background,
    promptFailure: "throw",
  };
}

async function sendInitialPrompt(
  dependencies: CreateAgentCommandDependencies,
  resolved: ResolvedCreateAgent,
  snapshot: ManagedAgent,
): Promise<{ started: boolean; liveSnapshot: ManagedAgent }> {
  scheduleAgentMetadataGeneration({
    agentManager: dependencies.agentManager,
    agentId: snapshot.id,
    cwd: snapshot.cwd,
    workspaceGitService: dependencies.workspaceGitService,
    providerSnapshotManager: dependencies.providerSnapshotManager,
    daemonConfig: dependencies.daemonConfig,
    currentSelection: {
      provider: snapshot.provider,
      model: snapshot.runtimeInfo?.model ?? resolved.config.model,
      thinkingOptionId:
        snapshot.runtimeInfo?.thinkingOptionId ?? resolved.config.thinkingOptionId ?? null,
    },
    initialPrompt: resolved.metadataInitialPrompt,
    explicitTitle: resolved.explicitTitle,
    provisionalTitle: resolved.provisionalTitle,
    chisacodeHome: dependencies.chisacodeHome,
    logger: dependencies.logger,
  });

  try {
    const prompt = resolved.prompt;
    if (prompt === undefined) {
      return { started: false, liveSnapshot: snapshot };
    }
    const liveSnapshot = await startCreatedAgentInitialPrompt({
      agentManager: dependencies.agentManager,
      agentId: snapshot.id,
      snapshot,
      prompt,
      runOptions: resolved.runOptions,
      logger: resolved.promptLogger ?? dependencies.logger,
    });
    return { started: true, liveSnapshot };
  } catch (error) {
    // Initial-prompt failures after session construction are reported via stream
    // events (turn_failed / agent_state error). Do not convert them into create failures.
    dependencies.logger.error({ err: error, agentId: snapshot.id }, "Failed to run initial prompt");
    return { started: false, liveSnapshot: snapshot };
  }
}

export function buildAgentPrompt(
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
  attachments?: AgentAttachment[],
): AgentPromptInput {
  const normalized = text.trim();
  const hasImages = (images?.length ?? 0) > 0;
  const hasAttachments = (attachments?.length ?? 0) > 0;
  if (!hasImages && !hasAttachments) {
    return normalized;
  }
  const blocks: AgentPromptContentBlock[] = [];
  if (normalized.length > 0) {
    blocks.push({ type: "text", text: normalized });
  }
  for (const image of images ?? []) {
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  for (const attachment of attachments ?? []) {
    blocks.push(attachment);
  }
  return blocks;
}

function requireParentAgent(agentManager: AgentManager, parentAgentId: string): ManagedAgent {
  const parentAgent = agentManager.getAgent(parentAgentId);
  if (!parentAgent) {
    throw new Error(`Parent agent ${parentAgentId} not found`);
  }
  return parentAgent;
}

function resolveChildAgentCwd(params: {
  parentCwd: string;
  requestedCwd?: string;
  lockedCwd?: string;
  allowCustomCwd: boolean;
}): string {
  const lockedCwd = params.lockedCwd?.trim();
  if (lockedCwd) {
    return expandUserPath(lockedCwd);
  }

  const requestedCwd = params.requestedCwd?.trim();
  if (!requestedCwd || !params.allowCustomCwd) {
    return params.parentCwd;
  }

  return resolvePathFromBase(params.parentCwd, requestedCwd);
}

async function resolveMcpCwd(params: {
  dependencies: CreateAgentCommandDependencies;
  cwd: string;
  initialPrompt: string;
  worktree: CreateAgentFromMcpInput["worktree"];
}): Promise<{ resolvedCwd: string; setupContinuation?: AgentWorktreeSetupContinuation }> {
  const { dependencies, worktree } = params;
  if (!worktree) {
    return { resolvedCwd: params.cwd };
  }
  const shouldCreateWorktree = Boolean(
    worktree.worktreeName || worktree.refName || worktree.action || worktree.githubPrNumber,
  );
  if (!shouldCreateWorktree) {
    return { resolvedCwd: params.cwd };
  }
  if (
    worktree.worktreeName &&
    !worktree.baseBranch &&
    !worktree.refName &&
    !worktree.action &&
    worktree.githubPrNumber === undefined
  ) {
    throw new Error("baseBranch is required when creating a worktree");
  }
  const baseBranch = worktree.baseBranch;
  const createdWorktree = await createMcpWorktree({
    input: {
      cwd: params.cwd,
      worktreeSlug: worktree.worktreeName,
      refName: worktree.refName,
      action: worktree.action,
      githubPrNumber: worktree.githubPrNumber,
      ...(params.initialPrompt ? { firstAgentContext: { prompt: params.initialPrompt } } : {}),
      runSetup: false,
      chisacodeHome: dependencies.chisacodeHome,
    },
    createChisaCodeWorktree: dependencies.createChisaCodeWorktree,
    resolveDefaultBranch: baseBranch ? async () => baseBranch : undefined,
    setupContinuation: {
      kind: "agent",
      terminalManager: dependencies.terminalManager ?? null,
      appendTimelineItem: ({ agentId, item }) =>
        appendTimelineItemIfAgentKnown({
          agentManager: dependencies.agentManager,
          agentId,
          item,
        }),
      emitLiveTimelineItem: ({ agentId, item }) =>
        emitLiveTimelineItemIfAgentKnown({
          agentManager: dependencies.agentManager,
          agentId,
          item,
        }),
      logger: dependencies.logger,
    },
  });
  return {
    resolvedCwd: createdWorktree.worktree.worktreePath,
    setupContinuation: createdWorktree.setupContinuation,
  };
}

interface CreateMcpWorktreeOptions {
  input: CreateChisaCodeWorktreeInput;
  createChisaCodeWorktree: CreateChisaCodeWorktreeWorkflowFn | undefined;
  resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
  setupContinuation?: CreateChisaCodeWorktreeSetupContinuationInput;
}

async function createMcpWorktree(
  options: CreateMcpWorktreeOptions,
): Promise<CreateChisaCodeWorktreeWorkflowResult> {
  try {
    if (!options.createChisaCodeWorktree) {
      throw new Error("ChisaCode worktree service is not configured");
    }
    return await options.createChisaCodeWorktree(options.input, {
      ...(options.resolveDefaultBranch
        ? { resolveDefaultBranch: options.resolveDefaultBranch }
        : {}),
      ...(options.setupContinuation ? { setupContinuation: options.setupContinuation } : {}),
    });
  } catch (error) {
    throw toWorktreeRequestError(error);
  }
}

function mergeLabels(
  callerAgentId: string | undefined,
  childAgentDefaultLabels: Record<string, string> | undefined,
  labels: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const mergedLabels = {
    ...(callerAgentId ? { [PARENT_AGENT_ID_LABEL]: callerAgentId } : {}),
    ...childAgentDefaultLabels,
    ...labels,
  };
  return Object.keys(mergedLabels).length > 0 ? mergedLabels : undefined;
}

function resolveMcpRelation(
  callerAgentId: string | undefined,
  relationKind: AgentRelationKind | undefined,
): AgentRelation | undefined {
  if (!callerAgentId && !relationKind) {
    return undefined;
  }
  return {
    kind: relationKind ?? "subagent",
    ...(callerAgentId ? { parentAgentId: callerAgentId } : {}),
    source: "mcp",
  };
}
