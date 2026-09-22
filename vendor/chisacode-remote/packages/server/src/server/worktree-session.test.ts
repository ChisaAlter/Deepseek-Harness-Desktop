import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import pino, { type Logger } from "pino";

import type { SessionOutboundMessage, WorkspaceDescriptorPayload } from "./messages.js";
import { archiveChisaCodeWorktree } from "./chisacode-worktree-archive-service.js";
import {
  buildAgentSessionConfig,
  createChisaCodeWorktreeWorkflow,
  handleChisaCodeWorktreeArchiveRequest,
  handleChisaCodeWorktreeListRequest,
  resolveGitCreateBaseBranch,
  runWorktreeSetupInBackground,
  handleCreateChisaCodeWorktreeRequest,
  handleWorkspaceSetupStatusRequest,
} from "./worktree-session.js";
import {
  createWorktree as createWorktreePrimitive,
  type CreateWorktreeOptions,
  type WorktreeConfig,
} from "../utils/worktree.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { TerminalSession } from "../terminal/terminal.js";
import type { ManagedAgent } from "./agent/agent-manager.js";
import { WorkspaceMutationCoordinator } from "./workspace-mutation-coordinator.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "./workspace-registry.js";
import type { GitHubService } from "../services/github-service.js";
import {
  createChisaCodeWorktree as createChisaCodeWorktreeService,
  type CreateChisaCodeWorktreeFn,
} from "./chisacode-worktree-service.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import { isPlatform } from "../test-utils/platform.js";

interface LegacyCreateWorktreeTestOptions {
  branchName: string;
  cwd: string;
  baseBranch: string;
  worktreeSlug: string;
  runSetup?: boolean;
  chisacodeHome?: string;
}

function createLegacyWorktreeForTest(
  options: CreateWorktreeOptions | LegacyCreateWorktreeTestOptions,
): Promise<WorktreeConfig> {
  if ("source" in options) {
    return createWorktreePrimitive(options);
  }

  return createWorktreePrimitive({
    cwd: options.cwd,
    worktreeSlug: options.worktreeSlug,
    source: {
      kind: "branch-off",
      baseBranch: options.baseBranch,
      branchName: options.branchName,
    },
    runSetup: options.runSetup ?? true,
    chisacodeHome: options.chisacodeHome,
  });
}

function createLogger(): Logger {
  const logger = pino({ level: "silent" });
  vi.spyOn(logger, "info").mockImplementation(() => undefined);
  vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
  return logger;
}

function createWorkflowForRequestTest(options: {
  chisacodeHome: string;
  createChisaCodeWorktree?: CreateChisaCodeWorktreeFn;
  warmWorkspaceGitData?: (workspace: PersistedWorkspaceRecord) => Promise<void>;
  onSetupStarted?: (input: {
    requestCwd: string;
    repoRoot: string;
    workspaceId: string;
    worktree: WorktreeConfig;
    shouldBootstrap: boolean;
  }) => void;
}) {
  return async (input: Parameters<CreateChisaCodeWorktreeFn>[0]) => {
    const createChisaCodeWorktree =
      options.createChisaCodeWorktree ??
      createChisaCodeWorktreeForTest({ chisacodeHome: options.chisacodeHome });
    return createChisaCodeWorktreeWorkflow(
      {
        chisacodeHome: options.chisacodeHome,
        createChisaCodeWorktree,
        warmWorkspaceGitData: options.warmWorkspaceGitData ?? (async () => {}),
        emitWorkspaceUpdateForCwd: async () => {},
        cacheWorkspaceSetupSnapshot: () => {},
        emit: () => {},
        sessionLogger: createLogger(),
        terminalManager: null,
        archiveWorkspaceRecord: async () => {},
        scriptRouteStore: null,
        scriptRuntimeStore: null,
        getDaemonTcpPort: null,
        getDaemonTcpHost: null,
        onScriptsChanged: null,
      },
      input,
      { setupContinuation: { kind: "workspace" } },
    ).then((result) => {
      options.onSetupStarted?.({
        requestCwd: input.cwd,
        repoRoot: result.repoRoot,
        workspaceId: result.workspace.workspaceId,
        worktree: result.worktree,
        shouldBootstrap: result.created,
      });
      return result;
    });
  };
}

