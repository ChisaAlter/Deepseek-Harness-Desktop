import type { Command } from "commander";
import { createRequire } from "node:module";
import { getOrCreateServerId, findExecutable, execCommand } from "@chisacode/server";
import { tryConnectToDaemon } from "../../utils/client.js";
import type { CommandOptions, ListResult, OutputSchema } from "../../output/index.js";
import { resolveLocalDaemonState, resolveTcpHostFromListen } from "./local-daemon.js";
import { resolveNodePathFromPid } from "./runtime-toolchain.js";
import { tCli } from "../../i18n.js";

interface ProviderBinaryStatus {
  label: string;
  path: string | null;
  version: string | null;
  source?: "daemon" | "local";
}

interface DaemonStatus {
  serverId: string | null;
  localDaemon: "running" | "stopped" | "stale_pid" | "unresponsive";
  connectedDaemon: "reachable" | "unreachable" | "not_probed";
  home: string;
  listen: string;
  relay: string;
  hostname: string | null;
  pid: number | null;
  startedAt: string | null;
  owner: string | null;
  logPath: string;
  runningAgents: number | null;
  idleAgents: number | null;
  daemonNode: string;
  cliNode: string;
  cliVersion: string;
  daemonVersion: string | null;
  desktopManaged: boolean;
  providers: ProviderBinaryStatus[];
  note?: string;
}

interface StatusRow {
  key: string;
  value: string;
}

interface CliPackageJson {
  version?: unknown;
}

const require = createRequire(import.meta.url);

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function shortenMessage(message: string, max = 120): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function appendNote(current: string | undefined, next: string | undefined): string | undefined {
  if (!next) return current;
  if (!current) return next;
  return `${current}; ${next}`;
}

function resolveCliVersion(): string {
  try {
    const packageJson = require("../../../package.json") as CliPackageJson;
    if (typeof packageJson.version === "string" && packageJson.version.trim().length > 0) {
      return packageJson.version.trim();
    }
  } catch {
    // Fall through.
  }
  return "unknown";
}

function createStatusSchema(status: DaemonStatus): OutputSchema<StatusRow> {
  return {
    idField: "key",
    columns: [
      { header: tCli("daemon.status.key"), field: "key" },
      {
        header: tCli("daemon.status.value"),
        field: "value",
        color: (_, item) => {
          if (item.key === tCli("daemon.status.localDaemon")) {
            if (item.value === "running") return "green";
            if (item.value === "unresponsive") return "yellow";
            return "red";
          }
          if (item.key === tCli("daemon.status.connectedDaemon")) {
            if (item.value === "reachable") return "green";
            if (item.value === "not_probed") return "yellow";
            return "red";
          }
          if (item.key.startsWith("  ")) {
            if (
              item.value === tCli("daemon.status.notFound") ||
              item.value === tCli("daemon.status.notFoundDaemon")
            )
              return "red";
            if (item.value.endsWith(`(${tCli("daemon.status.versionFailed")})`)) return "yellow";
            return "green";
          }
          return undefined;
        },
      },
    ],
    serialize: () => status,
    collapseIdenticalRows: true,
  };
}

