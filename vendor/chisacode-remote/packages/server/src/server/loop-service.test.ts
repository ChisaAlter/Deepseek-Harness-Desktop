import os from "node:os";
import path from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentSlashCommand,
  AgentRuntimeInfo,
  ListModelsOptions,
  AgentProvider,
} from "./agent/agent-sdk-types.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { AgentManager } from "./agent/agent-manager.js";
import { LoopService } from "./loop-service.js";
import { isPlatform } from "../test-utils/platform.js";
import { createTestLogger } from "../test-utils/test-logger.js";
import { ExecCommandKillTimeoutError, ExecCommandTimeoutError } from "../utils/spawn.js";

const TEST_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

interface ScriptedAgentBehavior {
  onCreate?(config: AgentSessionConfig): void;
  onRun(input: { config: AgentSessionConfig; prompt: string; turnId: string }): Promise<string>;
}

class ScriptedAgentClient implements AgentClient {
  readonly provider: AgentProvider;
  readonly capabilities = TEST_CAPABILITIES;

  constructor(
    provider: AgentProvider,
    private readonly behavior: ScriptedAgentBehavior,
  ) {
    this.provider = provider;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    this.behavior.onCreate?.(config);
    return new ScriptedAgentSession(config, this.provider, this.behavior);
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    return new ScriptedAgentSession(
      {
        provider: this.provider,
        cwd: overrides?.cwd ?? process.cwd(),
        ...overrides,
      },
      this.provider,
      this.behavior,
    );
  }

  async listModels(_options?: ListModelsOptions): Promise<AgentModelDefinition[]> {
    return [];
  }
}

class ScriptedAgentSession implements AgentSession {
  readonly capabilities = TEST_CAPABILITIES;
  readonly id = randomUUID();
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turnCount = 0;
  private interrupted = false;

  constructor(
    private readonly config: AgentSessionConfig,
    readonly provider: AgentProvider,
    private readonly behavior: ScriptedAgentBehavior,
  ) {}

  async run(): Promise<AgentRunResult> {
    return {
      sessionId: this.id,
      finalText: "",
      timeline: [],
    };
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
    const turnId = `turn-${++this.turnCount}`;
    this.interrupted = false;
    queueMicrotask(() => {
      void this.runScript(promptText, turnId);
    });
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: this.config.modeId ?? null,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [];
  }

  async getCurrentMode(): Promise<string | null> {
    return this.config.modeId ?? null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return {
      provider: this.provider,
      sessionId: this.id,
    };
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
  }

  async close(): Promise<void> {}

  async listCommands(): Promise<AgentSlashCommand[]> {
    return [];
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private async runScript(prompt: string, turnId: string): Promise<void> {
    this.emit({ type: "turn_started", provider: this.provider, turnId });
    if (this.interrupted) {
      this.emit({ type: "turn_canceled", provider: this.provider, reason: "interrupted", turnId });
      return;
    }

    try {
      const responseText = await this.behavior.onRun({
        config: this.config,
        prompt,
        turnId,
      });
      if (this.interrupted) {
        this.emit({
          type: "turn_canceled",
          provider: this.provider,
          reason: "interrupted",
          turnId,
        });
        return;
      }
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: { type: "assistant_message", text: responseText },
      });
      this.emit({ type: "turn_completed", provider: this.provider, turnId });
    } catch (error) {
      this.emit({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

describe("LoopService", () => {
  const logger = createTestLogger();
  let tmpDir: string;
  let chisacodeHome: string;
  let workspaceDir: string;
  let storage: AgentStorage;
  let managers: AgentManager[];

  function createLoopTestManager(options: ConstructorParameters<typeof AgentManager>[0]) {
    const manager = new AgentManager(options);
    managers.push(manager);
    return manager;
  }

  beforeEach(() => {
    tmpDir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "loop-service-")));
    chisacodeHome = path.join(tmpDir, "chisacode-home");
    workspaceDir = path.join(tmpDir, "workspace");
    storage = new AgentStorage(path.join(tmpDir, "agents"), logger);
    mkdirSync(workspaceDir, { recursive: true });
    workspaceDir = realpathSync.native(workspaceDir);
    managers = [];
  });

  afterEach(async () => {
    for (const manager of managers) {
      for (const agent of manager.listAgents()) {
        if (agent.lifecycle !== "closed") {
          await manager.closeAgent(agent.id).catch(() => undefined);
        }
      }
      await manager.flush();
    }
    await storage.flush();
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 30, retryDelay: 50 });
    vi.useRealTimers();
  });