function createGitHubServiceStub(): GitHubService {
  return {
    listPullRequests: async () => [],
    listIssues: async () => [],
    searchIssuesAndPrs: async () => ({ items: [], githubFeaturesEnabled: true }),
    getPullRequest: async ({ number }) => ({
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/repo/pull/${number}`,
      state: "OPEN",
      body: null,
      baseRefName: "main",
      headRefName: `pr-${number}`,
      labels: [],
    }),
    getPullRequestHeadRef: async ({ number }) => `pr-${number}`,
    getCurrentPullRequestStatus: async () => null,
    createPullRequest: async () => ({
      number: 1,
      url: "https://github.com/acme/repo/pull/1",
    }),
    mergePullRequest: async () => ({ success: true }),
    isAuthenticated: async () => true,
    invalidate: () => {},
  };
}

function createTerminalManagerStub(options?: {
  createTerminal?: (input: {
    cwd: string;
    name?: string;
    env?: Record<string, string>;
  }) => Promise<TerminalSession>;
}) {
  const terminals: Array<{
    id: string;
    cwd: string;
    name: string | undefined;
    env: Record<string, string> | undefined;
    sent: string[];
  }> = [];

  return {
    terminals,
    manager: {
      registerCwdEnv: vi.fn(),
      createTerminal: vi.fn(
        async (input: { cwd: string; name?: string; env?: Record<string, string> }) => {
          if (options?.createTerminal) {
            return options.createTerminal(input);
          }
          const sent: string[] = [];
          const terminal = {
            id: `terminal-${terminals.length + 1}`,
            name: input.name ?? "Terminal",
            cwd: input.cwd,
            getState: () => ({
              rows: 1,
              cols: 1,
              scrollback: [[{ char: "$" }]],
              grid: [],
              cursor: { row: 0, col: 0 },
            }),
            subscribe: () => () => {},
            onExit: () => () => {},
            onCommandFinished: () => () => {},
            onTitleChange: () => () => {},
            send: (message: { type: string; data: string }) => {
              if (message.type === "input") {
                sent.push(message.data);
              }
            },
            kill: () => {},
            killAndWait: async () => {},
            getSize: () => ({ rows: 1, cols: 1 }),
            getTitle: () => undefined,
            getExitInfo: () => null,
          } satisfies TerminalSession;
          terminals.push({
            id: terminal.id,
            cwd: input.cwd,
            name: input.name,
            env: input.env,
            sent,
          });
          return terminal;
        },
      ),
      getTerminals: vi.fn(async () => []),
      getTerminal: vi.fn(() => undefined),
      killTerminal: vi.fn(),
      killTerminalAndWait: vi.fn(async () => {}),
      listDirectories: vi.fn(() => []),
      killAll: vi.fn(),
      subscribeTerminalsChanged: vi.fn(() => () => {}),
    } satisfies TerminalManager,
  };
}

function createWorkspaceDescriptor(input: {
  workspace: PersistedWorkspaceRecord;
  repoDir: string;
}): WorkspaceDescriptorPayload {
  return {
    id: input.workspace.workspaceId,
    projectId: input.workspace.projectId,
    projectDisplayName: path.basename(input.repoDir),
    projectRootPath: input.repoDir,
    workspaceDirectory: input.workspace.cwd,
    workspaceKind: "worktree",
    projectKind: "git",
    name: input.workspace.displayName,
    status: "done",
    activityAt: null,
    diffStat: null,
    scripts: [],
    gitRuntime: null,
    githubRuntime: null,
  };
}

function createChisaCodeWorktreeForTest(options: {
  chisacodeHome: string;
  events?: string[];
}): CreateChisaCodeWorktreeFn {
  const projects = new Map<string, PersistedProjectRecord>();
  const workspaces = new Map<string, PersistedWorkspaceRecord>();
  const workspaceGitService = new WorkspaceGitServiceImpl({
    logger: createLogger(),
    chisacodeHome: options.chisacodeHome,
    deps: {
      github: createGitHubServiceStub(),
    },
  });

  return (input, serviceOptions) => {
    return createChisaCodeWorktreeService(input, {
      github: createGitHubServiceStub(),
      ...(serviceOptions?.resolveDefaultBranch
        ? { resolveDefaultBranch: serviceOptions.resolveDefaultBranch }
        : {}),
      projectRegistry: {
        get: async (projectId) => projects.get(projectId) ?? null,
        upsert: async (record) => {
          options.events?.push(`project:${record.projectId}`);
          projects.set(record.projectId, record);
        },
      },
      workspaceRegistry: {
        get: async (workspaceId) => workspaces.get(workspaceId) ?? null,
        list: async () => Array.from(workspaces.values()),
        upsert: async (record) => {
          options.events?.push(`workspace:${record.workspaceId}`);
          workspaces.set(record.workspaceId, record);
        },
      },
      workspaceGitService,
    });
  };
}

function createManagedAgentForArchive(input: { id: string; cwd: string }): ManagedAgent {
  const now = new Date();
  return {
    id: input.id,
    provider: "codex",
    cwd: input.cwd,
    capabilities: {
      supportsStreaming: false,
      supportsSessionPersistence: false,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    config: { provider: "codex", cwd: input.cwd },
    createdAt: now,
    updatedAt: now,
    availableModes: [],
    currentModeId: null,
    pendingPermissions: new Map(),
    bufferedPermissionResolutions: new Map(),
    inFlightPermissionResponses: new Set(),
    pendingReplacement: false,
    persistence: null,
    historyPrimed: false,
    lastUserMessageAt: null,
    attention: { requiresAttention: false },
    foregroundTurnWaiters: new Set(),
    unsubscribeSession: null,
    labels: {},
    lifecycle: "closed",
    session: null,
    activeForegroundTurnId: null,
  };
}

describe("handleChisaCodeWorktreeListRequest", () => {
  test("lists worktrees through the workspace git service", async () => {
    const emitted: SessionOutboundMessage[] = [];
    const workspaceGitService = {
      listWorktrees: vi.fn().mockResolvedValue([
        {
          path: "/tmp/chisacode-home/worktrees/repo/feature",
          createdAt: "2026-04-12T00:00:00.000Z",
          branchName: "feature",
          head: "abc123",
        },
      ]),
    };

    await handleChisaCodeWorktreeListRequest(
      {
        emit: (message) => emitted.push(message),
        chisacodeHome: "/tmp/chisacode-home",
        workspaceGitService: workspaceGitService as unknown as WorkspaceGitService,
      },
      {
        type: "chisacode_worktree_list_request",
        cwd: "/tmp/repo",
        requestId: "request-worktrees",
      },
    );

    expect(workspaceGitService.listWorktrees).toHaveBeenCalledTimes(1);
    expect(workspaceGitService.listWorktrees).toHaveBeenCalledWith("/tmp/repo");
    expect(emitted).toContainEqual({
      type: "chisacode_worktree_list_response",
      payload: {
        worktrees: [
          {
            worktreePath: "/tmp/chisacode-home/worktrees/repo/feature",
            createdAt: "2026-04-12T00:00:00.000Z",
            branchName: "feature",
            head: "abc123",
          },
        ],
        error: null,
        requestId: "request-worktrees",
      },
    });
  });
});

describe("resolveGitCreateBaseBranch", () => {
  test("resolves the default branch through the workspace git service", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const cwd = path.join(repoDir, "packages", "app");
    const workspaceGitService = {
      resolveDefaultBranch: vi.fn().mockResolvedValue("main"),
      getSnapshot: vi.fn(async () => {
        throw new Error("getSnapshot should not be used for default-branch resolution");
      }),
    };

    try {
      await expect(
        resolveGitCreateBaseBranch(cwd, workspaceGitService as unknown as WorkspaceGitService),
      ).resolves.toBe("main");

      expect(workspaceGitService.resolveDefaultBranch).toHaveBeenCalledWith(cwd);
      expect(workspaceGitService.getSnapshot).not.toHaveBeenCalled();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("create-agent worktree setup boundary", () => {
  test("agent setup continuation starts setup for the created agent timeline", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const chisacodeHome = path.join(tempDir, ".chisacode");
    const appendedItems: Array<{ name: string; status: string }> = [];
    const liveItems: Array<{ name: string; status: string }> = [];
    const workspaceSetupEvents: SessionOutboundMessage[] = [];

    try {
      const result = await createChisaCodeWorktreeWorkflow(
        {
          chisacodeHome,
          createChisaCodeWorktree: createChisaCodeWorktreeForTest({ chisacodeHome }),
          warmWorkspaceGitData: async () => {},
          emitWorkspaceUpdateForCwd: async () => {},
          cacheWorkspaceSetupSnapshot: () => {},
          emit: (message) => workspaceSetupEvents.push(message),
          sessionLogger: createLogger(),
          terminalManager: null,
          archiveWorkspaceRecord: async () => {},
          scriptRouteStore: null,
          scriptRuntimeStore: null,
          getDaemonTcpPort: null,
          getDaemonTcpHost: null,
          onScriptsChanged: null,
        },
        {
          cwd: repoDir,
          worktreeSlug: "agent-setup-after-create",
          runSetup: false,
          chisacodeHome,
        },
        {
          setupContinuation: {
            kind: "agent",
            terminalManager: createTerminalManagerStub().manager,
            appendTimelineItem: async ({ agentId, item }) => {
              expect(agentId).toBe("agent-after-create");
              if (item.type !== "tool_call") {
                throw new Error(`Expected tool call timeline item, got ${item.type}`);
              }
              appendedItems.push({ name: item.name, status: item.status });
              return true;
            },
            emitLiveTimelineItem: async ({ agentId, item }) => {
              expect(agentId).toBe("agent-after-create");
              if (item.type !== "tool_call") {
                throw new Error(`Expected tool call timeline item, got ${item.type}`);
              }
              liveItems.push({ name: item.name, status: item.status });
              return true;
            },
            logger: createLogger(),
          },
        },
      );

      expect(result.setupContinuation?.kind).toBe("agent");
      expect(workspaceSetupEvents).toEqual([]);

      result.setupContinuation?.startAfterAgentCreate({ agentId: "agent-after-create" });

      await vi.waitFor(() => {
        expect(appendedItems).toContainEqual({
          name: "chisacode_worktree_setup",
          status: "completed",
        });
      });
      expect(liveItems).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function createAgentStorageStub(): Pick<AgentStorage, "list"> {
  return {
    list: async (): Promise<StoredAgentRecord[]> => [],
  };
}

function createWorkspaceArchivingDeps() {
  return {
    emitWorkspaceUpdatesForWorkspaceIds: vi.fn(async () => {}),
    markWorkspaceArchiving: vi.fn(),
    clearWorkspaceArchiving: vi.fn(),
  };
}

function createGitRepo(options?: { chisacodeConfig?: Record<string, unknown> }) {
  const tempDir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "worktree-session-test-")));
  const repoDir = path.join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir, stdio: "pipe" });
  writeFileSync(path.join(repoDir, "README.md"), "hello\n");
  if (options?.chisacodeConfig) {
    writeFileSync(
      path.join(repoDir, "chisacode.json"),
      JSON.stringify(options.chisacodeConfig, null, 2),
    );
  }
  execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  return { tempDir, repoDir };
}

function createGitHubPrRemoteRepo() {
  const { tempDir, repoDir } = createGitRepo();
  const featureBranch = "feature/review-pr";
  execFileSync("git", ["checkout", "-b", featureBranch], { cwd: repoDir, stdio: "pipe" });
  writeFileSync(path.join(repoDir, "README.md"), "review branch\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "review branch"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  const featureSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, stdio: "pipe" })
    .toString()
    .trim();
  execFileSync("git", ["checkout", "main"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["branch", "-D", featureBranch], { cwd: repoDir, stdio: "pipe" });

  const remoteDir = path.join(tempDir, "remote.git");
  execFileSync("git", ["clone", "--bare", repoDir, remoteDir], {
    stdio: "pipe",
  });
  execFileSync("git", [`--git-dir=${remoteDir}`, "update-ref", "refs/pull/123/head", featureSha], {
    stdio: "pipe",
  });
  execFileSync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["fetch", "origin"], { cwd: repoDir, stdio: "pipe" });

  return { tempDir, repoDir };
}

describe("runWorktreeSetupInBackground", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const target of cleanupPaths.splice(0)) {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("emits running then completed snapshots for no-setup workspaces without auto-starting scripts", async () => {
    const { tempDir, repoDir } = createGitRepo({
      chisacodeConfig: {
        scripts: {
          web: {
            command: "npm run dev",
          },
        },
      },
    });
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const createdWorktree = await createLegacyWorktreeForTest({
      branchName: "feature-no-setup",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "feature-no-setup",
      runSetup: false,
      chisacodeHome,
    });
    const worktreePath = createdWorktree.worktreePath;
    const emitted: SessionOutboundMessage[] = [];
    const snapshots = new Map<string, unknown>();
    const logger = createLogger();
    const terminalManager = createTerminalManagerStub();
    const emitWorkspaceUpdateForCwd = vi.fn(async () => {});
    const archiveWorkspaceRecord = vi.fn(async () => {});

    await runWorktreeSetupInBackground(
      {
        chisacodeHome,
        emitWorkspaceUpdateForCwd,
        cacheWorkspaceSetupSnapshot: (workspaceId, snapshot) =>
          snapshots.set(workspaceId, snapshot),
        emit: (message) => emitted.push(message),
        sessionLogger: logger,
        terminalManager: terminalManager.manager,
        archiveWorkspaceRecord,
      },
      {
        requestCwd: repoDir,
        repoRoot: repoDir,
        workspaceId: "42",
        worktree: {
          branchName: "feature-no-setup",
          worktreePath,
        },
        shouldBootstrap: true,
        slug: "feature-no-setup",
        worktreePath,
      },
    );

    const progressMessages = emitted.filter(
      (message): message is Extract<SessionOutboundMessage, { type: "workspace_setup_progress" }> =>
        message.type === "workspace_setup_progress",
    );
    expect(progressMessages).toHaveLength(2);
    expect(progressMessages[0]?.payload).toMatchObject({
      workspaceId: "42",
      status: "running",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath,
        branchName: "feature-no-setup",
        log: "",
        commands: [],
      },
    });
    expect(progressMessages[1]?.payload).toMatchObject({
      workspaceId: "42",
      status: "completed",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath,
        branchName: "feature-no-setup",
        log: "",
        commands: [],
      },
    });
    expect(snapshots.get("42")).toMatchObject({
      status: "completed",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath,
        branchName: "feature-no-setup",
        log: "",
        commands: [],
      },
    });

    expect(terminalManager.terminals).toHaveLength(0);
    expect(archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(emitWorkspaceUpdateForCwd).toHaveBeenCalledWith(worktreePath);
  });

  test("archives the pending workspace and emits a failed snapshot when setup cannot start", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);

    writeFileSync(path.join(repoDir, "chisacode.json"), "{ invalid json\n");
    execFileSync("git", ["add", "chisacode.json"], { cwd: repoDir, stdio: "pipe" });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "broken config"], {
      cwd: repoDir,
      stdio: "pipe",
    });

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const createdWorktree = await createLegacyWorktreeForTest({
      branchName: "broken-feature",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "broken-feature",
      runSetup: false,
      chisacodeHome,
    });
    const worktreePath = createdWorktree.worktreePath;
    const emitted: SessionOutboundMessage[] = [];
    const snapshots = new Map<string, unknown>();
    const logger = createLogger();
    const emitWorkspaceUpdateForCwd = vi.fn(async () => {});
    const archiveWorkspaceRecord = vi.fn(async () => {});
    const workspaceId = "ws-broken-feature";

    await runWorktreeSetupInBackground(
      {
        chisacodeHome,
        emitWorkspaceUpdateForCwd,
        cacheWorkspaceSetupSnapshot: (snapshotWorkspaceId, snapshot) =>
          snapshots.set(snapshotWorkspaceId, snapshot),
        emit: (message) => emitted.push(message),
        sessionLogger: logger,
        terminalManager: null,
        archiveWorkspaceRecord,
      },
      {
        requestCwd: repoDir,
        repoRoot: repoDir,
        workspaceId,
        worktree: {
          branchName: "broken-feature",
          worktreePath,
        },
        shouldBootstrap: true,
        slug: "broken-feature",
        worktreePath,
      },
    );

    const progressMessages = emitted.filter(
      (message): message is Extract<SessionOutboundMessage, { type: "workspace_setup_progress" }> =>
        message.type === "workspace_setup_progress",
    );
    expect(progressMessages).toHaveLength(2);
    expect(progressMessages[0]?.payload.status).toBe("running");
    expect(progressMessages[0]?.payload.error).toBeNull();
    expect(progressMessages[1]?.payload.status).toBe("failed");
    expect(progressMessages[1]?.payload.error).toMatch(
      /Failed to parse project config at .*chisacode\.json/,
    );
    expect(progressMessages[1]?.payload.detail.commands).toEqual([]);
    expect(snapshots.get(workspaceId)).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/Failed to parse project config at .*chisacode\.json/),
    });
    expect(archiveWorkspaceRecord).toHaveBeenCalledWith(workspaceId);
    expect(emitWorkspaceUpdateForCwd).toHaveBeenCalledWith(worktreePath);
  });

  // POSIX-only: setup command is hardcoded to sh, printf, and sleep.
  test.skipIf(isPlatform("win32"))(
    "emits running setup snapshots before completed for real setup commands",
    async () => {
      const { tempDir, repoDir } = createGitRepo({
        chisacodeConfig: {
          worktree: {
            setup: ["sh -c \"printf 'phase-one\\\\n'; sleep 0.1; printf 'phase-two\\\\n'\""],
          },
        },
      });
      cleanupPaths.push(tempDir);

      const chisacodeHome = path.join(tempDir, ".chisacode");
      const createdWorktree = await createLegacyWorktreeForTest({
        branchName: "feature-running-setup",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "feature-running-setup",
        runSetup: false,
        chisacodeHome,
      });
      const worktreePath = createdWorktree.worktreePath;
      const emitted: SessionOutboundMessage[] = [];
      const snapshots = new Map<string, unknown>();
      const logger = createLogger();
      const emitWorkspaceUpdateForCwd = vi.fn(async () => {});
      const archiveWorkspaceRecord = vi.fn(async () => {});

      await runWorktreeSetupInBackground(
        {
          chisacodeHome,
          emitWorkspaceUpdateForCwd,
          cacheWorkspaceSetupSnapshot: (workspaceId, snapshot) =>
            snapshots.set(workspaceId, snapshot),
          emit: (message) => emitted.push(message),
          sessionLogger: logger,
          terminalManager: null,
          archiveWorkspaceRecord,
        },
        {
          requestCwd: repoDir,
          repoRoot: repoDir,
          workspaceId: "43",
          worktree: {
            branchName: "feature-running-setup",
            worktreePath,
          },
          shouldBootstrap: true,
          slug: "feature-running-setup",
          worktreePath,
        },
      );

      const progressMessages = emitted.filter(
        (
          message,
        ): message is Extract<SessionOutboundMessage, { type: "workspace_setup_progress" }> =>
          message.type === "workspace_setup_progress",
      );
      expect(progressMessages.length).toBeGreaterThan(1);
      expect(progressMessages[0]?.payload).toMatchObject({
        workspaceId: "43",
        status: "running",
        error: null,
        detail: {
          type: "worktree_setup",
          worktreePath,
          branchName: "feature-running-setup",
          log: "",
          commands: [],
        },
      });
      expect(progressMessages.at(-1)?.payload.status).toBe("completed");

      const runningMessages = progressMessages.filter(
        (message) => message.payload.status === "running",
      );
      expect(runningMessages.length).toBeGreaterThan(0);
      expect(
        progressMessages.findIndex((message) => message.payload.status === "running"),
      ).toBeLessThan(
        progressMessages.findIndex((message) => message.payload.status === "completed"),
      );

      const setupOutputMessage = runningMessages.find((message) =>
        message.payload.detail.commands[0]?.log.includes("phase-one"),
      );
      expect(setupOutputMessage?.payload.detail.log).toContain("phase-one");
      expect(setupOutputMessage?.payload.detail.commands[0]).toMatchObject({
        index: 1,
        command: "sh -c \"printf 'phase-one\\\\n'; sleep 0.1; printf 'phase-two\\\\n'\"",
        log: expect.stringContaining("phase-one"),
        status: "running",
      });

      expect(progressMessages.at(-1)?.payload).toMatchObject({
        workspaceId: "43",
        status: "completed",
        error: null,
        detail: {
          type: "worktree_setup",
          worktreePath,
          branchName: "feature-running-setup",
        },
      });
      expect(progressMessages.at(-1)?.payload.detail.log).toContain("phase-two");
      expect(progressMessages.at(-1)?.payload.detail.commands[0]).toMatchObject({
        index: 1,
        command: "sh -c \"printf 'phase-one\\\\n'; sleep 0.1; printf 'phase-two\\\\n'\"",
        log: expect.stringContaining("phase-two"),
        status: "completed",
        exitCode: 0,
      });
      expect(snapshots.get("43")).toMatchObject({
        status: "completed",
        error: null,
      });
    },
  );

  test("emits completed when reusing an existing worktree without bootstrapping or auto-starting scripts", async () => {
    const { tempDir, repoDir } = createGitRepo({
      chisacodeConfig: {
        worktree: {
          setup: ["printf 'ran' > setup-ran.txt"],
        },
        scripts: {
          web: {
            command: "npm run dev",
          },
        },
      },
    });
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const existingWorktree = await createLegacyWorktreeForTest({
      branchName: "reused-worktree",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "reused-worktree",
      runSetup: false,
      chisacodeHome,
    });

    const emitted: SessionOutboundMessage[] = [];
    const snapshots = new Map<string, unknown>();
    const logger = createLogger();
    const terminalManager = createTerminalManagerStub();
    const emitWorkspaceUpdateForCwd = vi.fn(async () => {});
    const archiveWorkspaceRecord = vi.fn(async () => {});

    await runWorktreeSetupInBackground(
      {
        chisacodeHome,
        emitWorkspaceUpdateForCwd,
        cacheWorkspaceSetupSnapshot: (workspaceId, snapshot) =>
          snapshots.set(workspaceId, snapshot),
        emit: (message) => emitted.push(message),
        sessionLogger: logger,
        terminalManager: terminalManager.manager,
        archiveWorkspaceRecord,
      },
      {
        requestCwd: repoDir,
        repoRoot: repoDir,
        workspaceId: "44",
        worktree: {
          branchName: "reused-worktree",
          worktreePath: existingWorktree.worktreePath,
        },
        shouldBootstrap: false,
        slug: "reused-worktree",
        worktreePath: existingWorktree.worktreePath,
      },
    );

    const progressMessages = emitted.filter(
      (message): message is Extract<SessionOutboundMessage, { type: "workspace_setup_progress" }> =>
        message.type === "workspace_setup_progress",
    );
    expect(progressMessages).toHaveLength(2);
    expect(progressMessages[0]?.payload).toMatchObject({
      workspaceId: "44",
      status: "running",
      error: null,
    });
    expect(progressMessages[1]?.payload).toMatchObject({
      workspaceId: "44",
      status: "completed",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath: existingWorktree.worktreePath,
        branchName: "reused-worktree",
        log: "",
        commands: [],
      },
    });
    expect(terminalManager.terminals).toHaveLength(0);
    expect(readFileSync(path.join(existingWorktree.worktreePath, "README.md"), "utf8")).toContain(
      "hello",
    );
    expect(() =>
      readFileSync(path.join(existingWorktree.worktreePath, "setup-ran.txt"), "utf8"),
    ).toThrow();
    expect(snapshots.get("44")).toMatchObject({
      status: "completed",
      error: null,
    });
    expect(archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(emitWorkspaceUpdateForCwd).toHaveBeenCalledWith(existingWorktree.worktreePath);
  });

  test("keeps setup completed without attempting script launch afterward", async () => {
    const { tempDir, repoDir } = createGitRepo({
      chisacodeConfig: {
        scripts: {
          web: {
            command: "npm run dev",
          },
        },
      },
    });
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const createdWorktree = await createLegacyWorktreeForTest({
      branchName: "feature-service-failure",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "feature-service-failure",
      runSetup: false,
      chisacodeHome,
    });
    const worktreePath = createdWorktree.worktreePath;
    const emitted: SessionOutboundMessage[] = [];
    const snapshots = new Map<string, unknown>();
    const logger = createLogger();
    const terminalManager = createTerminalManagerStub({
      createTerminal: async () => {
        throw new Error("terminal spawn failed");
      },
    });
    const emitWorkspaceUpdateForCwd = vi.fn(async () => {});
    const archiveWorkspaceRecord = vi.fn(async () => {});

    await runWorktreeSetupInBackground(
      {
        chisacodeHome,
        emitWorkspaceUpdateForCwd,
        cacheWorkspaceSetupSnapshot: (workspaceId, snapshot) =>
          snapshots.set(workspaceId, snapshot),
        emit: (message) => emitted.push(message),
        sessionLogger: logger,
        terminalManager: terminalManager.manager,
        archiveWorkspaceRecord,
      },
      {
        requestCwd: repoDir,
        repoRoot: repoDir,
        workspaceId: "45",
        worktree: {
          branchName: "feature-service-failure",
          worktreePath,
        },
        shouldBootstrap: true,
        slug: "feature-service-failure",
        worktreePath,
      },
    );

    const progressMessages = emitted.filter(
      (message): message is Extract<SessionOutboundMessage, { type: "workspace_setup_progress" }> =>
        message.type === "workspace_setup_progress",
    );
    expect(progressMessages).toHaveLength(2);
    expect(progressMessages[0]?.payload.status).toBe("running");
    expect(progressMessages[0]?.payload.error).toBeNull();
    expect(progressMessages[1]?.payload.status).toBe("completed");
    expect(progressMessages[1]?.payload.error).toBeNull();
    expect(
      emitted.some(
        (message) =>
          message.type === "workspace_setup_progress" && message.payload.status === "failed",
      ),
    ).toBe(false);
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.anything(),
      "Failed to spawn worktree scripts after workspace setup completed",
    );
    expect(terminalManager.terminals).toHaveLength(0);
    expect(snapshots.get("45")).toMatchObject({
      status: "completed",
      error: null,
    });
    expect(archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(emitWorkspaceUpdateForCwd).toHaveBeenCalledWith(worktreePath);
  });

  test("does not auto-start scripts in socket mode", async () => {
    const { tempDir, repoDir } = createGitRepo({
      chisacodeConfig: {
        scripts: {
          web: {
            command: "npm run dev",
          },
        },
      },
    });
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const createdWorktree = await createLegacyWorktreeForTest({
      branchName: "feature-socket-mode",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "feature-socket-mode",
      runSetup: false,
      chisacodeHome,
    });
    const worktreePath = createdWorktree.worktreePath;
    const emitted: SessionOutboundMessage[] = [];
    const snapshots = new Map<string, unknown>();
    const logger = createLogger();
    const terminalManager = createTerminalManagerStub();
    const emitWorkspaceUpdateForCwd = vi.fn(async () => {});
    const archiveWorkspaceRecord = vi.fn(async () => {});

    await runWorktreeSetupInBackground(
      {
        chisacodeHome,
        emitWorkspaceUpdateForCwd,
        cacheWorkspaceSetupSnapshot: (workspaceId, snapshot) =>
          snapshots.set(workspaceId, snapshot),
        emit: (message) => emitted.push(message),
        sessionLogger: logger,
        terminalManager: terminalManager.manager,
        archiveWorkspaceRecord,
      },
      {
        requestCwd: repoDir,
        repoRoot: repoDir,
        workspaceId: "46",
        worktree: {
          branchName: "feature-socket-mode",
          worktreePath,
        },
        shouldBootstrap: true,
        slug: "feature-socket-mode",
        worktreePath,
      },
    );

    expect(terminalManager.terminals).toHaveLength(0);
    expect(snapshots.get("46")).toMatchObject({
      status: "completed",
      error: null,
    });
    expect(archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(emitWorkspaceUpdateForCwd).toHaveBeenCalledWith(worktreePath);
  });

  test("returns the cached workspace setup snapshot for status requests", async () => {
    const emitted: SessionOutboundMessage[] = [];
    const snapshots = new Map([
      [
        "ws-feature-a",
        {
          status: "completed",
          detail: {
            type: "worktree_setup",
            worktreePath: "/repo/.chisacode/worktrees/feature-a",
            branchName: "feature-a",
            log: "done",
            commands: [],
          },
          error: null,
        },
      ],
    ]);

    await handleWorkspaceSetupStatusRequest(
      {
        emit: (message) => emitted.push(message),
        workspaceSetupSnapshots: snapshots,
      },
      {
        type: "workspace_setup_status_request",
        workspaceId: "ws-feature-a",
        requestId: "req-status",
      },
    );

    expect(emitted).toContainEqual({
      type: "workspace_setup_status_response",
      payload: {
        requestId: "req-status",
        workspaceId: "ws-feature-a",
        snapshot: {
          status: "completed",
          detail: {
            type: "worktree_setup",
            worktreePath: "/repo/.chisacode/worktrees/feature-a",
            branchName: "feature-a",
            log: "done",
            commands: [],
          },
          error: null,
        },
      },
    });
  });

  test("returns null when no cached workspace setup snapshot exists", async () => {
    const emitted: SessionOutboundMessage[] = [];

    await handleWorkspaceSetupStatusRequest(
      {
        emit: (message) => emitted.push(message),
        workspaceSetupSnapshots: new Map(),
      },
      {
        type: "workspace_setup_status_request",
        workspaceId: "ws-missing",
        requestId: "req-missing",
      },
    );

    expect(emitted).toContainEqual({
      type: "workspace_setup_status_response",
      payload: {
        requestId: "req-missing",
        workspaceId: "ws-missing",
        snapshot: null,
      },
    });
  });
});

describe("handleCreateChisaCodeWorktreeRequest", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const target of cleanupPaths.splice(0)) {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("checks out the GitHub PR branch when githubPrNumber is supplied", async () => {
    const { tempDir, repoDir } = createGitHubPrRemoteRepo();
    cleanupPaths.push(tempDir);

    const emitted: SessionOutboundMessage[] = [];
    const logger = createLogger();
    const chisacodeHome = path.join(tempDir, ".chisacode");

    await handleCreateChisaCodeWorktreeRequest(
      {
        chisacodeHome,
        describeWorkspaceRecord: async (result) =>
          createWorkspaceDescriptor({ workspace: result.workspace, repoDir }),
        emit: (message) => emitted.push(message),
        sessionLogger: logger,
        createChisaCodeWorktreeWorkflow: createWorkflowForRequestTest({ chisacodeHome }),
      },
      {
        type: "create_chisacode_worktree_request",
        requestId: "req-pr-worktree",
        cwd: repoDir,
        worktreeSlug: "review-pr-123",
        action: "checkout",
        githubPrNumber: 123,
        refName: "feature/review-pr",
      },
    );

    const response = emitted.find(
      (
        message,
      ): message is Extract<
        SessionOutboundMessage,
        { type: "create_chisacode_worktree_response" }
      > => message.type === "create_chisacode_worktree_response",
    );

    expect(response?.payload.error).toBeNull();
    expect(response?.payload.workspace?.workspaceDirectory).toBeTruthy();

    const worktreePath = response?.payload.workspace?.workspaceDirectory;
    expect(worktreePath).toBeTruthy();
    if (!worktreePath) {
      return;
    }

    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: worktreePath,
      stdio: "pipe",
    })
      .toString()
      .trim();
    expect(branch).toBe("feature/review-pr");

    const readme = readFileSync(path.join(worktreePath, "README.md"), "utf8");
    expect(readme).toContain("review branch");
  });

  test("buildAgentSessionConfig checks out the GitHub PR branch for agent worktrees", async () => {
    const { tempDir, repoDir } = createGitHubPrRemoteRepo();
    cleanupPaths.push(tempDir);
    const events: string[] = [];

    const result = await buildAgentSessionConfig(
      {
        chisacodeHome: path.join(tempDir, ".chisacode"),
        sessionLogger: createLogger(),
        workspaceGitService: {
          resolveRepoRoot: vi.fn(async () => repoDir),
          resolveDefaultBranch: vi.fn(async () => "main"),
        } as unknown as WorkspaceGitService,
        createChisaCodeWorktree: createChisaCodeWorktreeForTest({
          chisacodeHome: path.join(tempDir, ".chisacode"),
          events,
        }),
        checkoutExistingBranch: async () => {
          throw new Error("should not checkout existing branch");
        },
        createBranchFromBase: async () => {
          throw new Error("should not create a new branch from base");
        },
      },
      {
        provider: "codex",
        cwd: repoDir,
      },
      {
        createWorktree: true,
        worktreeSlug: "agent-review-pr-123",
        action: "checkout",
        githubPrNumber: 123,
        refName: "feature/review-pr",
      },
    );

    expect(result.sessionConfig.cwd).toContain("agent-review-pr-123");
    expect(events.some((event) => event.startsWith("workspace:"))).toBe(true);

    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: result.sessionConfig.cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    expect(branch).toBe("feature/review-pr");
  });

  test("buildAgentSessionConfig uses the normalized new branch name as the worktree slug fallback", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);
    const chisacodeHome = path.join(tempDir, ".chisacode");

    const result = await buildAgentSessionConfig(
      {
        chisacodeHome,
        sessionLogger: createLogger(),
        workspaceGitService: {
          resolveRepoRoot: vi.fn(async () => repoDir),
          resolveDefaultBranch: vi.fn(async () => "main"),
        } as unknown as WorkspaceGitService,
        createChisaCodeWorktree: createChisaCodeWorktreeForTest({ chisacodeHome }),
        checkoutExistingBranch: async () => {
          throw new Error("should not checkout existing branch");
        },
        createBranchFromBase: async () => {
          throw new Error("should not create a branch outside the worktree service");
        },
      },
      {
        provider: "codex",
        cwd: repoDir,
      },
      {
        createWorktree: true,
        createNewBranch: true,
        newBranchName: "feature-x",
      },
    );

    expect(path.basename(result.sessionConfig.cwd)).toBe("feature-x");
  });

  test("buildAgentSessionConfig passes prompt and attachment context into worktree creation", async () => {
    const createChisaCodeWorktree = vi.fn(async () => ({
      worktree: {
        branchName: "fix-attached-pr-context",
        worktreePath: "/tmp/worktrees/fix-attached-pr-context",
      },
      intent: {
        kind: "branch-off" as const,
        baseBranch: "main",
        branchName: "fix-attached-pr-context",
      },
      workspace: {
        workspaceId: "/tmp/worktrees/fix-attached-pr-context",
        projectId: "/tmp/repo",
        cwd: "/tmp/worktrees/fix-attached-pr-context",
        kind: "worktree" as const,
        displayName: "fix-attached-pr-context",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
        archivedAt: null,
      },
      repoRoot: "/tmp/repo",
      created: true,
    }));
    const firstAgentContext = {
      prompt: "Create a worktree name from this prompt",
      attachments: [
        {
          type: "github_pr" as const,
          mimeType: "application/github-pr",
          number: 123,
          title: "Fix worktree naming",
          url: "https://github.com/getchisacode/chisacode/pull/123",
          baseRefName: "main",
          headRefName: "fix/worktree-naming",
        },
      ],
    };

    const result = await buildAgentSessionConfig(
      {
        sessionLogger: createLogger(),
        workspaceGitService: {
          resolveDefaultBranch: vi.fn(async () => "main"),
        } as unknown as WorkspaceGitService,
        createChisaCodeWorktree,
        checkoutExistingBranch: async () => {
          throw new Error("should not checkout existing branch");
        },
        createBranchFromBase: async () => {
          throw new Error("should not create a branch outside the worktree service");
        },
      },
      {
        provider: "codex",
        cwd: "/tmp/repo",
      },
      {
        createWorktree: true,
        action: "branch-off",
      },
      undefined,
      firstAgentContext,
    );

    expect(createChisaCodeWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        firstAgentContext,
      }),
      expect.anything(),
    );
    expect(result.sessionConfig.cwd).toBe("/tmp/worktrees/fix-attached-pr-context");
  });

  test("buildAgentSessionConfig invalidates GitHub cache after branch setup mutations", async () => {
    const invalidate = vi.fn();
    const createBranchFromBase = vi.fn(async () => {});
    const checkoutExistingBranch = vi.fn(async () => ({ source: "local" as const }));
    const createChisaCodeWorktree = vi.fn(async () => {
      throw new Error("should not create worktree");
    });

    await buildAgentSessionConfig(
      {
        sessionLogger: createLogger(),
        createChisaCodeWorktree,
        checkoutExistingBranch,
        createBranchFromBase,
        github: { invalidate },
      },
      {
        provider: "codex",
        cwd: "/tmp/repo",
      },
      {
        createNewBranch: true,
        baseBranch: "main",
        newBranchName: "feature-x",
      },
    );

    expect(createBranchFromBase).toHaveBeenCalledWith({
      cwd: "/tmp/repo",
      baseBranch: "main",
      newBranchName: "feature-x",
    });
    expect(invalidate).toHaveBeenCalledWith({ cwd: "/tmp/repo" });

    invalidate.mockClear();

    await buildAgentSessionConfig(
      {
        sessionLogger: createLogger(),
        createChisaCodeWorktree,
        checkoutExistingBranch,
        createBranchFromBase,
        github: { invalidate },
      },
      {
        provider: "codex",
        cwd: "/tmp/repo",
      },
      {
        baseBranch: "release",
      },
    );

    expect(checkoutExistingBranch).toHaveBeenCalledWith("/tmp/repo", "release");
    expect(invalidate).toHaveBeenCalledWith({ cwd: "/tmp/repo" });
  });

  test("createChisaCodeWorktreeForTest forwards the default branch resolver for branch-off intents", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);
    const chisacodeHome = path.join(tempDir, ".chisacode");
    const resolveDefaultBranch = vi.fn(async () => "main");

    const result = await createChisaCodeWorktreeForTest({ chisacodeHome })(
      {
        cwd: repoDir,
        worktreeSlug: "resolver-feature",
        action: "branch-off",
        runSetup: false,
        chisacodeHome,
      },
      { resolveDefaultBranch },
    );

    expect(result.intent).toMatchObject({
      kind: "branch-off",
      baseBranch: "main",
      branchName: "resolver-feature",
    });
    const resolvedCwd = resolveDefaultBranch.mock.calls[0]?.[0];
    expect(resolvedCwd).toBeDefined();
    expect(realpathSync.native(resolvedCwd ?? "")).toBe(realpathSync.native(repoDir));
  });
});

describe("handleCreateChisaCodeWorktreeRequest", () => {
  test("registers a pending workspace and emits a successful create response", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const chisacodeHome = path.join(tempDir, ".chisacode");
    const emitted: SessionOutboundMessage[] = [];
    const events: string[] = [];

    try {
      await handleCreateChisaCodeWorktreeRequest(
        {
          chisacodeHome,
          sessionLogger: createLogger(),
          emit: (message) => emitted.push(message),
          createChisaCodeWorktreeWorkflow: createWorkflowForRequestTest({
            chisacodeHome,
            createChisaCodeWorktree: createChisaCodeWorktreeForTest({ chisacodeHome, events }),
          }),
          describeWorkspaceRecord: vi.fn(async (result) => ({
            id: result.workspace.workspaceId,
            projectId: result.workspace.projectId,
            projectDisplayName: path.basename(repoDir),
            projectRootPath: repoDir,
            projectKind: "git",
            workspaceKind: "worktree",
            name: "single-call",
            status: "done",
            activityAt: null,
            diffStat: { additions: 0, deletions: 0 },
            scripts: [],
            gitRuntime: {
              currentBranch: "single-call",
              remoteUrl: null,
              isChisaCodeOwnedWorktree: true,
              isDirty: false,
              aheadBehind: null,
              aheadOfOrigin: null,
              behindOfOrigin: null,
            },
            githubRuntime: null,
          })),
        },
        {
          type: "create_chisacode_worktree_request",
          cwd: repoDir,
          worktreeSlug: "single-call",
          requestId: "req-single-call",
        },
      );

      expect(events.some((event) => event.startsWith("workspace:"))).toBe(true);
      const response = emitted.find(
        (
          message,
        ): message is Extract<
          SessionOutboundMessage,
          { type: "create_chisacode_worktree_response" }
        > => message.type === "create_chisacode_worktree_response",
      );
      expect(response?.payload.error).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("creates the worktree before emitting the response", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const chisacodeHome = path.join(tempDir, ".chisacode");
    const emitted: SessionOutboundMessage[] = [];
    const backgroundWork = vi.fn(async () => {});
    const warmWorkspaceGitData = vi.fn(async () => {});
    let registeredWorktreePath: string | null = null;

    try {
      await handleCreateChisaCodeWorktreeRequest(
        {
          chisacodeHome,
          sessionLogger: createLogger(),
          emit: (message) => emitted.push(message),
          createChisaCodeWorktreeWorkflow: createWorkflowForRequestTest({
            chisacodeHome,
            createChisaCodeWorktree: async (input) => {
              const result = await createChisaCodeWorktreeForTest({ chisacodeHome })(input);
              expect(existsSync(result.worktree.worktreePath)).toBe(true);
              registeredWorktreePath = result.worktree.worktreePath;
              return result;
            },
            warmWorkspaceGitData,
            onSetupStarted: backgroundWork,
          }),
          describeWorkspaceRecord: vi.fn(async (result) =>
            createWorkspaceDescriptor({ workspace: result.workspace, repoDir }),
          ),
        },
        {
          type: "create_chisacode_worktree_request",
          cwd: repoDir,
          worktreeSlug: "response-after-create",
          requestId: "req-1",
        },
      );

      const response = emitted.find(
        (
          message,
        ): message is Extract<
          SessionOutboundMessage,
          { type: "create_chisacode_worktree_response" }
        > => message.type === "create_chisacode_worktree_response",
      );
      expect(response?.payload.error).toBeNull();
      expect(response?.payload.workspace?.id).toBeTruthy();
      expect(emitted.map((message) => message.type).slice(0, 2)).toEqual([
        "create_chisacode_worktree_response",
        "workspace_update",
      ]);
      const workspaceUpdate = emitted[1];
      expect(workspaceUpdate).toMatchObject({
        type: "workspace_update",
        payload: {
          kind: "upsert",
          workspace: response?.payload.workspace,
        },
      });
      expect(registeredWorktreePath).toBeTruthy();
      expect(existsSync(registeredWorktreePath!)).toBe(true);
      await vi.waitFor(
        () => {
          expect(warmWorkspaceGitData).toHaveBeenCalledWith(
            expect.objectContaining({
              workspaceId: response?.payload.workspace?.id,
              cwd: registeredWorktreePath,
            }),
          );
        },
        { timeout: 1000 },
      );
      const backgroundInput = backgroundWork.mock.calls[0]?.[0];
      expect(backgroundInput).toEqual(
        expect.objectContaining({
          requestCwd: repoDir,
          worktree: {
            branchName: "response-after-create",
            worktreePath: registeredWorktreePath,
          },
          shouldBootstrap: true,
        }),
      );
      expect(realpathSync.native(backgroundInput?.repoRoot ?? "")).toBe(
        realpathSync.native(repoDir),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("emits a machine-readable error code for invalid worktree intent", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const chisacodeHome = path.join(tempDir, ".chisacode");
    const emitted: SessionOutboundMessage[] = [];

    try {
      await handleCreateChisaCodeWorktreeRequest(
        {
          chisacodeHome,
          sessionLogger: createLogger(),
          emit: (message) => emitted.push(message),
          createChisaCodeWorktreeWorkflow: createWorkflowForRequestTest({ chisacodeHome }),
          describeWorkspaceRecord: vi.fn(async (result) =>
            createWorkspaceDescriptor({ workspace: result.workspace, repoDir }),
          ),
        },
        {
          type: "create_chisacode_worktree_request",
          cwd: repoDir,
          action: "checkout",
          requestId: "req-missing-target",
        },
      );

      const response = emitted.find(
        (
          message,
        ): message is Extract<
          SessionOutboundMessage,
          { type: "create_chisacode_worktree_response" }
        > => message.type === "create_chisacode_worktree_response",
      );
      expect(response?.payload.workspace).toBeNull();
      expect(response?.payload.error).toBe('action "checkout" requires refName or githubPrNumber');
      expect(response?.payload.errorCode).toBe("missing_checkout_target");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("emits a machine-readable error code for unknown checkout branches", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const chisacodeHome = path.join(tempDir, ".chisacode");
    const emitted: SessionOutboundMessage[] = [];

    try {
      await handleCreateChisaCodeWorktreeRequest(
        {
          chisacodeHome,
          sessionLogger: createLogger(),
          emit: (message) => emitted.push(message),
          createChisaCodeWorktreeWorkflow: createWorkflowForRequestTest({ chisacodeHome }),
          describeWorkspaceRecord: vi.fn(async (result) =>
            createWorkspaceDescriptor({ workspace: result.workspace, repoDir }),
          ),
        },
        {
          type: "create_chisacode_worktree_request",
          cwd: repoDir,
          action: "checkout",
          refName: "missing-branch",
          requestId: "req-unknown-branch",
        },
      );

      const response = emitted.find(
        (
          message,
        ): message is Extract<
          SessionOutboundMessage,
          { type: "create_chisacode_worktree_response" }
        > => message.type === "create_chisacode_worktree_response",
      );
      expect(response?.payload.workspace).toBeNull();
      expect(response?.payload.error).toBe("Unknown branch: missing-branch");
      expect(response?.payload.errorCode).toBe("unknown_branch");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("archiveChisaCodeWorktree", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const target of cleanupPaths.splice(0)) {
      rmSync(target, { recursive: true, force: true });
    }
  });

  function createIsPathWithinRoot() {
    return (rootPath: string, candidatePath: string) => {
      const normalizedRoot = path.resolve(rootPath);
      const normalizedCandidate = path.resolve(candidatePath);
      return (
        normalizedCandidate === normalizedRoot ||
        normalizedCandidate.startsWith(normalizedRoot + path.sep)
      );
    };
  }

  test("runs agent close and terminal teardown concurrently and removes the worktree", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const created = await createLegacyWorktreeForTest({
      branchName: "archive-parallel",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "archive-parallel",
      runSetup: false,
      chisacodeHome,
    });

    const teardownStartTimes: Record<string, number> = {};
    const teardownEndTimes: Record<string, number> = {};
    const archiveAgentSpy = vi.fn(async (agentId: string) => {
      teardownStartTimes[agentId] = Date.now();
      // FIXME: keep setTimeout — simulates realistic agent archive I/O latency for concurrency test
      await new Promise((resolve) => setTimeout(resolve, 100));
      teardownEndTimes[agentId] = Date.now();
      return { archivedAt: new Date().toISOString() };
    });
    const archiveSnapshotSpy = vi.fn(async () => {
      throw new Error("not expected for live agents");
    });
    const killTerminalsUnderPath = vi.fn(async () => {
      teardownStartTimes.__terminals = Date.now();
      // FIXME: keep setTimeout — simulates realistic teardown I/O latency for concurrency test
      await new Promise((resolve) => setTimeout(resolve, 100));
      teardownEndTimes.__terminals = Date.now();
    });

    const archivedAgents = await archiveChisaCodeWorktree(
      {
        chisacodeHome,
        github: createGitHubServiceStub(),
        agentManager: {
          listAgents: () => [
            createManagedAgentForArchive({ id: "agent-1", cwd: created.worktreePath }),
            createManagedAgentForArchive({ id: "agent-2", cwd: created.worktreePath }),
          ],
          archiveAgent: archiveAgentSpy,
          archiveSnapshot: archiveSnapshotSpy,
        },
        agentStorage: createAgentStorageStub(),
        archiveWorkspaceRecord: vi.fn(async () => {}),
        ...createWorkspaceArchivingDeps(),
        isPathWithinRoot: createIsPathWithinRoot(),
        killTerminalsUnderPath,
        sessionLogger: createLogger(),
      },
      {
        targetPath: created.worktreePath,
        repoRoot: repoDir,
        requestId: "req-archive-parallel",
      },
    );

    expect(archivedAgents).toEqual(expect.arrayContaining(["agent-1", "agent-2"]));
    expect(existsSync(created.worktreePath)).toBe(false);
    expect(archiveAgentSpy).toHaveBeenCalledTimes(2);
    expect(archiveSnapshotSpy).not.toHaveBeenCalled();
    expect(killTerminalsUnderPath).toHaveBeenCalledWith(created.worktreePath);

    // All teardown work must overlap — sequential would take ~300ms, parallel ~100ms.
    const starts = Object.values(teardownStartTimes);
    const ends = Object.values(teardownEndTimes);
    const maxEnd = Math.max(...ends);
    const minStart = Math.min(...starts);
    expect(maxEnd - minStart).toBeLessThan(220);
  });

  test("emits archiving upserts during worktree archive request until final remove", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const created = await createLegacyWorktreeForTest({
      branchName: "archive-marked-during-close",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "archive-marked-during-close",
      runSetup: false,
      chisacodeHome,
    });
    const affectedIds = [created.worktreePath];
    const liveAgent = createManagedAgentForArchive({
      id: "agent-1",
      cwd: created.worktreePath,
    });
    const workspaceRecord: PersistedWorkspaceRecord = {
      workspaceId: created.worktreePath,
      projectId: repoDir,
      cwd: created.worktreePath,
      kind: "worktree",
      displayName: "archive-marked-during-close",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
      archivedAt: null,
    };
    const emitted: SessionOutboundMessage[] = [];
    const events: string[] = [];
    const archivedWorkspaceIds = new Set<string>();
    const archivingByWorkspaceId = new Map<string, string>();
    const emitWorkspaceUpdatesForWorkspaceIds = vi.fn(async (workspaceIds: Iterable<string>) => {
      for (const workspaceId of workspaceIds) {
        if (archivedWorkspaceIds.has(workspaceId)) {
          emitted.push({
            type: "workspace_update",
            payload: {
              kind: "remove",
              id: workspaceId,
            },
          });
          continue;
        }
        emitted.push({
          type: "workspace_update",
          payload: {
            kind: "upsert",
            workspace: {
              ...createWorkspaceDescriptor({ workspace: workspaceRecord, repoDir }),
              archivingAt: archivingByWorkspaceId.get(workspaceId) ?? null,
            },
          },
        });
      }
      events.push(`emit:${Array.from(workspaceIds).join(",")}`);
    });
    const archiveAgent = vi.fn(async () => {
      events.push("close:start");
      await emitWorkspaceUpdatesForWorkspaceIds(affectedIds);
      events.push("close:end");
      return { archivedAt: new Date().toISOString() };
    });
    const archiveSnapshot = vi.fn(async () => {
      throw new Error("not expected for live agents");
    });

    await handleChisaCodeWorktreeArchiveRequest(
      {
        chisacodeHome,
        github: createGitHubServiceStub(),
        workspaceGitService: {
          getSnapshot: vi.fn(async () => null),
          listWorktrees: vi.fn(async () => []),
        },
        agentManager: {
          listAgents: () => [liveAgent],
          archiveAgent,
          archiveSnapshot,
        },
        agentStorage: createAgentStorageStub(),
        archiveWorkspaceRecord: vi.fn(async (workspaceId: string) => {
          archivedWorkspaceIds.add(workspaceId);
        }),
        emit: (message) => emitted.push(message),
        emitWorkspaceUpdatesForWorkspaceIds,
        markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => {
          events.push(`mark:${Array.from(workspaceIds).join(",")}`);
          for (const workspaceId of workspaceIds) {
            archivingByWorkspaceId.set(workspaceId, archivingAt);
          }
        },
        clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => {
          events.push(`clear:${Array.from(workspaceIds).join(",")}`);
          for (const workspaceId of workspaceIds) {
            archivingByWorkspaceId.delete(workspaceId);
          }
        },
        isPathWithinRoot: createIsPathWithinRoot(),
        killTerminalsUnderPath: vi.fn(async () => {}),
        sessionLogger: createLogger(),
      },
      {
        type: "chisacode_worktree_archive_request",
        requestId: "req-archive-marked-during-close",
        worktreePath: created.worktreePath,
        repoRoot: repoDir,
      },
    );

    const workspaceUpdates = emitted.filter(
      (message): message is Extract<SessionOutboundMessage, { type: "workspace_update" }> =>
        message.type === "workspace_update",
    );
    expect(events.slice(0, 3)).toEqual([
      `mark:${created.worktreePath}`,
      `emit:${created.worktreePath}`,
      "close:start",
    ]);
    expect(workspaceUpdates[0]?.payload).toEqual({
      kind: "upsert",
      workspace: expect.objectContaining({
        id: created.worktreePath,
        archivingAt: expect.any(String),
      }),
    });
    const archivingAt =
      workspaceUpdates[0]?.payload.kind === "upsert"
        ? workspaceUpdates[0].payload.workspace.archivingAt
        : null;
    expect(workspaceUpdates[1]?.payload).toEqual({
      kind: "upsert",
      workspace: expect.objectContaining({
        id: created.worktreePath,
        archivingAt,
      }),
    });
    expect(workspaceUpdates.at(-1)?.payload).toEqual({
      kind: "remove",
      id: created.worktreePath,
    });
    expect(events.slice(-2)).toEqual([
      `clear:${created.worktreePath}`,
      `emit:${created.worktreePath}`,
    ]);
    expect(
      emitted.find((message) => message.type === "chisacode_worktree_archive_response"),
    ).toMatchObject({
      payload: {
        success: true,
        error: null,
      },
    });
  });

  test("clears archiving state and leaves workspace records active when worktree delete fails", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const created = await createLegacyWorktreeForTest({
      branchName: "archive-delete-fails",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "archive-delete-fails",
      runSetup: false,
      chisacodeHome,
    });
    const archivingByWorkspaceId = new Map<string, string>();
    const emittedUpdates: Array<{
      kind: "upsert";
      workspaceId: string;
      archivingAt: string | null;
    }> = [];
    const archiveWorkspaceRecord = vi.fn(async () => {});

    await expect(
      archiveChisaCodeWorktree(
        {
          chisacodeHome,
          github: createGitHubServiceStub(),
          workspaceGitService: { getSnapshot: vi.fn(async () => null) },
          agentManager: {
            listAgents: () => [],
            archiveAgent: vi.fn(async () => ({ archivedAt: new Date().toISOString() })),
            archiveSnapshot: vi.fn(async () => {
              throw new Error("not expected for empty agent list");
            }),
          },
          agentStorage: createAgentStorageStub(),
          archiveWorkspaceRecord,
          emitWorkspaceUpdatesForWorkspaceIds: vi.fn(async (workspaceIds: Iterable<string>) => {
            for (const workspaceId of workspaceIds) {
              emittedUpdates.push({
                kind: "upsert",
                workspaceId,
                archivingAt: archivingByWorkspaceId.get(workspaceId) ?? null,
              });
            }
          }),
          markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => {
            for (const workspaceId of workspaceIds) {
              archivingByWorkspaceId.set(workspaceId, archivingAt);
            }
          },
          clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => {
            for (const workspaceId of workspaceIds) {
              archivingByWorkspaceId.delete(workspaceId);
            }
          },
          isPathWithinRoot: createIsPathWithinRoot(),
          killTerminalsUnderPath: vi.fn(async () => {}),
          sessionLogger: createLogger(),
        },
        {
          targetPath: created.worktreePath,
          repoRoot: null,
          requestId: "req-archive-delete-fails",
        },
      ),
    ).rejects.toThrow("cwd or worktreesRoot is required to delete a ChisaCode worktree");

    expect(existsSync(created.worktreePath)).toBe(true);
    expect(archiveWorkspaceRecord).not.toHaveBeenCalled();
    expect(emittedUpdates[0]).toEqual({
      kind: "upsert",
      workspaceId: created.worktreePath,
      archivingAt: expect.any(String),
    });
    expect(emittedUpdates.at(-1)).toEqual({
      kind: "upsert",
      workspaceId: created.worktreePath,
      archivingAt: null,
    });
  });

  test("fails closed and preserves the worktree when terminal teardown rejects", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const created = await createLegacyWorktreeForTest({
      branchName: "archive-terminal-throws",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "archive-terminal-throws",
      runSetup: false,
      chisacodeHome,
    });

    const killTerminalsUnderPath = vi.fn(async () => {
      throw new Error("simulated terminal teardown failure");
    });

    await expect(
      archiveChisaCodeWorktree(
        {
          chisacodeHome,
          github: createGitHubServiceStub(),
          agentManager: {
            listAgents: () => [],
            archiveAgent: vi.fn(async () => ({ archivedAt: new Date().toISOString() })),
            archiveSnapshot: vi.fn(async () => {
              throw new Error("not expected for empty agent list");
            }),
          },
          agentStorage: createAgentStorageStub(),
          archiveWorkspaceRecord: vi.fn(async () => {}),
          ...createWorkspaceArchivingDeps(),
          isPathWithinRoot: createIsPathWithinRoot(),
          killTerminalsUnderPath,
          sessionLogger: createLogger(),
        },
        {
          targetPath: created.worktreePath,
          repoRoot: repoDir,
          requestId: "req-archive-terminal-throws",
        },
      ),
    ).rejects.toThrow("Teardown failed before worktree delete");

    expect(killTerminalsUnderPath).toHaveBeenCalledTimes(1);
    expect(existsSync(created.worktreePath)).toBe(true);
  });

  test("forces a workspace git snapshot refresh after archive deletes a worktree", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const created = await createLegacyWorktreeForTest({
      branchName: "archive-refresh",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "archive-refresh",
      runSetup: false,
      chisacodeHome,
    });
    const workspaceGitService = {
      getSnapshot: vi.fn(async () => null),
    };

    await archiveChisaCodeWorktree(
      {
        chisacodeHome,
        github: createGitHubServiceStub(),
        workspaceGitService: workspaceGitService as unknown as WorkspaceGitService,
        agentManager: {
          listAgents: () => [],
          archiveAgent: vi.fn(async () => ({ archivedAt: new Date().toISOString() })),
          archiveSnapshot: vi.fn(async () => {
            throw new Error("not expected for empty agent list");
          }),
        },
        agentStorage: createAgentStorageStub(),
        archiveWorkspaceRecord: vi.fn(async () => {}),
        ...createWorkspaceArchivingDeps(),
        isPathWithinRoot: createIsPathWithinRoot(),
        killTerminalsUnderPath: vi.fn(async () => {}),
        sessionLogger: createLogger(),
      },
      {
        targetPath: created.worktreePath,
        repoRoot: repoDir,
        requestId: "req-archive-refresh",
      },
    );

    expect(workspaceGitService.getSnapshot).toHaveBeenCalledWith(repoDir, {
      force: true,
      reason: "archive-worktree",
    });
  });

  test("keeps writes blocked when post-delete finalization throws", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const created = await createLegacyWorktreeForTest({
      branchName: "archive-finalize-throws",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "archive-finalize-throws",
      runSetup: false,
      chisacodeHome,
    });
    const mutationCoordinator = new WorkspaceMutationCoordinator();
    const github = createGitHubServiceStub();
    github.invalidate = () => {
      throw new Error("simulated post-delete invalidation failure");
    };

    await expect(
      archiveChisaCodeWorktree(
        {
          chisacodeHome,
          github,
          workspaceGitService: { getSnapshot: vi.fn(async () => null) },
          agentManager: {
            listAgents: () => [],
            archiveAgent: vi.fn(async () => ({ archivedAt: new Date().toISOString() })),
            archiveSnapshot: vi.fn(async () => {
              throw new Error("not expected for empty agent list");
            }),
          },
          agentStorage: createAgentStorageStub(),
          archiveWorkspaceRecord: vi.fn(async () => {}),
          ...createWorkspaceArchivingDeps(),
          isPathWithinRoot: createIsPathWithinRoot(),
          killTerminalsUnderPath: vi.fn(async () => {}),
          mutationCoordinator,
          sessionLogger: createLogger(),
        },
        {
          targetPath: created.worktreePath,
          repoRoot: repoDir,
          requestId: "req-archive-finalize-throws",
        },
      ),
    ).rejects.toThrow("simulated post-delete invalidation failure");

    expect(existsSync(created.worktreePath)).toBe(false);
    expect(mutationCoordinator.getState(created.worktreePath)).toBe(
      "delete_complete_pending_finalize",
    );
    expect(mutationCoordinator.isAcceptingWrites(created.worktreePath)).toBe(false);
  });

  test("preserves the worktree when git has forgotten it and repoRoot is unavailable", async () => {
    const { tempDir, repoDir } = createGitRepo();
    cleanupPaths.push(tempDir);

    const chisacodeHome = path.join(tempDir, ".chisacode");
    const created = await createLegacyWorktreeForTest({
      branchName: "archive-orphan",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "archive-orphan",
      runSetup: false,
      chisacodeHome,
    });

    // Simulate a prior failed archive that stripped git's admin dir.
    rmSync(path.join(repoDir, ".git", "worktrees", "archive-orphan"), {
      recursive: true,
      force: true,
    });
    expect(existsSync(created.worktreePath)).toBe(true);
    const recoveryPath = path.join(created.worktreePath, "recovery.txt");
    writeFileSync(recoveryPath, "preserve me\n");

    const emitted: SessionOutboundMessage[] = [];
    await handleChisaCodeWorktreeArchiveRequest(
      {
        chisacodeHome,
        github: createGitHubServiceStub(),
        agentManager: {
          listAgents: () => [],
          archiveAgent: vi.fn(async () => ({ archivedAt: new Date().toISOString() })),
          archiveSnapshot: vi.fn(async () => {
            throw new Error("not expected for empty agent list");
          }),
        },
        agentStorage: createAgentStorageStub(),
        archiveWorkspaceRecord: vi.fn(async () => {}),
        emit: (msg) => emitted.push(msg),
        ...createWorkspaceArchivingDeps(),
        isPathWithinRoot: createIsPathWithinRoot(),
        killTerminalsUnderPath: vi.fn(async () => {}),
        sessionLogger: createLogger(),
      },
      {
        type: "chisacode_worktree_archive_request",
        requestId: "req-archive-orphan",
        worktreePath: created.worktreePath,
      },
    );

    const response = emitted.find(
      (
        message,
      ): message is Extract<
        SessionOutboundMessage,
        { type: "chisacode_worktree_archive_response" }
      > => message.type === "chisacode_worktree_archive_response",
    );
    expect(response?.payload.success).toBe(false);
    expect(response?.payload.error?.message).toContain("preserved for recovery");
    expect(readFileSync(recoveryPath, "utf8")).toBe("preserve me\n");
  });
});
