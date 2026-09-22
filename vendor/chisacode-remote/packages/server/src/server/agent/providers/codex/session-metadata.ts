import type { Logger } from "pino";

import type { AgentSessionConfig } from "../../agent-sdk-types.js";
import { composeSystemPromptParts } from "../../system-prompt.js";
import { applyAgentSkillPolicy, resolveSkillPolicy, type CodexDiscoveredSkill } from "./skills.js";
import {
  buildRuntimeModelIdentityInstructions,
  type CodexCustomProvider,
} from "./runtime-config.js";
import { normalizeCodexThinkingOptionId } from "./turn-config.js";

interface CodexMetadataClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

export interface CodexCollaborationModeRecord {
  name: string;
  mode?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  developer_instructions?: string | null;
}

export interface ResolvedCodexCollaborationMode {
  mode: string;
  settings: Record<string, unknown>;
  name: string;
}

interface CodexSessionMetadataOptions {
  logger: Logger;
  getClient: () => CodexMetadataClient | null;
  getConfig: () => AgentSessionConfig;
  getTraceContext: () => {
    agentId?: string;
    sessionId?: string;
    turnId?: string;
  };
  customProvider?: CodexCustomProvider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function resolveSkillDescription(skill: Record<string, unknown>): string {
  if (typeof skill.description === "string") {
    return skill.description;
  }
  if (typeof skill.shortDescription === "string") {
    return skill.shortDescription;
  }
  return "Skill";
}

export class CodexSessionMetadata {
  private collaborationModes: CodexCollaborationModeRecord[] = [];
  private resolvedCollaborationMode: ResolvedCodexCollaborationMode | null = null;
  private cachedSkills: CodexDiscoveredSkill[] = [];

  constructor(private readonly options: CodexSessionMetadataOptions) {}

  async loadAll(planModeEnabled: boolean): Promise<void> {
    await this.loadCollaborationModes(planModeEnabled);
    await this.loadSkills();
  }

  async loadCollaborationModes(planModeEnabled: boolean): Promise<void> {
    const client = this.options.getClient();
    if (!client) return;
    try {
      const response = toObjectRecord(await client.request("collaborationMode/list", {}));
      const data = Array.isArray(response?.data) ? response.data : [];
      this.setCollaborationModes(
        data.map((entry) => {
          const record = toObjectRecord(entry);
          return {
            name: typeof record?.name === "string" ? record.name : "",
            mode: typeof record?.mode === "string" ? record.mode : null,
            model: typeof record?.model === "string" ? record.model : null,
            reasoning_effort:
              typeof record?.reasoning_effort === "string" ? record.reasoning_effort : null,
            developer_instructions:
              typeof record?.developer_instructions === "string"
                ? record.developer_instructions
                : null,
          };
        }),
        planModeEnabled,
      );
    } catch (error) {
      this.options.logger.trace(
        { ...this.options.getTraceContext(), error },
        "provider.codex.metadata.collaboration_modes_failed",
      );
      this.setCollaborationModes([], planModeEnabled);
    }
  }

  async loadSkills(): Promise<void> {
    const client = this.options.getClient();
    if (!client) return;
    const config = this.options.getConfig();
    try {
      const response = toObjectRecord(
        await client.request("skills/list", {
          cwd: [config.cwd],
        }),
      );
      const entries = Array.isArray(response?.data) ? response.data : [];
      const skillsByName = new Map<string, CodexDiscoveredSkill>();
      for (const entry of entries) {
        const entryRecord = toObjectRecord(entry);
        const skills = Array.isArray(entryRecord?.skills) ? entryRecord.skills : [];
        for (const skill of skills) {
          const skillRecord = toObjectRecord(skill);
          if (typeof skillRecord?.name !== "string" || typeof skillRecord?.path !== "string") {
            continue;
          }
          if (!skillsByName.has(skillRecord.name)) {
            skillsByName.set(skillRecord.name, {
              name: skillRecord.name,
              description: resolveSkillDescription(skillRecord),
              path: skillRecord.path,
            });
          }
        }
      }
      this.cachedSkills = Array.from(skillsByName.values());
    } catch (error) {
      this.options.logger.trace(
        { ...this.options.getTraceContext(), error },
        "provider.codex.metadata.skills_failed",
      );
      this.cachedSkills = [];
    }
  }

  setCollaborationModes(
    collaborationModes: CodexCollaborationModeRecord[],
    planModeEnabled: boolean,
  ): void {
    this.collaborationModes = collaborationModes;
    this.refreshResolvedCollaborationMode(planModeEnabled);
  }

  refreshResolvedCollaborationMode(planModeEnabled: boolean): void {
    this.resolvedCollaborationMode = this.resolveCollaborationMode(planModeEnabled);
  }

  hasPlanCollaborationMode(): boolean {
    return this.findCollaborationMode("plan") !== null;
  }

  getResolvedCollaborationMode(): ResolvedCodexCollaborationMode | null {
    return this.resolvedCollaborationMode;
  }

  getEnabledSkills(): CodexDiscoveredSkill[] {
    return applyAgentSkillPolicy(this.cachedSkills, resolveSkillPolicy(this.options.getConfig()));
  }

  getCachedSkills(): CodexDiscoveredSkill[] {
    return [...this.cachedSkills];
  }

  private findCollaborationMode(target: "code" | "plan"): CodexCollaborationModeRecord | null {
    if (this.collaborationModes.length === 0) return null;
    const findByName = (predicate: (name: string) => boolean) =>
      this.collaborationModes.find((entry) => predicate(entry.name.toLowerCase()));

    if (target === "plan") {
      return findByName((name) => name.includes("plan") || name.includes("read")) ?? null;
    }
    return (
      findByName((name) => name.includes("auto") || name.includes("code")) ??
      this.collaborationModes.find((entry) => {
        const name = entry.name.toLowerCase();
        return !name.includes("plan") && !name.includes("read");
      }) ??
      this.collaborationModes[0] ??
      null
    );
  }

  private resolveCollaborationMode(
    planModeEnabled: boolean,
  ): ResolvedCodexCollaborationMode | null {
    const match = this.findCollaborationMode(planModeEnabled ? "plan" : "code");
    if (!match) return null;

    const config = this.options.getConfig();
    const settings: Record<string, unknown> = {};
    if (match.model) settings.model = match.model;
    if (match.reasoning_effort) settings.reasoning_effort = match.reasoning_effort;
    const developerInstructions = composeSystemPromptParts(
      match.developer_instructions,
      config.systemPrompt,
      config.daemonAppendSystemPrompt,
      buildRuntimeModelIdentityInstructions(config, this.options.customProvider),
    );
    if (developerInstructions) settings.developer_instructions = developerInstructions;
    if (config.model) settings.model = config.model;
    const thinkingOptionId = normalizeCodexThinkingOptionId(config.thinkingOptionId);
    if (thinkingOptionId) settings.reasoning_effort = thinkingOptionId;
    return { mode: match.mode ?? "code", settings, name: match.name };
  }
}
