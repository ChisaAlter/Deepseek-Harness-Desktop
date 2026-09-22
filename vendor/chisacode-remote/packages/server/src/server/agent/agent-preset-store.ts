import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import {
  AgentPresetSchema,
  BUILTIN_AGENT_PRESETS,
  type AgentPreset,
} from "@chisacode/protocol/agent-presets";

export class AgentPresetStore {
  private readonly directory: string;
  private readonly logger: Logger;

  constructor(options: { chisacodeHome: string; logger: Logger }) {
    this.directory = path.join(options.chisacodeHome, "presets");
    this.logger = options.logger.child({ module: "agent-preset-store" });
  }

  async list(): Promise<AgentPreset[]> {
    const userPresets = await this.loadUserPresets();
    const seen = new Set<string>();
    const presets: AgentPreset[] = [];
    for (const preset of [...BUILTIN_AGENT_PRESETS, ...userPresets]) {
      if (seen.has(preset.id)) {
        continue;
      }
      seen.add(preset.id);
      presets.push(preset);
    }
    return presets;
  }

  private async loadUserPresets(): Promise<AgentPreset[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const presets: AgentPreset[] = [];
    for (const entry of entries.filter((name) => name.endsWith(".json"))) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(this.directory, entry), "utf8"));
        presets.push(AgentPresetSchema.parse(raw));
      } catch (error) {
        this.logger.warn({ err: error, file: entry }, "Skipping invalid agent preset");
      }
    }
    return presets;
  }
}