  // POSIX-only: real worker agent spawns a PTY whose Windows ConPTY path resolution still fails (error 267) after realpathSync; revisit when we have a Windows dev box.
  test.skipIf(isPlatform("win32"))(
    "runs fresh worker agents until verify-check passes",
    async () => {
      const state = { workerRuns: 0 };
      const verifyScriptPath = path.join(workspaceDir, "verify-check.cjs");
      writeFileSync(verifyScriptPath, 'require("fs").accessSync("done.txt");\n');
      const manager = createLoopTestManager({
        clients: {
          claude: new ScriptedAgentClient("claude", {
            async onRun({ config }) {
              state.workerRuns += 1;
              if (config.title?.includes("worker") && state.workerRuns >= 2) {
                writeFileSync(path.join(workspaceDir, "done.txt"), "ok");
              }
              if (config.title?.includes("worker")) {
                return `worker run ${state.workerRuns}`;
              }
              return '{"passed":true,"reason":"not used"}';
            },
          }),
        },
        registry: storage,
        logger,
      });
      const service = new LoopService({ chisacodeHome, agentManager: manager, logger });
      await service.initialize();

      const loop = await service.runLoop({
        prompt: "Create done.txt when the task is actually fixed.",
        cwd: workspaceDir,
        verifyChecks: [
          `${JSON.stringify(process.execPath)} ${JSON.stringify(path.basename(verifyScriptPath))}`,
        ],
        sleepMs: 1,
        maxIterations: 3,
      });

      await waitForLoopCompletion(service, loop.id);

      const finalLoop = await service.inspectLoop(loop.id);
      expect(finalLoop.status).toBe("succeeded");
      expect(finalLoop.iterations).toHaveLength(2);
      expect(finalLoop.iterations[0]?.workerAgentId).not.toBe(
        finalLoop.iterations[1]?.workerAgentId,
      );
      expect(finalLoop.iterations[0]?.status).toBe("failed");
      expect(finalLoop.iterations[1]?.status).toBe("succeeded");
      expect(finalLoop.iterations[0]?.verifyChecks[0]?.passed).toBe(false);
      expect(finalLoop.iterations[1]?.verifyChecks[0]?.passed).toBe(true);
      expect(readFileSync(path.join(chisacodeHome, "loops", "loops.json"), "utf8")).toContain(
        loop.id,
      );
    },
  );