function toStatusRows(status: DaemonStatus): StatusRow[] {
  const rows: StatusRow[] = [
    { key: tCli("daemon.status.serverId"), value: status.serverId ?? "-" },
    { key: tCli("daemon.status.localDaemon"), value: status.localDaemon },
    { key: tCli("daemon.status.connectedDaemon"), value: status.connectedDaemon },
    { key: tCli("daemon.status.home"), value: status.home },
    { key: tCli("daemon.status.listen"), value: status.listen },
    { key: tCli("daemon.status.relay"), value: status.relay },
    { key: tCli("daemon.status.hostname"), value: status.hostname ?? "-" },
    { key: tCli("daemon.status.pid"), value: status.pid === null ? "-" : String(status.pid) },
    { key: tCli("daemon.status.started"), value: status.startedAt ?? "-" },
    { key: tCli("daemon.status.owner"), value: status.owner ?? "-" },
    { key: tCli("daemon.status.logs"), value: status.logPath },
    { key: tCli("daemon.status.daemonNode"), value: status.daemonNode },
    { key: tCli("daemon.status.cliNode"), value: status.cliNode },
    { key: tCli("daemon.status.cli"), value: status.cliVersion },
    { key: tCli("daemon.status.daemonVersion"), value: status.daemonVersion ?? "-" },
  ];

  if (status.runningAgents !== null && status.idleAgents !== null) {
    rows.push({
      key: tCli("daemon.status.agents"),
      value: tCli("daemon.status.agentsCount", {
        running: status.runningAgents,
        idle: status.idleAgents,
      }),
    });
  } else {
    rows.push({
      key: tCli("daemon.status.agents"),
      value: tCli("daemon.status.agentsUnavailable"),
    });
  }

  if (status.note) {
    rows.push({ key: tCli("daemon.status.note"), value: status.note });
  }

  rows.push({ key: "", value: "" });
  rows.push({ key: tCli("daemon.status.providers"), value: "" });
  for (const provider of status.providers) {
    if (provider.source === "daemon") {
      if (!provider.path) {
        rows.push({ key: `  ${provider.label}`, value: tCli("daemon.status.notFoundDaemon") });
      } else {
        rows.push({ key: `  ${provider.label}`, value: `${provider.path} (daemon)` });
      }
    } else if (!provider.path) {
      rows.push({ key: `  ${provider.label}`, value: tCli("daemon.status.notFound") });
    } else if (!provider.version) {
      rows.push({
        key: `  ${provider.label}`,
        value: `${provider.path} (${tCli("daemon.status.versionFailed")})`,
      });
    } else {
      rows.push({ key: `  ${provider.label}`, value: `${provider.path} (${provider.version})` });
    }
  }

  return rows;
}

const PROVIDER_BINARIES: { label: string; binary: string }[] = [
  { label: "Claude", binary: "claude" },
  { label: "Codex", binary: "codex" },
  { label: "OpenCode", binary: "opencode" },
];

async function checkProviderBinary(
  binary: string,
): Promise<{ path: string | null; version: string | null }> {
  const binaryPath = await findExecutable(binary);
  if (!binaryPath) {
    return { path: null, version: null };
  }
  try {
    const { stdout } = await execCommand(binaryPath, ["--version"], {
      timeout: 5000,
    });
    return { path: binaryPath, version: stdout.trim() || null };
  } catch {
    return { path: binaryPath, version: null };
  }
}

async function checkProviderBinaries(): Promise<ProviderBinaryStatus[]> {
  const results = await Promise.all(
    PROVIDER_BINARIES.map(async ({ label, binary }) => {
      const result = await checkProviderBinary(binary);
      return Object.assign({ label }, result);
    }),
  );
  return results;
}

function resolveOwnerLabel(uid: number | undefined, hostname: string | undefined): string | null {
  if (uid === undefined && !hostname) {
    return null;
  }
  const uidPart = uid === undefined ? "?" : String(uid);
  const hostPart = hostname ?? "unknown-host";
  return `${uidPart}@${hostPart}`;
}

interface DaemonProbeResult {
  connectedDaemon: DaemonStatus["connectedDaemon"];
  localDaemonOverride?: DaemonStatus["localDaemon"];
  daemonVersion?: string | null;
  runningAgents?: number;
  idleAgents?: number;
  daemonNodeOverride?: string;
  daemonProviders?: ProviderBinaryStatus[];
  note?: string;
}

