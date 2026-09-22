import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import type { Logger } from "pino";

import type {
  AgentModelDefinition,
  AgentPersistenceHandle,
  ListModelsOptions,
  ListPersistedAgentsOptions,
  PersistedAgentDescriptor,
} from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { createPathEquivalenceMatcher } from "../../../../utils/path.js";
import {
  buildBinaryDiagnosticRows,
  formatDiagnosticStatus,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  resolveBinaryVersion,
  toDiagnosticErrorMessage,
} from "../diagnostic-utils.js";
import { CodexAppServerClient, type CodexAppServerTraceContext } from "./app-server-transport.js";
import { loadCodexThreadHistoryTimeline, type PersistedTimelineEntry } from "./history.js";
import {
  checkCodexLaunchAvailable,
  CODEX_AUTO_REVIEW_MIN_VERSION,
  CODEX_GOALS_MIN_VERSION,
  codexVersionAtLeast,
  resolveCodexLaunch,
  resolveCodexLaunchPrefix,
} from "./launch.js";
import { loadCodexModelDefinitions } from "./models.js";
import { buildCodexAppServerInitializeParams } from "./runtime-config.js";

const CODEX_PROVIDER = "codex" as const;

export interface CodexClientLike {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  dispose(): Promise<void>;
}

export interface CodexClientRuntimeDeps {
  _createCodexClient?: (
    child: ChildProcessWithoutNullStreams,
    logger: Logger,
    getTraceContext: () => CodexAppServerTraceContext,
  ) => CodexClientLike;
}

type SpawnCodexAppServer = () => Promise<ChildProcessWithoutNullStreams>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function filterCodexThreadsByCwd(
  threads: Array<Record<string, unknown>>,
  cwd: string | undefined,
): Array<Record<string, unknown>> {
  if (!cwd) {
    return threads;
  }
  // Rows without a cwd must not inherit the daemon cwd and accidentally match the filter.
  const matchesCwd = createPathEquivalenceMatcher(cwd);
  return threads.filter((thread) => typeof thread.cwd === "string" && matchesCwd(thread.cwd));
}

function readCodexThread(client: CodexClientLike, threadId: string): Promise<unknown> {
  return client.request("thread/read", {
    threadId,
    includeTurns: true,
  });
}

