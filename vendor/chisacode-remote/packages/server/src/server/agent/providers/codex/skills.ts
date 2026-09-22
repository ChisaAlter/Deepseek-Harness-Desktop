import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AgentSessionConfig,
  AgentSkill,
  AgentSkillEffectivePolicy,
  AgentSlashCommand,
} from "../../agent-sdk-types.js";
import type { WorkspaceGitService } from "../../../workspace-git-service.js";

export interface CodexDiscoveredSkill {
  name: string;
  description: string;
  path: string;
}

export function resolveCodexHomeDir(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

function decodeEscapedChar(next: string): string {
  if (next === "n") return "\n";
  if (next === "t") return "\t";
  return next;
}

function tokenizeCommandArgs(args: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === "\\" && i + 1 < args.length) {
        const next = args[i + 1];
        if (next === quote || next === "\\" || next === "n" || next === "t") {
          i += 1;
          current += decodeEscapedChar(next);
          continue;
        }
      }
      current += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseCodexFrontMatter(markdown: string): {
  frontMatter: Record<string, string>;
  body: string;
} {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontMatter: {}, body: markdown };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontMatter: {}, body: markdown };
  }
  const frontMatter: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]/, "")
      .replace(/['"]$/, "");
    if (key && value) frontMatter[key] = value;
  }
  return { frontMatter, body: lines.slice(end + 1).join("\n") };
}

