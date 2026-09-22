import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";

import type { WorkspaceGitService } from "../../../workspace-git-service.js";
import type {
  AgentPromptContentBlock,
  AgentPromptInput,
  AgentSessionConfig,
  AgentSkill,
  AgentSlashCommand,
  AgentStreamEvent,
} from "../../agent-sdk-types.js";
import { CODEX_PROVIDER } from "./client.js";
import type { CodexDiscoveredSkill } from "./skills.js";
import {
  expandCodexCustomPrompt,
  listCodexCustomPrompts,
  listCodexSkillEntries,
  listCodexSkills,
  parseCodexFrontMatter,
  resolveCodexHomeDir,
  resolveSkillPolicy,
  toAgentSkill,
} from "./skills.js";

interface CodexCommandClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

interface CodexCommandMetadata {
  loadSkills(): Promise<void>;
  getEnabledSkills(): CodexDiscoveredSkill[];
  getCachedSkills(): CodexDiscoveredSkill[];
}

interface CodexSessionCommandOptions {
  logger: Logger;
  getConfig: () => AgentSessionConfig;
  getClient: () => CodexCommandClient | null;
  isConnected: () => boolean;
  connect: () => Promise<void>;
  metadata: CodexCommandMetadata;
  workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
  goalsEnabled: boolean;
  getThreadId: () => string | null;
  ensureThreadLoaded: () => Promise<void>;
  ensureThread: () => Promise<void>;
  beginManualCompaction: () => void;
  cancelManualCompactionStart: () => void;
}

type GoalSubcommand =
  | { kind: "set"; objective: string }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" }
  | { kind: "usage" };

interface ParsedSlashCommand {
  commandName: string;
  args?: string;
}

export interface CodexSkillPromptBlock {
  type: "skill";
  name: string;
  path: string;
}

type CodexPromptContentBlock = AgentPromptContentBlock | CodexSkillPromptBlock;
export type CodexPromptInput = string | CodexPromptContentBlock[];

function parseGoalSubcommand(args: string | undefined): GoalSubcommand {
  const trimmed = (args ?? "").trim();
  if (!trimmed) return { kind: "usage" };
  const lower = trimmed.toLowerCase();
  if (lower === "pause") return { kind: "pause" };
  if (lower === "resume") return { kind: "resume" };
  if (lower === "clear") return { kind: "clear" };
  return { kind: "set", objective: trimmed };
}

function formatOutOfBandStatusMessage(text: string): string {
  return `${text.replace(/\n+$/u, "")}\n\n`;
}

function parseSlashCommandInput(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.length <= 1) {
    return null;
  }
  const withoutPrefix = trimmed.slice(1);
  const firstWhitespaceIdx = withoutPrefix.search(/\s/);
  const commandName =
    firstWhitespaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, firstWhitespaceIdx);
  if (!commandName || commandName.includes("/")) {
    return null;
  }
  const rawArgs =
    firstWhitespaceIdx === -1 ? "" : withoutPrefix.slice(firstWhitespaceIdx + 1).trim();
  return rawArgs.length > 0 ? { commandName, args: rawArgs } : { commandName };
}

/** Owns Codex slash-command discovery, expansion, and out-of-band command execution. */
export class CodexSessionCommandController {
  constructor(private readonly options: CodexSessionCommandOptions) {}

