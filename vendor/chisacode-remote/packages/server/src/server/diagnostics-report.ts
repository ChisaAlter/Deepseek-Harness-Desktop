import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { MutableDaemonConfig } from "@chisacode/protocol/daemon/messages";

import type { ProviderSnapshotEntry } from "./agent/agent-sdk-types.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type { AgentManager } from "./agent/agent-manager.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import { loadPersistedConfig } from "./persisted-config.js";
import { resolveLogConfig } from "./logger.js";
import { redactDiagnosticText, type DiagnosticPathRedaction } from "./diagnostic-redaction.js";

const DEFAULT_LOG_LINES = 100;
const MAX_LOG_LINES = 200;
const MAX_LOG_BYTES = 64 * 1024;
const MAX_PROVIDER_COUNT = 20;
const MAX_PROVIDER_DIAGNOSTIC_CHARS = 4_000;
const MAX_REPORT_CHARS = 160_000;

export interface DiagnosticsReportOptions {
  includeLogs?: boolean;
  maxLogLines?: number;
}

export interface DiagnosticsRuntimeConfig {
  listen: string | null;
  relay: {
    enabled: boolean;
    useTls: boolean;
    publicUseTls: boolean;
  } | null;
}

export interface DiagnosticsReportDependencies {
  chisacodeHome: string;
  homeDirectory?: string;
  daemonVersion?: string;
  daemonRuntimeConfig?: DiagnosticsRuntimeConfig;
  daemonConfigStore: Pick<DaemonConfigStore, "get">;
  agentManager: Pick<AgentManager, "listAgents">;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders" | "getProviderDiagnostic">;
  now?: () => Date;
  readLogTail?: (filePath: string, maxLines: number) => Promise<string | null>;
}

function clampLogLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LOG_LINES;
  }
  return Math.min(MAX_LOG_LINES, Math.max(1, Math.trunc(value)));
}

function truncateText(value: string, maxChars: number, marker: string): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
}

function formatAgentCounts(agents: Array<{ lifecycle: string }>): string[] {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    counts.set(agent.lifecycle, (counts.get(agent.lifecycle) ?? 0) + 1);
  }
  return [
    `Total: ${agents.length}`,
    ...Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}: ${count}`),
  ];
}

function formatConfigSummary(config: MutableDaemonConfig): string[] {
  return [
    `Agent MCP injection: ${config.mcp.injectIntoAgents ? "enabled" : "disabled"}`,
    `Provider overrides: ${Object.keys(config.providers).length}`,
    `Model gateways: ${Object.keys(config.modelGateways).length}`,
    `Metadata generation providers: ${config.metadataGeneration.providers.length}`,
    `Managed skills: ${Object.keys(config.skills.installedSources).length}`,
    `Managed MCP servers: ${Object.keys(config.mcpServers.servers).length}`,
    `Auto-archive after merge: ${config.autoArchiveAfterMerge ? "enabled" : "disabled"}`,
    `Append system prompt: ${config.appendSystemPrompt.trim().length > 0 ? "configured" : "not configured"}`,
  ];
}

function formatRuntimeSummary(
  runtimeConfig: DiagnosticsRuntimeConfig | undefined,
  pathRedactions: readonly DiagnosticPathRedaction[],
): string[] {
  const listen = runtimeConfig?.listen
    ? redactDiagnosticText(runtimeConfig.listen, { paths: pathRedactions })
    : "unknown";
  const relay = runtimeConfig?.relay;
  return [
    `Listen: ${listen}`,
    `Relay: ${relay?.enabled ? "enabled" : "disabled"}`,
    `Relay TLS: ${relay ? String(relay.useTls) : "unknown"}`,
    `Relay public TLS: ${relay ? String(relay.publicUseTls) : "unknown"}`,
  ];
}

async function formatProviderSections(
  manager: DiagnosticsReportDependencies["providerSnapshotManager"],
  pathRedactions: readonly DiagnosticPathRedaction[],
): Promise<string[]> {
  let entries: ProviderSnapshotEntry[];
  try {
    entries = await manager.listProviders({ wait: true });
  } catch (error) {
    return [
      "Provider snapshot failed:",
      redactDiagnosticText(error instanceof Error ? error.message : String(error), {
        paths: pathRedactions,
      }),
    ];
  }

  const visibleEntries = entries.slice(0, MAX_PROVIDER_COUNT);
  const sections = await Promise.all(
    visibleEntries.map(async (entry) => {
      const rows = [
        `## ${entry.label ?? entry.provider} (${entry.provider})`,
        `Status: ${entry.status}`,
        `Enabled: ${entry.enabled !== false}`,
        `Version status: ${entry.versionStatus ?? "unknown"}`,
        `Installed version: ${entry.installedVersion ?? "not installed"}`,
        `Latest version: ${entry.latestVersion ?? "unknown"}`,
        `Package: ${entry.packageName ?? "unknown"}`,
      ];
      if (entry.error) {
        rows.push(
          `Snapshot error: ${redactDiagnosticText(entry.error, { paths: pathRedactions })}`,
        );
      }
      try {
        const result = await manager.getProviderDiagnostic(entry.provider);
        const diagnostic = truncateText(
          redactDiagnosticText(result.diagnostic.trim(), { paths: pathRedactions }),
          MAX_PROVIDER_DIAGNOSTIC_CHARS,
          "\n...<provider diagnostic truncated>",
        );
        if (diagnostic) {
          rows.push("", diagnostic);
        }
      } catch (error) {
        rows.push(
          "",
          `Diagnostic failed: ${redactDiagnosticText(
            error instanceof Error ? error.message : String(error),
            { paths: pathRedactions },
          )}`,
        );
      }
      return rows.join("\n");
    }),
  );

  if (entries.length > visibleEntries.length) {
    sections.push(`... ${entries.length - visibleEntries.length} additional providers omitted`);
  }
  return sections;
}