export async function listCodexCustomPrompts(): Promise<AgentSlashCommand[]> {
  const promptsDir = path.join(resolveCodexHomeDir(), "prompts");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(promptsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const promptFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name.length > 3,
  );
  const commands = await Promise.all(
    promptFiles.map(async (entry): Promise<AgentSlashCommand | null> => {
      try {
        const name = entry.name.slice(0, -3);
        const content = await fs.readFile(path.join(promptsDir, entry.name), "utf8");
        const parsed = parseCodexFrontMatter(content);
        return {
          name: "prompts:" + name,
          description: parsed.frontMatter["description"] ?? "Custom prompt",
          argumentHint:
            parsed.frontMatter["argument-hint"] ?? parsed.frontMatter["argument_hint"] ?? "",
        };
      } catch {
        return null;
      }
    }),
  );
  return commands
    .filter((command): command is AgentSlashCommand => command !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listCodexSkillEntries(
  cwd: string,
  workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">,
): Promise<CodexDiscoveredSkill[]> {
  const candidates = [path.join(cwd, ".codex", "skills")];
  const repoRoot = workspaceGitService
    ? await workspaceGitService.resolveRepoRoot(cwd).catch(() => null)
    : null;
  if (repoRoot) {
    candidates.push(path.join(path.dirname(cwd), ".codex", "skills"));
    candidates.push(path.join(repoRoot, ".codex", "skills"));
  }
  candidates.push(path.join(resolveCodexHomeDir(), "skills"));

  const candidateReads = await Promise.all(
    candidates.map(async (directory) => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return [] as Array<{ path: string; content: string }>;
      }
      const skillContents = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
          .map(async (entry) => {
            const skillPath = path.join(directory, entry.name, "SKILL.md");
            try {
              return { path: skillPath, content: await fs.readFile(skillPath, "utf8") };
            } catch {
              return null;
            }
          }),
      );
      return skillContents.filter(
        (entry): entry is { path: string; content: string } => entry !== null,
      );
    }),
  );

  const skillsByName = new Map<string, CodexDiscoveredSkill>();
  for (const skillEntries of candidateReads) {
    for (const { path: skillPath, content } of skillEntries) {
      const { frontMatter } = parseCodexFrontMatter(content);
      const name = frontMatter["name"];
      const description = frontMatter["description"];
      if (!name || !description || skillsByName.has(name)) continue;
      skillsByName.set(name, { name, description, path: skillPath });
    }
  }
  return Array.from(skillsByName.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function listCodexSkills(
  cwd: string,
  workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">,
  policy?: AgentSkillEffectivePolicy,
): Promise<AgentSlashCommand[]> {
  return applyAgentSkillPolicy(await listCodexSkillEntries(cwd, workspaceGitService), policy).map(
    (skill) => ({ name: skill.name, description: skill.description, argumentHint: "" }),
  );
}

function resolveCodexSkillSourceType(skillPath: string): AgentSkill["sources"][number]["type"] {
  const normalized = path.normalize(skillPath);
  if (normalized.includes(path.normalize(path.sep + ".codex" + path.sep + "skills" + path.sep))) {
    const codexHome = path.normalize(resolveCodexHomeDir());
    return normalized.startsWith(codexHome) ? "codex-home" : "project";
  }
  if (normalized.includes(path.normalize(path.sep + ".agents" + path.sep + "skills" + path.sep))) {
    return "agents-home";
  }
  if (normalized.includes(path.normalize(path.sep + ".claude" + path.sep + "skills" + path.sep))) {
    return "claude-home";
  }
  return "unknown";
}

export function toAgentSkill(skill: CodexDiscoveredSkill): AgentSkill {
  return {
    name: skill.name,
    description: skill.description,
    sources: [{ id: skill.path, type: resolveCodexSkillSourceType(skill.path), path: skill.path }],
    errors: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export function resolveSkillPolicy(
  config: AgentSessionConfig,
): AgentSkillEffectivePolicy | undefined {
  const codexExtra = config.extra?.codex;
  if (!isRecord(codexExtra)) return undefined;
  const policy = codexExtra.skillsPolicy;
  if (!isRecord(policy)) return undefined;
  return {
    globalDisabledSkillNames: stringArray(policy.globalDisabledSkillNames),
    providerEnabledSkillNames: stringArray(policy.providerEnabledSkillNames),
    providerDisabledSkillNames: stringArray(policy.providerDisabledSkillNames),
    agentEnabledSkillNames: stringArray(policy.agentEnabledSkillNames),
    agentDisabledSkillNames: stringArray(policy.agentDisabledSkillNames),
  };
}

function isSkillEnabled(name: string, policy: AgentSkillEffectivePolicy | undefined): boolean {
  if (!policy) return true;
  if (new Set(policy.agentDisabledSkillNames ?? []).has(name)) return false;
  if (new Set(policy.agentEnabledSkillNames ?? []).has(name)) return true;
  if (new Set(policy.providerDisabledSkillNames ?? []).has(name)) return false;
  if (new Set(policy.providerEnabledSkillNames ?? []).has(name)) return true;
  return !new Set(policy.globalDisabledSkillNames ?? []).has(name);
}

export function applyAgentSkillPolicy<T extends { name: string }>(
  skills: readonly T[],
  policy: AgentSkillEffectivePolicy | undefined,
): T[] {
  return skills.filter((skill) => isSkillEnabled(skill.name, policy));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

export function expandCodexCustomPrompt(template: string, args: string | undefined): string {
  const trimmedArgs = args ? args.trim() : "";
  const tokens = trimmedArgs ? tokenizeCommandArgs(trimmedArgs) : [];
  const named: Record<string, string> = {};
  const positional: string[] = [];
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator > 0) {
      const key = token.slice(0, separator);
      if (key) {
        named[key] = token.slice(separator + 1);
        continue;
      }
    }
    positional.push(token);
  }

  const dollarPlaceholder = "__CODEX_DOLLAR_PLACEHOLDER__";
  let output = template.split("$$").join(dollarPlaceholder);
  output = output.split("$ARGUMENTS").join(trimmedArgs);
  for (let i = 1; i <= 9; i += 1) {
    output = output.split("$" + i).join(positional[i - 1] ?? "");
  }
  for (const key of Object.keys(named).sort((left, right) => right.length - left.length)) {
    output = output.replace(new RegExp("\\$" + escapeRegExp(key) + "\\b", "g"), named[key] ?? "");
  }
  return output.split(dollarPlaceholder).join("$");
}