export class CodexClientRuntime {
  private goalsEnabledPromise: Promise<boolean> | null = null;
  private autoReviewEnabledPromise: Promise<boolean> | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly runtimeSettings: ProviderRuntimeSettings | undefined,
    private readonly deps: CodexClientRuntimeDeps,
    private readonly spawnAppServer: SpawnCodexAppServer,
  ) {}

  getGoalsEnabledPromise(): Promise<boolean> | null {
    return this.goalsEnabledPromise;
  }

  setGoalsEnabledPromise(value: Promise<boolean> | null): void {
    this.goalsEnabledPromise = value;
  }

  getAutoReviewEnabledPromise(): Promise<boolean> | null {
    return this.autoReviewEnabledPromise;
  }

  setAutoReviewEnabledPromise(value: Promise<boolean> | null): void {
    this.autoReviewEnabledPromise = value;
  }

  resolveGoalsEnabled(): Promise<boolean> {
    if (!this.goalsEnabledPromise) {
      this.goalsEnabledPromise = (async () => {
        try {
          const launchPrefix = await resolveCodexLaunchPrefix(this.runtimeSettings);
          const versionOutput = await resolveBinaryVersion(launchPrefix.command);
          const enabled = codexVersionAtLeast(versionOutput, CODEX_GOALS_MIN_VERSION);
          this.logger.trace(
            {
              provider: CODEX_PROVIDER,
              versionOutput,
              enabled,
            },
            "provider.codex.config.goals_resolved",
          );
          return enabled;
        } catch (error) {
          this.logger.warn({ err: error }, "Failed to probe codex version for goals gate");
          return false;
        }
      })();
    }
    return this.goalsEnabledPromise;
  }

  resolveAutoReviewEnabled(): Promise<boolean> {
    if (!this.autoReviewEnabledPromise) {
      this.autoReviewEnabledPromise = (async () => {
        try {
          const launchPrefix = await resolveCodexLaunchPrefix(this.runtimeSettings);
          const versionOutput = await resolveBinaryVersion(launchPrefix.command);
          const enabled = codexVersionAtLeast(versionOutput, CODEX_AUTO_REVIEW_MIN_VERSION);
          this.logger.trace(
            {
              provider: CODEX_PROVIDER,
              versionOutput,
              enabled,
            },
            "provider.codex.config.auto_review_resolved",
          );
          return enabled;
        } catch (error) {
          this.logger.warn({ err: error }, "Failed to probe codex version for auto-review gate");
          return false;
        }
      })();
    }
    return this.autoReviewEnabledPromise;
  }

  async listPersistedAgents(
    options?: ListPersistedAgentsOptions,
  ): Promise<PersistedAgentDescriptor[]> {
    const child = await this.spawnAppServer();
    const client =
      this.deps._createCodexClient?.(child, this.logger, () => ({})) ??
      new CodexAppServerClient(child, this.logger);

    try {
      await client.request("initialize", buildCodexAppServerInitializeParams());
      client.notify("initialized", {});

      const limit = options?.limit ?? 20;
      const listLimit = options?.cwd ? Math.max(limit, 50) : limit;
      const response = toObjectRecord(await client.request("thread/list", { limit: listLimit }));
      const allThreads = Array.isArray(response?.data) ? response.data.filter(isRecord) : [];
      const threads = filterCodexThreadsByCwd(allThreads, options?.cwd);
      return await Promise.all(
        threads.slice(0, limit).map(async (thread): Promise<PersistedAgentDescriptor> => {
          const threadId = typeof thread.id === "string" ? thread.id : "";
          const cwd = typeof thread.cwd === "string" ? thread.cwd : process.cwd();
          const title = typeof thread.preview === "string" ? thread.preview : null;
          let timeline: PersistedTimelineEntry[] = [];

          try {
            timeline = await loadCodexThreadHistoryTimeline({
              threadId,
              cwd,
              requestThread: (threadIdToRead) => readCodexThread(client, threadIdToRead),
            });
          } catch {
            timeline = [];
          }

          return {
            provider: CODEX_PROVIDER,
            sessionId: threadId,
            cwd,
            title,
            lastActivityAt: new Date(
              ((typeof thread.updatedAt === "number" ? thread.updatedAt : undefined) ??
                (typeof thread.createdAt === "number" ? thread.createdAt : undefined) ??
                0) * 1000,
            ),
            persistence: {
              provider: CODEX_PROVIDER,
              sessionId: threadId,
              nativeHandle: threadId,
              metadata: {
                provider: CODEX_PROVIDER,
                cwd,
                title,
                threadId,
              },
            },
            timeline: timeline.map((entry) => entry.item),
          };
        }),
      );
    } finally {
      await client.dispose();
    }
  }

  async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    // model/list is global to the app server; cwd and force are intentionally ignored.
    const child = await this.spawnAppServer();
    const client = new CodexAppServerClient(child, this.logger);

    try {
      await client.request("initialize", buildCodexAppServerInitializeParams());
      client.notify("initialized", {});
      return await loadCodexModelDefinitions(client, this.logger);
    } finally {
      await client.dispose();
    }
  }

  async archiveNativeSession(handle: AgentPersistenceHandle): Promise<void> {
    const threadId = handle.nativeHandle ?? handle.sessionId;
    if (!threadId) return;

    const child = await this.spawnAppServer();
    const client = new CodexAppServerClient(child, this.logger);

    try {
      await client.request("initialize", buildCodexAppServerInitializeParams());
      client.notify("initialized", {});
      await client.request("thread/archive", { threadId });
    } finally {
      await client.dispose();
    }
  }

  async isAvailable(): Promise<boolean> {
    const launch = await resolveCodexLaunch(this.runtimeSettings);
    const availability = await checkCodexLaunchAvailable(launch);
    return availability.available;
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const launch = await resolveCodexLaunch(this.runtimeSettings);
      const availability = await checkCodexLaunchAvailable(launch);
      const available = availability.available;
      const entries: Array<{ label: string; value: string }> = [
        ...(await buildBinaryDiagnosticRows(launch, availability)),
      ];
      let status = formatDiagnosticStatus(available);

      if (!available) {
        entries.push({ label: "Models", value: "Not checked" });
      } else {
        try {
          const models = await this.listModels({ cwd: homedir(), force: false });
          entries.push({ label: "Models", value: String(models.length) });
        } catch (error) {
          entries.push({
            label: "Models",
            value: `Error - ${toDiagnosticErrorMessage(error)}`,
          });
          status = formatDiagnosticStatus(available, {
            source: "model fetch",
            cause: error,
          });
        }
      }

      entries.push({ label: "Status", value: status });
      return { diagnostic: formatProviderDiagnostic("Codex", entries) };
    } catch (error) {
      return { diagnostic: formatProviderDiagnosticError("Codex", error) };
    }
  }
}