function resolveDiagnosticLogPath(chisacodeHome: string): string {
  try {
    const persisted = loadPersistedConfig(chisacodeHome);
    return (
      resolveLogConfig(persisted, { chisacodeHome }).file?.path ??
      path.join(chisacodeHome, "daemon.log")
    );
  } catch {
    return path.join(chisacodeHome, "daemon.log");
  }
}

async function readBoundedLogTail(filePath: string, maxLines: number): Promise<string | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, "r");
    const stats = await handle.stat();
    const length = Math.min(stats.size, MAX_LOG_BYTES);
    const start = Math.max(0, stats.size - length);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return text.split(/\r?\n/).slice(-maxLines).join("\n").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Builds a bounded, secret-conscious daemon troubleshooting report. */
export async function createDaemonDiagnosticReport(
  dependencies: DiagnosticsReportDependencies,
  options: DiagnosticsReportOptions = {},
): Promise<string> {
  const now = dependencies.now?.() ?? new Date();
  const pathRedactions: DiagnosticPathRedaction[] = [
    { value: dependencies.chisacodeHome, replacement: "<chisacode-home>" },
    { value: dependencies.homeDirectory ?? homedir(), replacement: "<home>" },
  ];
  const config = dependencies.daemonConfigStore.get();
  const agents = dependencies.agentManager.listAgents();
  const providerSections = await formatProviderSections(
    dependencies.providerSnapshotManager,
    pathRedactions,
  );
  const sections = [
    "ChisaCode Diagnostic Report",
    "===========================",
    `Generated: ${now.toISOString()}`,
    "Secrets and home-directory paths are redacted. Daemon logs are opt-in.",
    "",
    "Daemon",
    "------",
    `Version: ${dependencies.daemonVersion ?? "unknown"}`,
    `Node: ${process.version}`,
    `Platform: ${process.platform} ${process.arch}`,
    `PID: ${process.pid}`,
    `Uptime seconds: ${Math.floor(process.uptime())}`,
    "",
    "Runtime",
    "-------",
    ...formatRuntimeSummary(dependencies.daemonRuntimeConfig, pathRedactions),
    "",
    "Configuration summary",
    "---------------------",
    ...formatConfigSummary(config),
    "",
    "Agents",
    "------",
    ...formatAgentCounts(agents),
    "",
    "Providers",
    "---------",
    ...(providerSections.length > 0 ? providerSections : ["No providers registered."]),
  ];

  if (options.includeLogs) {
    const maxLogLines = clampLogLines(options.maxLogLines);
    const logPath = resolveDiagnosticLogPath(dependencies.chisacodeHome);
    const readLogTail = dependencies.readLogTail ?? readBoundedLogTail;
    let logTail: string | null;
    try {
      logTail = await readLogTail(logPath, maxLogLines);
    } catch (error) {
      logTail = `Unable to read daemon log: ${error instanceof Error ? error.message : String(error)}`;
    }
    sections.push(
      "",
      `Recent daemon logs (last ${maxLogLines} lines, explicitly requested)`,
      "--------------------------------------------------------------",
      logTail
        ? redactDiagnosticText(logTail, { paths: pathRedactions })
        : "Daemon log file is unavailable.",
    );
  }

  return truncateText(sections.join("\n"), MAX_REPORT_CHARS, "\n...<diagnostic report truncated>");
}
