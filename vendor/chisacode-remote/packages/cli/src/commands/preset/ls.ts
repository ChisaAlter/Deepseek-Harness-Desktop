import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import type { AgentPreset } from "@chisacode/protocol/agent-presets";
import type { Command } from "commander";

import type { CommandOptions, ListResult, OutputSchema } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";

type PresetListClient = Pick<DaemonClient, "listAgentPresets" | "close">;

export interface PresetLsCommandDependencies {
  connect(options: { host?: string }): Promise<PresetListClient>;
}

export interface PresetLsOptions extends CommandOptions {
  host?: string;
}

const defaultDependencies: PresetLsCommandDependencies = {
  connect: connectToDaemon,
};

const presetLsSchema: OutputSchema<AgentPreset> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 24 },
    { header: "LABEL", field: "label", width: 24 },
    { header: "PROVIDER", field: "provider", width: 14 },
    { header: "MODE", field: (preset) => preset.modeId ?? "-", width: 16 },
    { header: "MODEL", field: (preset) => preset.model ?? "-", width: 24 },
    { header: "DESCRIPTION", field: "description", width: 48 },
  ],
};

/** Lists built-in and user-defined assistant presets without applying or starting them. */
export async function runPresetLsCommand(
  options: PresetLsOptions,
  command: Command,
): Promise<ListResult<AgentPreset>> {
  return runPresetLsCommandWithDependencies(options, command, defaultDependencies);
}

export async function runPresetLsCommandWithDependencies(
  options: PresetLsOptions,
  _command: Command,
  dependencies: PresetLsCommandDependencies,
): Promise<ListResult<AgentPreset>> {
  const client = await dependencies.connect({ host: options.host });
  try {
    const result = await client.listAgentPresets();
    return {
      type: "list",
      data: result.presets,
      schema: presetLsSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