  test("uses worker and verifier provider-model settings when provided", async () => {
    const workerConfigs: AgentSessionConfig[] = [];
    const verifierConfigs: AgentSessionConfig[] = [];
    const manager = createLoopTestManager({
      clients: {
        codex: new ScriptedAgentClient("codex", {
          async onRun({ config }) {
            workerConfigs.push(config);
            writeFileSync(path.join(workspaceDir, "done.txt"), "ok");
            return "done";
          },
        }),
        claude: new ScriptedAgentClient("claude", {
          async onRun({ config }) {
            verifierConfigs.push(config);
            return '{"passed":true,"reason":"verified"}';
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({ chisacodeHome, agentManager: manager, logger });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Create done.txt",
      cwd: workspaceDir,
      provider: "codex",
      model: "fallback-model",
      workerModel: "gpt-5.4",
      verifyPrompt: "Confirm that done.txt exists in the workspace.",
      verifierProvider: "claude",
      verifierModel: "sonnet",
      maxIterations: 1,
    });

    await waitForLoopCompletion(service, loop.id);

    const finalLoop = await service.inspectLoop(loop.id);
    expect(finalLoop.status).toBe("succeeded");
    expect(finalLoop.provider).toBe("codex");
    expect(finalLoop.model).toBe("fallback-model");
    expect(finalLoop.workerProvider).toBeNull();
    expect(finalLoop.workerModel).toBe("gpt-5.4");
    expect(finalLoop.verifierProvider).toBe("claude");
    expect(finalLoop.verifierModel).toBe("sonnet");
    expect(workerConfigs).toHaveLength(1);
    expect(workerConfigs[0]).toMatchObject({
      provider: "codex",
      model: "gpt-5.4",
      internal: true,
    });
    expect(verifierConfigs).toHaveLength(1);
    expect(verifierConfigs[0]).toMatchObject({
      provider: "claude",
      model: "sonnet",
      internal: true,
    });
  });

  test("archives worker and verifier agents after each iteration when requested", async () => {
    const archivedAgentIds: string[] = [];
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun({ config }) {
            if (config.title?.includes("worker")) {
              writeFileSync(path.join(workspaceDir, "done.txt"), "ok");
              return "created done.txt";
            }
            return '{"passed":true,"reason":"done.txt exists"}';
          },
        }),
      },
      registry: storage,
      logger,
    });
    const archiveAgent = manager.archiveAgent.bind(manager);
    manager.archiveAgent = async (agentId) => {
      archivedAgentIds.push(agentId);
      await archiveAgent(agentId);
    };
    const service = new LoopService({ chisacodeHome, agentManager: manager, logger });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Create done.txt",
      cwd: workspaceDir,
      verifyPrompt: "Confirm that done.txt exists in the workspace.",
      archive: true,
      maxIterations: 1,
    });

    await waitForLoopCompletion(service, loop.id);

    const finalLoop = await service.inspectLoop(loop.id);
    const iteration = finalLoop.iterations[0];
    expect(finalLoop.archive).toBe(true);
    expect(iteration?.workerAgentId).toBeTruthy();
    expect(iteration?.verifierAgentId).toBeTruthy();
    expect(archivedAgentIds).toEqual([iteration.workerAgentId!, iteration.verifierAgentId!]);
    await storage.flush();
    await expect(storage.get(iteration.workerAgentId!)).resolves.toMatchObject({
      id: iteration.workerAgentId!,
      archivedAt: expect.any(String),
      internal: true,
    });
    await expect(storage.get(iteration.verifierAgentId!)).resolves.toMatchObject({
      id: iteration.verifierAgentId!,
      archivedAt: expect.any(String),
      internal: true,
    });
  });

  test("uses verifier prompt when provided", async () => {
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun({ config }) {
            if (config.title?.includes("worker")) {
              await fsMkdir(workspaceDir);
              writeFileSync(path.join(workspaceDir, "done.txt"), "ok");
              return "created done.txt";
            }
            const exists = pathExists(path.join(workspaceDir, "done.txt"));
            return exists
              ? '{"passed":true,"reason":"done.txt exists"}'
              : '{"passed":false,"reason":"done.txt missing"}';
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({ chisacodeHome, agentManager: manager, logger });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Create done.txt",
      cwd: workspaceDir,
      verifyPrompt: "Confirm that done.txt exists in the workspace.",
      maxIterations: 1,
    });

    await waitForLoopCompletion(service, loop.id);

    const finalLoop = await service.inspectLoop(loop.id);
    expect(finalLoop.status).toBe("succeeded");
    expect(finalLoop.iterations[0]?.verifyPrompt).toMatchObject({
      passed: true,
      reason: "done.txt exists",
    });
    const logs = await service.getLoopLogs(loop.id);
    expect(logs.entries.some((entry) => entry.text.includes("Verifier result"))).toBe(true);
  });

  test("defaults worker and verifier modeId to provider's unattended mode", async () => {
    const workerConfigs: AgentSessionConfig[] = [];
    const verifierConfigs: AgentSessionConfig[] = [];
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun({ config }) {
            if (config.title?.includes("worker")) {
              workerConfigs.push(config);
              writeFileSync(path.join(workspaceDir, "done.txt"), "ok");
              return "created done.txt";
            }
            verifierConfigs.push(config);
            return '{"passed":true,"reason":"ok"}';
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({ chisacodeHome, agentManager: manager, logger });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Create done.txt",
      cwd: workspaceDir,
      verifyPrompt: "Confirm that done.txt exists in the workspace.",
      maxIterations: 1,
    });

    await waitForLoopCompletion(service, loop.id);

    expect(workerConfigs[0]?.modeId).toBe("bypassPermissions");
    expect(verifierConfigs[0]?.modeId).toBe("bypassPermissions");
  });

  test("explicit modeId wins over unattended default", async () => {
    const workerConfigs: AgentSessionConfig[] = [];
    const verifierConfigs: AgentSessionConfig[] = [];
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun({ config }) {
            if (config.title?.includes("worker")) {
              workerConfigs.push(config);
              writeFileSync(path.join(workspaceDir, "done.txt"), "ok");
              return "created done.txt";
            }
            verifierConfigs.push(config);
            return '{"passed":true,"reason":"ok"}';
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({ chisacodeHome, agentManager: manager, logger });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Create done.txt",
      cwd: workspaceDir,
      modeId: "acceptEdits",
      verifierModeId: "plan",
      verifyPrompt: "Confirm that done.txt exists in the workspace.",
      maxIterations: 1,
    });

    await waitForLoopCompletion(service, loop.id);

    expect(workerConfigs[0]?.modeId).toBe("acceptEdits");
    expect(verifierConfigs[0]?.modeId).toBe("plan");
  });

  test("stops a running loop and cancels the active worker", async () => {
    let release: (() => void) | null = null;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun({ config }) {
            if (config.title?.includes("worker")) {
              await blocker;
              return "finished";
            }
            return '{"passed":true,"reason":"ok"}';
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({ chisacodeHome, agentManager: manager, logger });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Wait forever",
      cwd: workspaceDir,
      verifyChecks: ["test -f never.txt"],
    });

    await vi.waitFor(
      async () => {
        const state = await service.inspectLoop(loop.id);
        expect(state.activeWorkerAgentId).not.toBeNull();
      },
      { timeout: 1000 },
    );

    const stoppedPromise = service.stopLoop(loop.id);
    release?.();
    const stopped = await stoppedPromise;

    expect(stopped.status).toBe("stopped");
    const finalLoop = await service.inspectLoop(loop.id);
    expect(finalLoop.status).toBe("stopped");
    expect(finalLoop.iterations[0]?.status).toBe("stopped");
    expect(finalLoop.logs.some((entry) => entry.text.includes("Stop requested"))).toBe(true);
  });

  test("stops an active verify command by aborting its signal", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const verifySignals: AbortSignal[] = [];
    const verifyTimeouts: Array<number | undefined> = [];
    let markVerifyStarted: (() => void) | null = null;
    const verifyStarted = new Promise<void>((resolve) => {
      markVerifyStarted = resolve;
    });
    const runVerifyCommand: NonNullable<
      ConstructorParameters<typeof LoopService>[0]["runVerifyCommand"]
    > = async ({ signal, timeoutMs }) => {
      verifySignals.push(signal);
      verifyTimeouts.push(timeoutMs);
      markVerifyStarted?.();
      return new Promise((_, reject) => {
        const rejectOnAbort = () => {
          reject(new Error("runner rejected after abort"));
        };
        if (signal.aborted) {
          rejectOnAbort();
          return;
        }
        signal.addEventListener("abort", rejectOnAbort, { once: true });
      });
    };
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun() {
            return "worker finished";
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger,
      runVerifyCommand,
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish the worker turn.",
      cwd: workspaceDir,
      verifyChecks: ["ignored-by-injected-runner"],
    });
    await verifyStarted;
    const beforeStop = await service.inspectLoop(loop.id);
    const workerCompletedAt = beforeStop.iterations[0]?.workerCompletedAt;
    expect(workerCompletedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(verifySignals).toHaveLength(1);
    expect(verifyTimeouts).toEqual([undefined]);

    vi.setSystemTime(startedAtMs + 1_000);
    const stopPromise = service.stopLoop(loop.id);
    await vi.waitFor(() => {
      expect(verifySignals[0]?.aborted).toBe(true);
    });
    const stopped = await stopPromise;

    expect(stopped.status).toBe("stopped");
    expect(stopped.iterations).toHaveLength(1);
    expect(stopped.iterations[0]?.status).toBe("stopped");
    expect(stopped.iterations[0]?.failureReason).toBe("Loop stopped");
    expect(stopped.iterations[0]?.workerCompletedAt).toBe(workerCompletedAt);
    expect(stopped.iterations[0]?.verifyChecks).toEqual([]);
    expect(
      stopped.logs.filter((entry) => entry.source === "verify-check" && entry.level === "error"),
    ).toEqual([]);
  });

  test("does not succeed when stop is requested during verify-result persistence", async () => {
    let markPersistBlocked: (() => void) | null = null;
    let releasePersist: (() => void) | null = null;
    let blocked = false;
    const persistBlocked = new Promise<void>((resolve) => {
      markPersistBlocked = resolve;
    });
    const persistRelease = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    const persistLoopState: NonNullable<
      ConstructorParameters<typeof LoopService>[0]["persistLoopState"]
    > = async (_storePath, value) => {
      const records = JSON.parse(value) as Array<{
        status: string;
        iterations: Array<{ verifyChecks: unknown[] }>;
      }>;
      const record = records[0];
      if (
        !blocked &&
        record?.status === "running" &&
        record.iterations[0]?.verifyChecks.length === 1
      ) {
        blocked = true;
        markPersistBlocked?.();
        await persistRelease;
      }
    };
    const runVerifyCommand: NonNullable<
      ConstructorParameters<typeof LoopService>[0]["runVerifyCommand"]
    > = async () => ({ stdout: "verified", stderr: "" });
    const manager = createWorkerOnlyManager(storage, logger, (createdManager) =>
      managers.push(createdManager),
    );
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger,
      persistLoopState,
      runVerifyCommand,
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish the worker turn.",
      cwd: workspaceDir,
      verifyChecks: ["persisted-check"],
      maxIterations: 1,
    });
    await persistBlocked;
    const beforeStop = await service.inspectLoop(loop.id);
    const workerCompletedAt = beforeStop.iterations[0]?.workerCompletedAt;

    const stopPromise = service.stopLoop(loop.id);
    await vi.waitFor(async () => {
      const state = await service.inspectLoop(loop.id);
      expect(hasLogText(state.logs, "Stop requested.")).toBe(true);
    });
    releasePersist?.();
    const stopped = await stopPromise;

    expect(stopped.status).toBe("stopped");
    expect(stopped.iterations[0]?.status).toBe("stopped");
    expect(stopped.iterations[0]?.workerCompletedAt).toBe(workerCompletedAt);
    expect(stopped.logs.some((entry) => entry.text.includes("passed verification"))).toBe(false);
  });

  test.each(["throws", "returns-pass"] as const)(
    "canonicalizes verifier cancellation when the provider %s after stop",
    async (outcome) => {
      let markVerifierStarted: (() => void) | null = null;
      let releaseVerifier: (() => void) | null = null;
      let verifierSignal: AbortSignal | undefined;
      const verifierStarted = new Promise<void>((resolve) => {
        markVerifierStarted = resolve;
      });
      const verifierRelease = new Promise<void>((resolve) => {
        releaseVerifier = resolve;
      });
      const runVerifierPrompt: NonNullable<
        ConstructorParameters<typeof LoopService>[0]["runVerifierPrompt"]
      > = async ({ signal }) => {
        verifierSignal = signal;
        markVerifierStarted?.();
        await verifierRelease;
        if (outcome === "throws") {
          throw new Error("provider canceled with noncanonical error");
        }
        return { passed: true, reason: "late verifier pass" };
      };
      const manager = createWorkerOnlyManager(storage, logger, (createdManager) =>
        managers.push(createdManager),
      );
      const service = new LoopService({
        chisacodeHome,
        agentManager: manager,
        logger,
        runVerifierPrompt,
      });
      await service.initialize();

      const loop = await service.runLoop({
        prompt: "Finish the worker turn.",
        cwd: workspaceDir,
        verifyPrompt: "Verify the worker result.",
      });
      await verifierStarted;
      const beforeStop = await service.inspectLoop(loop.id);
      const workerCompletedAt = beforeStop.iterations[0]?.workerCompletedAt;

      try {
        const stopPromise = service.stopLoop(loop.id);
        await vi.waitFor(() => {
          expect(verifierSignal?.aborted).toBe(true);
        });
        releaseVerifier?.();
        const stopped = await stopPromise;

        expect(stopped.status).toBe("stopped");
        expect(stopped.iterations).toHaveLength(1);
        expect(stopped.iterations[0]?.status).toBe("stopped");
        expect(stopped.iterations[0]?.workerCompletedAt).toBe(workerCompletedAt);
        expect(stopped.iterations[0]?.verifyPrompt).toBeNull();
        expect(stopped.logs.some((entry) => entry.text.includes("Verifier result"))).toBe(false);
        expect(stopped.logs.some((entry) => entry.text.includes("passed verification"))).toBe(
          false,
        );
      } finally {
        releaseVerifier?.();
        await service.stopLoop(loop.id);
      }
    },
  );

  test("maps a deadline reached while persisting a passing verify result", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    let markPersistBlocked: (() => void) | null = null;
    let releasePersist: (() => void) | null = null;
    let blocked = false;
    const persistBlocked = new Promise<void>((resolve) => {
      markPersistBlocked = resolve;
    });
    const persistRelease = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    const persistLoopState: NonNullable<
      ConstructorParameters<typeof LoopService>[0]["persistLoopState"]
    > = async (_storePath, value) => {
      const records = JSON.parse(value) as Array<{
        status: string;
        iterations: Array<{ verifyChecks: unknown[] }>;
      }>;
      const record = records[0];
      if (
        !blocked &&
        record?.status === "running" &&
        record.iterations[0]?.verifyChecks.length === 1
      ) {
        blocked = true;
        markPersistBlocked?.();
        await persistRelease;
      }
    };
    const manager = createWorkerOnlyManager(storage, logger, (createdManager) =>
      managers.push(createdManager),
    );
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger,
      persistLoopState,
      runVerifyCommand: async () => ({ stdout: "verified", stderr: "" }),
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish the worker turn.",
      cwd: workspaceDir,
      verifyChecks: ["deadline-check"],
      maxIterations: 1,
      maxTimeMs: 1_000,
    });
    await persistBlocked;

    vi.setSystemTime(startedAtMs + 1_000);
    releasePersist?.();
    await vi.waitFor(async () => {
      const state = await service.inspectLoop(loop.id);
      expect(state.status).not.toBe("running");
    });

    const finalLoop = await service.inspectLoop(loop.id);
    expect(finalLoop.status).toBe("failed");
    expect(finalLoop.iterations[0]?.status).toBe("failed");
    expect(finalLoop.iterations[0]?.failureReason).toBe("Reached max time (1000ms).");
    expect(finalLoop.logs.some((entry) => entry.text.includes("passed verification"))).toBe(false);
  });

  test("limits a verify command timeout to the remaining loop deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const verifyTimeouts: Array<number | undefined> = [];
    const runVerifyCommand: NonNullable<
      ConstructorParameters<typeof LoopService>[0]["runVerifyCommand"]
    > = async ({ timeoutMs }) => {
      verifyTimeouts.push(timeoutMs);
      return { stdout: "", stderr: "" };
    };
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun() {
            vi.setSystemTime(startedAtMs + 250);
            return "worker finished";
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger,
      runVerifyCommand,
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish the worker turn.",
      cwd: workspaceDir,
      verifyChecks: ["record-timeout"],
      maxIterations: 1,
      maxTimeMs: 1_000,
    });
    await waitForLoopCompletion(service, loop.id);

    expect(verifyTimeouts).toEqual([750]);
  });

  test("does not start a verify command after the loop deadline is exhausted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const verifyCommands: string[] = [];
    const runVerifyCommand: NonNullable<
      ConstructorParameters<typeof LoopService>[0]["runVerifyCommand"]
    > = async ({ command }) => {
      verifyCommands.push(command);
      return { stdout: "", stderr: "" };
    };
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun() {
            vi.setSystemTime(startedAtMs + 1_000);
            return "worker finished";
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger,
      runVerifyCommand,
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish after the deadline.",
      cwd: workspaceDir,
      verifyChecks: ["must-not-run"],
      maxIterations: 1,
      maxTimeMs: 1_000,
    });
    await vi.waitFor(async () => {
      const state = await service.inspectLoop(loop.id);
      expect(state.status).not.toBe("running");
    });

    const finalLoop = await service.inspectLoop(loop.id);
    expect(verifyCommands).toEqual([]);
    expect(finalLoop.status).toBe("failed");
    expect(finalLoop.iterations).toHaveLength(1);
    expect(finalLoop.iterations[0]?.status).toBe("failed");
    expect(finalLoop.iterations[0]?.failureReason).toBe("Reached max time (1000ms).");
  });

  test("does not create a verifier after the loop deadline is exhausted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const createdConfigs: AgentSessionConfig[] = [];
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          onCreate(config) {
            createdConfigs.push(config);
          },
          async onRun() {
            vi.setSystemTime(startedAtMs + 1_000);
            return "worker finished";
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger,
      persistLoopState: () => Promise.resolve(),
      runVerifierPrompt: async () => {
        throw new Error("Verifier must not run after the deadline");
      },
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish after the deadline.",
      cwd: workspaceDir,
      verifyPrompt: "Must not create a verifier.",
      maxIterations: 1,
      maxTimeMs: 1_000,
    });
    await vi.waitFor(async () => {
      const state = await service.inspectLoop(loop.id);
      expect(state.status).not.toBe("running");
    });

    const finalLoop = await service.inspectLoop(loop.id);
    expect(createdConfigs).toHaveLength(1);
    expect(finalLoop.status).toBe("failed");
    expect(finalLoop.iterations[0]?.status).toBe("failed");
    expect(finalLoop.iterations[0]?.failureReason).toBe("Reached max time (1000ms).");
    expect(finalLoop.iterations[0]?.verifierAgentId).toBeNull();
    expect(finalLoop.iterations[0]?.verifyPrompt).toBeNull();
  });

  test("rejects a verifier pass returned after the loop deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const manager = createWorkerOnlyManager(storage, logger, (createdManager) =>
      managers.push(createdManager),
    );
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger,
      persistLoopState: () => Promise.resolve(),
      runVerifierPrompt: async () => {
        vi.setSystemTime(startedAtMs + 1_000);
        return { passed: true, reason: "late pass" };
      },
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish the worker turn.",
      cwd: workspaceDir,
      verifyPrompt: "Verify before the deadline.",
      maxIterations: 1,
      maxTimeMs: 1_000,
    });
    await vi.waitFor(async () => {
      const state = await service.inspectLoop(loop.id);
      expect(state.status).not.toBe("running");
    });

    const finalLoop = await service.inspectLoop(loop.id);
    expect(finalLoop.status).toBe("failed");
    expect(finalLoop.iterations[0]?.status).toBe("failed");
    expect(finalLoop.iterations[0]?.failureReason).toBe("Reached max time (1000ms).");
    expect(finalLoop.iterations[0]?.verifyPrompt).toBeNull();
    expect(finalLoop.logs.some((entry) => entry.text.includes("Verifier result"))).toBe(false);
  });

  test("treats verify cleanup timeout as a fatal loop execution failure", async () => {
    const loggedErrors: unknown[] = [];
    const capturingLogger = createCapturingLoopLogger(
      loggedErrors,
    ) as unknown as ConstructorParameters<typeof LoopService>[0]["logger"];
    const cleanupError = new ExecCommandKillTimeoutError({
      cause: new RangeError("stdout maxBuffer length exceeded"),
      cleanupCause: new Error("cleanup could not be confirmed"),
      cmd: "verify-overflow",
      signal: "SIGKILL",
      stderr: "captured stderr",
      stdout: "captured stdout",
      terminationReason: "maxBuffer",
    });
    let markVerifyAttempted: (() => void) | null = null;
    const verifyAttempted = new Promise<void>((resolve) => {
      markVerifyAttempted = resolve;
    });
    const manager = createWorkerOnlyManager(storage, logger, (createdManager) =>
      managers.push(createdManager),
    );
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger: capturingLogger,
      persistLoopState: () => Promise.resolve(),
      runVerifyCommand: async () => {
        markVerifyAttempted?.();
        throw cleanupError;
      },
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish the worker turn.",
      cwd: workspaceDir,
      verifyChecks: ["verify-overflow"],
      maxIterations: 3,
      sleepMs: 60_000,
    });

    try {
      await verifyAttempted;
      await vi.waitFor(async () => {
        const state = await service.inspectLoop(loop.id);
        expect(state.status !== "running" || hasSleepLog(state.logs)).toBe(true);
      });

      const finalLoop = await service.inspectLoop(loop.id);
      expect(finalLoop.status).toBe("failed");
      expect(finalLoop.iterations).toHaveLength(1);
      expect(finalLoop.iterations[0]?.status).toBe("failed");
      expect(finalLoop.iterations[0]?.failureReason).toBe(cleanupError.message);
      expect(finalLoop.iterations[0]?.verifyChecks).toEqual([]);
      expect(finalLoop.logs.filter((entry) => entry.text.startsWith("Sleeping "))).toEqual([]);
      expect(finalLoop.logs.some((entry) => entry.text === cleanupError.message)).toBe(true);
      expect(loggedErrors).toContainEqual(expect.objectContaining({ err: cleanupError }));
    } finally {
      await service.stopLoop(loop.id);
    }
  });

  test("keeps a verify cleanup timeout fatal when it reaches the loop deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const loggedErrors: unknown[] = [];
    const capturingLogger = createCapturingLoopLogger(
      loggedErrors,
    ) as unknown as ConstructorParameters<typeof LoopService>[0]["logger"];
    const cleanupError = new ExecCommandKillTimeoutError({
      cause: new RangeError("stdout maxBuffer length exceeded"),
      cleanupCause: new Error("cleanup could not be confirmed"),
      cmd: "deadline-overflow",
      signal: "SIGKILL",
      stderr: "deadline stderr",
      stdout: "deadline stdout",
      terminationReason: "maxBuffer",
    });
    const manager = createWorkerOnlyManager(storage, logger, (createdManager) =>
      managers.push(createdManager),
    );
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger: capturingLogger,
      persistLoopState: () => Promise.resolve(),
      runVerifyCommand: async () => {
        vi.setSystemTime(startedAtMs + 1_000);
        throw cleanupError;
      },
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish the worker turn.",
      cwd: workspaceDir,
      verifyChecks: ["deadline-overflow"],
      maxIterations: 3,
      maxTimeMs: 1_000,
      sleepMs: 60_000,
    });
    await vi.waitFor(async () => {
      const state = await service.inspectLoop(loop.id);
      expect(state.status).not.toBe("running");
    });

    const finalLoop = await service.inspectLoop(loop.id);
    expect(finalLoop.status).toBe("failed");
    expect(finalLoop.iterations).toHaveLength(1);
    expect(finalLoop.iterations[0]?.status).toBe("failed");
    expect(finalLoop.iterations[0]?.failureReason).toBe(cleanupError.message);
    expect(finalLoop.iterations[0]?.verifyChecks).toEqual([]);
    expect(finalLoop.logs.filter((entry) => entry.text.startsWith("Sleeping "))).toEqual([]);
    expect(finalLoop.logs.some((entry) => entry.text === cleanupError.message)).toBe(true);
    expect(loggedErrors).toContainEqual(expect.objectContaining({ err: cleanupError }));
  });

  test.each([
    {
      label: "command timeout",
      createError: (timeout: number) => new ExecCommandTimeoutError(timeout, "", ""),
    },
    {
      label: "cleanup timeout",
      createError: (timeout: number) =>
        new ExecCommandTimeoutError(timeout, "", "", {
          cause: new ExecCommandTimeoutError(timeout, "", "", { killed: false }),
          cmd: "times-out",
          killed: false,
          signal: "SIGTERM",
          terminationResult: "kill-timeout",
        }),
    },
  ])("finishes with canonical max-time failure after $label", async ({ createError }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const verifyTimeouts: number[] = [];
    let markVerifyAttempted: (() => void) | null = null;
    const verifyAttempted = new Promise<void>((resolve) => {
      markVerifyAttempted = resolve;
    });
    const runVerifyCommand: NonNullable<
      ConstructorParameters<typeof LoopService>[0]["runVerifyCommand"]
    > = async ({ timeoutMs }) => {
      const timeout = timeoutMs ?? 0;
      verifyTimeouts.push(timeout);
      vi.setSystemTime(startedAtMs + 500);
      markVerifyAttempted?.();
      throw createError(timeout);
    };
    const manager = createLoopTestManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun() {
            return "worker finished";
          },
        }),
      },
      registry: storage,
      logger,
    });
    const service = new LoopService({
      chisacodeHome,
      agentManager: manager,
      logger,
      runVerifyCommand,
    });
    await service.initialize();

    const loop = await service.runLoop({
      prompt: "Finish the worker turn.",
      cwd: workspaceDir,
      verifyChecks: ["times-out"],
      maxIterations: 3,
      maxTimeMs: 1_000,
      sleepMs: 60_000,
    });

    try {
      await verifyAttempted;
      await vi.waitFor(async () => {
        const state = await service.inspectLoop(loop.id);
        const sleeping = hasSleepLog(state.logs);
        expect(state.status !== "running" || sleeping).toBe(true);
      });

      const finalLoop = await service.inspectLoop(loop.id);
      expect(finalLoop.status).toBe("failed");
      expect(finalLoop.iterations).toHaveLength(1);
      expect(finalLoop.iterations[0]?.status).toBe("failed");
      expect(finalLoop.iterations[0]?.failureReason).toBe("Reached max time (1000ms).");
      expect(finalLoop.iterations[0]?.workerCompletedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(finalLoop.iterations[0]?.verifyChecks).toEqual([]);
      expect(verifyTimeouts).toHaveLength(1);
      expect(finalLoop.logs.filter((entry) => entry.text.startsWith("Sleeping "))).toEqual([]);
      expect(
        finalLoop.logs.filter(
          (entry) => entry.source === "verify-check" && entry.level === "error",
        ),
      ).toEqual([]);
    } finally {
      await service.stopLoop(loop.id);
    }
  });
});