  async resolvePrompt(prompt: AgentPromptInput): Promise<CodexPromptInput> {
    if (typeof prompt !== "string") {
      return prompt;
    }
    const parsed = parseSlashCommandInput(prompt);
    if (!parsed) {
      return prompt;
    }
    try {
      const commands = await this.listCommands();
      if (!commands.some((command) => command.name === parsed.commandName)) {
        return prompt;
      }
    } catch (error) {
      this.options.logger.warn(
        { err: error, commandName: parsed.commandName },
        "Failed to resolve slash command; falling back to plain prompt input",
      );
      return prompt;
    }
    return this.buildCommandPromptInput(parsed.commandName, parsed.args);
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    const prompts = await listCodexCustomPrompts();
    await this.refreshSkills();
    const appServerSkills = this.options.metadata.getEnabledSkills().map((skill) => ({
      name: skill.name,
      description: skill.description,
      argumentHint: "",
    }));
    const config = this.options.getConfig();
    const fallbackSkills =
      appServerSkills.length === 0
        ? await listCodexSkills(
            config.cwd,
            this.options.workspaceGitService,
            resolveSkillPolicy(config),
          )
        : [];
    const builtin: AgentSlashCommand[] = [
      {
        name: "compact",
        description: "Summarize conversation to prevent hitting the context limit",
        argumentHint: "",
      },
    ];
    if (this.options.goalsEnabled) {
      builtin.push({
        name: "goal",
        description: "Set, pause, resume, or clear the agent's goal",
        argumentHint: "[<objective>|pause|resume|clear]",
      });
    }
    return [...builtin, ...appServerSkills, ...fallbackSkills, ...prompts].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  async listSkills(): Promise<AgentSkill[]> {
    await this.refreshSkills();
    const cachedSkills = this.options.metadata.getCachedSkills();
    if (cachedSkills.length > 0) {
      return cachedSkills.map(toAgentSkill);
    }
    const config = this.options.getConfig();
    return (await listCodexSkillEntries(config.cwd, this.options.workspaceGitService)).map(
      toAgentSkill,
    );
  }

  tryHandleOutOfBand(prompt: AgentPromptInput): {
    run(ctx: { emit: (event: AgentStreamEvent) => void }): Promise<void>;
  } | null {
    if (typeof prompt !== "string") return null;
    const parsed = parseSlashCommandInput(prompt);
    if (!parsed) return null;

    if (parsed.commandName === "compact") {
      return {
        run: async ({ emit }) => {
          const error = await this.executeCompactCommand();
          if (error) {
            emit({
              type: "timeline",
              provider: CODEX_PROVIDER,
              item: { type: "assistant_message", text: formatOutOfBandStatusMessage(error) },
            });
          }
        },
      };
    }

    if (!this.options.goalsEnabled || parsed.commandName !== "goal") return null;

    const subcommand = parseGoalSubcommand(parsed.args);
    return {
      run: async ({ emit }) => {
        const text = formatOutOfBandStatusMessage(await this.executeGoalSubcommand(subcommand));
        emit({
          type: "timeline",
          provider: CODEX_PROVIDER,
          item: { type: "assistant_message", text },
        });
      },
    };
  }

  private async buildCommandPromptInput(
    commandName: string,
    args?: string,
  ): Promise<CodexPromptInput> {
    if (commandName.startsWith("prompts:")) {
      const promptName = commandName.slice("prompts:".length);
      const promptPath = path.join(resolveCodexHomeDir(), "prompts", `${promptName}.md`);
      const raw = await fs.readFile(promptPath, "utf8");
      const parsed = parseCodexFrontMatter(raw);
      return expandCodexCustomPrompt(parsed.body, args);
    }

    await this.refreshSkills();
    const skill = this.options.metadata
      .getEnabledSkills()
      .find((entry) => entry.name === commandName);
    if (skill) {
      const trimmedArgs = args?.trim() ?? "";
      const text = trimmedArgs ? `$${skill.name} ${trimmedArgs}` : `$${skill.name}`;
      return [
        { type: "skill", name: skill.name, path: skill.path },
        { type: "text", text },
      ];
    }

    return args ? `$${commandName} ${args}` : `$${commandName}`;
  }

  private async refreshSkills(): Promise<void> {
    if (!this.options.isConnected()) {
      await this.options.connect();
      return;
    }
    await this.options.metadata.loadSkills();
  }

  private async getReadyThread(): Promise<{ client: CodexCommandClient; threadId: string }> {
    await this.options.connect();
    if (this.options.getThreadId()) {
      await this.options.ensureThreadLoaded();
    } else {
      await this.options.ensureThread();
    }
    const client = this.options.getClient();
    const threadId = this.options.getThreadId();
    if (!client || !threadId) {
      throw new Error("Codex thread is not available");
    }
    return { client, threadId };
  }

  private async executeCompactCommand(): Promise<string | null> {
    try {
      const { client, threadId } = await this.getReadyThread();
      this.options.beginManualCompaction();
      try {
        await client.request("thread/compact/start", { threadId });
      } catch (error) {
        this.options.cancelManualCompactionStart();
        throw error;
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return `Failed to compact context: ${message}`;
    }
  }

  private async executeGoalSubcommand(subcommand: GoalSubcommand): Promise<string> {
    if (subcommand.kind === "usage") {
      return "Usage: /goal <objective>|pause|resume|clear";
    }
    try {
      const { client, threadId } = await this.getReadyThread();
      switch (subcommand.kind) {
        case "set": {
          await client.request("thread/goal/set", {
            threadId,
            objective: subcommand.objective,
            status: "active",
          });
          return `Goal set: ${subcommand.objective}`;
        }
        case "pause": {
          await client.request("thread/goal/set", { threadId, status: "paused" });
          return "Goal paused.";
        }
        case "resume": {
          await client.request("thread/goal/set", { threadId, status: "active" });
          return "Goal resumed.";
        }
        case "clear": {
          await client.request("thread/goal/clear", { threadId });
          return "Goal cleared.";
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return `Failed to update goal: ${message}`;
    }
  }
}