async function probeDaemonOverWebsocket(args: {
  host: string;
  state: ReturnType<typeof resolveLocalDaemonState>;
}): Promise<DaemonProbeResult> {
  const { host, state } = args;
  const client = await tryConnectToDaemon({ host, timeout: 1500 });
  if (!client) {
    if (state.running) {
      return {
        connectedDaemon: "unreachable",
        localDaemonOverride: "unresponsive",
        note: tCli("daemon.status.note.pidUnreachable", { host }),
      };
    }
    return { connectedDaemon: "unreachable" };
  }

  const daemonVersion = client.getLastServerInfoMessage()?.version ?? null;
  const supportsDaemonStatusRpc =
    client.getLastServerInfoMessage()?.features?.daemonStatusRpc === true;
  try {
    const agentsPayload = await client.fetchAgents({ filter: { includeArchived: true } });
    const agents = agentsPayload.entries.map((entry) => entry.agent);
    const runningAgents = agents.filter((a) => a.status === "running").length;
    const idleAgents = agents.filter((a) => a.status === "idle").length;

    let daemonProviders: ProviderBinaryStatus[] | undefined;
    if (supportsDaemonStatusRpc) {
      try {
        const statusPayload = await client.getDaemonStatus();
        const labelMap = new Map(PROVIDER_BINARIES.map((p) => [p.binary, p.label]));
        daemonProviders = statusPayload.providers.map((p) => ({
          label: labelMap.get(p.provider) ?? p.provider,
          path: p.available ? "available" : null,
          version: p.available ? null : (p.error ?? null),
          source: "daemon" as const,
        }));
      } catch {
        // COMPAT(daemon-rpc-rollout): fall back to CLI-side provider resolution while
        // old daemons lack daemonStatusRpc. Remove once the daemon floor is past
        // v0.1.76; status should come from daemon.get_status.
      }
    }

    if (!state.running) {
      return {
        connectedDaemon: "reachable",
        daemonVersion,
        runningAgents,
        idleAgents,
        daemonNodeOverride: tCli("daemon.status.daemonNodeUnknownApi"),
        daemonProviders,
        note: state.pidInfo
          ? tCli("daemon.status.note.staleReachable", { host, pid: state.pidInfo.pid })
          : tCli("daemon.status.note.noPidReachable", { host }),
      };
    }

    return {
      connectedDaemon: "reachable",
      daemonVersion,
      runningAgents,
      idleAgents,
      daemonProviders,
    };
  } catch {
    return {
      connectedDaemon: "reachable",
      daemonVersion,
      localDaemonOverride: state.running ? "unresponsive" : undefined,
      note: state.running
        ? tCli("daemon.status.note.apiFailed", { host })
        : tCli("daemon.status.note.fetchFailed", { host }),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

interface ProbeMergeState {
  probe: DaemonProbeResult;
  connectedDaemon: DaemonStatus["connectedDaemon"];
  localDaemon: DaemonStatus["localDaemon"];
  daemonNode: string;
  daemonVersion: string | null;
  runningAgents: number | null;
  idleAgents: number | null;
  daemonProviders: ProviderBinaryStatus[] | undefined;
  note: string | undefined;
}

function applyProbeToStatus(input: ProbeMergeState): Omit<ProbeMergeState, "probe"> {
  const { probe } = input;
  return {
    connectedDaemon: probe.connectedDaemon,
    localDaemon: probe.localDaemonOverride ?? input.localDaemon,
    daemonNode: probe.daemonNodeOverride ?? input.daemonNode,
    daemonVersion: probe.daemonVersion !== undefined ? probe.daemonVersion : input.daemonVersion,
    runningAgents: probe.runningAgents !== undefined ? probe.runningAgents : input.runningAgents,
    idleAgents: probe.idleAgents !== undefined ? probe.idleAgents : input.idleAgents,
    daemonProviders: probe.daemonProviders ?? input.daemonProviders,
    note: probe.note ? appendNote(input.note, probe.note) : input.note,
  };
}

function resolveServerIdSafely(home: string): { serverId: string | null; error: string | null } {
  try {
    return { serverId: getOrCreateServerId(home), error: null };
  } catch (error) {
    return {
      serverId: null,
      error: tCli("daemon.status.note.serverId", {
        message: shortenMessage(normalizeError(error)),
      }),
    };
  }
}

async function resolveDaemonNodeLabel(
  state: ReturnType<typeof resolveLocalDaemonState>,
): Promise<string> {
  if (!state.running) return "-";
  if (!state.pidInfo?.pid) return tCli("daemon.status.daemonNodeUnknownNoPid");
  const fromPid = await resolveNodePathFromPid(state.pidInfo.pid);
  return (
    fromPid.nodePath ??
    tCli("daemon.status.daemonNodeUnknownError", {
      message: fromPid.error ?? "could not resolve from PID",
    })
  );
}

function formatRelayStatus(state: ReturnType<typeof resolveLocalDaemonState>): string {
  if (!state.relayEnabled) return tCli("daemon.status.relayDisabled");
  const scheme = state.relayPublicUseTls ? "wss" : "ws";
  return `${scheme}://${state.relayEndpoint}`;
}

export type StatusResult = ListResult<StatusRow>;

export async function runStatusCommand(
  options: CommandOptions,
  _command: Command,
): Promise<StatusResult> {
  const home = typeof options.home === "string" ? options.home : undefined;
  const state = resolveLocalDaemonState({ home });
  const host = resolveTcpHostFromListen(state.listen);

  const owner = resolveOwnerLabel(state.pidInfo?.uid, state.pidInfo?.hostname);
  let daemonNode = await resolveDaemonNodeLabel(state);
  const cliNode = process.execPath;
  let localDaemon: DaemonStatus["localDaemon"] = state.running ? "running" : "stopped";
  let connectedDaemon: DaemonStatus["connectedDaemon"] = "not_probed";
  let runningAgents: number | null = null;
  let idleAgents: number | null = null;
  let daemonVersion: string | null = null;
  let daemonProviders: ProviderBinaryStatus[] | undefined;
  let note: string | undefined;

  if (!state.running && state.stalePidFile && state.pidInfo) {
    localDaemon = "stale_pid";
    note = tCli("daemon.status.note.stalePid", { pid: state.pidInfo.pid });
  }

  if (host) {
    const probe = await probeDaemonOverWebsocket({ host, state });
    ({
      connectedDaemon,
      localDaemon,
      daemonNode,
      daemonVersion,
      runningAgents,
      idleAgents,
      daemonProviders,
      note,
    } = applyProbeToStatus({
      probe,
      connectedDaemon,
      localDaemon,
      daemonNode,
      daemonVersion,
      runningAgents,
      idleAgents,
      daemonProviders,
      note,
    }));
  } else {
    note = appendNote(note, tCli("daemon.status.note.unixSkipped"));
  }

  const cliVersion = resolveCliVersion();

  const serverIdResult = resolveServerIdSafely(state.home);
  const serverId = serverIdResult.serverId;
  if (serverIdResult.error) {
    note = appendNote(note, serverIdResult.error);
  }

  const providers = daemonProviders ?? (await checkProviderBinaries());

  const daemonStatus: DaemonStatus = {
    serverId,
    localDaemon,
    connectedDaemon,
    home: state.home,
    listen: state.listen,
    relay: formatRelayStatus(state),
    hostname: state.pidInfo?.hostname ?? null,
    pid: state.pidInfo?.pid ?? null,
    startedAt: state.pidInfo?.startedAt ?? null,
    owner,
    logPath: state.logPath,
    runningAgents,
    idleAgents,
    daemonNode,
    cliNode,
    cliVersion,
    daemonVersion,
    desktopManaged: state.pidInfo?.desktopManaged === true,
    providers,
    note,
  };

  return {
    type: "list",
    data: toStatusRows(daemonStatus),
    schema: createStatusSchema(daemonStatus),
  };
}