async function fsMkdir(target: string): Promise<void> {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(target, { recursive: true }));
}

function pathExists(target: string): boolean {
  return existsSync(target);
}

function hasSleepLog(entries: Array<{ text: string }>): boolean {
  return entries.some((entry) => entry.text.startsWith("Sleeping "));
}

function hasLogText(entries: Array<{ text: string }>, text: string): boolean {
  return entries.some((entry) => entry.text === text);
}

function createWorkerOnlyManager(
  storage: AgentStorage,
  logger: ReturnType<typeof createTestLogger>,
  register?: (manager: AgentManager) => void,
): AgentManager {
  const manager = new AgentManager({
    clients: {
      claude: new ScriptedAgentClient("claude", {
        async onRun() {
          return "worker finished";
        },
      }),
    },
    registry: storage,
    logger,
  });
  register?.(manager);
  return manager;
}

function createCapturingLoopLogger(loggedErrors: unknown[]) {
  const logger = {
    child: () => logger,
    debug() {},
    error(context: unknown) {
      loggedErrors.push(context);
    },
    fatal() {},
    info() {},
    trace() {},
    warn() {},
  };
  return logger;
}

async function waitForLoopCompletion(service: LoopService, loopId: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const state = await service.inspectLoop(loopId);
      expect(state.status).toBe("succeeded");
    },
    { timeout: 5000 },
  );
}
