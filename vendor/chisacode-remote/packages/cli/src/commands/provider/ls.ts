import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import type { Command } from "commander";
import type { CommandOptions, ListResult, OutputSchema } from "../../output/index.js";
import {
  resolveProviderToolingStatus,
  type ProviderSnapshotEntry,
  type ProviderToolingStatus,
} from "@chisacode/protocol/agent-types";
import { AGENT_PROVIDER_DEFINITIONS } from "@chisacode/protocol/provider-manifest";
import { tryConnectToDaemon } from "../../utils/client.js";

type ProviderListClient = Pick<
  DaemonClient,
  "getProvidersSnapshot" | "refreshProvidersSnapshot" | "close"
>;

export interface ProviderListItem {
  provider: ProviderSnapshotEntry["provider"];
  label: string;
  status: string;
  enabled: "Enabled" | "Disabled";
  installedVersion: string;
  latestVersion: string;
  toolingStatus: ProviderToolingStatus;
  defaultMode: string;
  modes: string;
}

export interface ProviderLsCommandDependencies {
  tryConnect(options: { host?: string }): Promise<ProviderListClient | null>;
}

/** Derive provider list from the manifest — single source of truth */
const PROVIDERS: ProviderListItem[] = AGENT_PROVIDER_DEFINITIONS.map((def) => ({
  provider: def.id,
  label: def.label,
  status: "available",
  enabled: "Enabled",
  installedVersion: "-",
  latestVersion: "-",
  toolingStatus: "not-checked",
  defaultMode: def.defaultModeId ?? "-",
  modes: def.modes.length > 0 ? def.modes.map((m) => m.label).join(", ") : "-",
}));

function getStaticProviders(): ProviderListItem[] {
  return PROVIDERS;
}

function formatProviderVersion(version: string | null | undefined): string {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "-";
}

const defaultDependencies: ProviderLsCommandDependencies = {
  tryConnect: tryConnectToDaemon,
};

/** Schema for provider ls output */
export const providerLsSchema: OutputSchema<ProviderListItem> = {
  idField: "provider",
  columns: [
    { header: "PROVIDER", field: "provider", width: 12 },
    { header: "LABEL", field: "label", width: 16 },
    {
      header: "STATUS",
      field: "status",
      width: 12,
      color: (value) => {
        if (value === "available") return "green";
        if (value === "unavailable") return "red";
        return undefined;
      },
    },
    { header: "ENABLED", field: "enabled", width: 10 },
    { header: "INSTALLED", field: "installedVersion", width: 14 },
    { header: "LATEST", field: "latestVersion", width: 14 },
    { header: "TOOLING", field: "toolingStatus", width: 14 },
    { header: "DEFAULT MODE", field: "defaultMode", width: 14 },
    { header: "MODES", field: "modes", width: 30 },
  ],
};

export type ProviderLsResult = ListResult<ProviderListItem>;

export interface ProviderLsOptions extends CommandOptions {
  host?: string;
  refresh?: boolean;
}

export async function runLsCommand(
  options: ProviderLsOptions,
  command: Command,
): Promise<ProviderLsResult> {
  return runProviderLsCommandWithDependencies(options, command, defaultDependencies);
}

export async function runProviderLsCommandWithDependencies(
  options: ProviderLsOptions,
  _command: Command,
  dependencies: ProviderLsCommandDependencies,
): Promise<ProviderLsResult> {
  const client = await dependencies.tryConnect({ host: options.host });

  if (!client) {
    return {
      type: "list",
      data: getStaticProviders(),
      schema: providerLsSchema,
    };
  }

  try {
    if (options.refresh) {
      await client.refreshProvidersSnapshot();
    }
    const snapshot = await client.getProvidersSnapshot();
    return {
      type: "list",
      data: snapshot.entries.map((entry) => ({
        provider: entry.provider,
        label: entry.label ?? entry.provider,
        status: entry.status === "ready" ? "available" : entry.status,
        enabled: !entry.enabled ? "Disabled" : "Enabled",
        installedVersion: formatProviderVersion(entry.installedVersion),
        latestVersion: formatProviderVersion(entry.latestVersion),
        toolingStatus: resolveProviderToolingStatus(entry),
        defaultMode: entry.defaultModeId ?? "default",
        modes: (entry.modes ?? []).map((mode) => mode.label).join(", "),
      })),
      schema: providerLsSchema,
    };
  } catch {
    return {
      type: "list",
      data: getStaticProviders(),
      schema: providerLsSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
