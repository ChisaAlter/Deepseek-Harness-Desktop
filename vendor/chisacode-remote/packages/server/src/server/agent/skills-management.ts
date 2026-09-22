import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AgentSkillPayload,
  AgentSkillScopePayload,
  AgentSkillSourcePayload,
  AgentSkillStatus,
  InstalledSkillSource,
  MutableDaemonConfig,
} from "@chisacode/protocol/messages";
import {
  AGENT_PROVIDER_DEFINITIONS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
} from "@chisacode/protocol/provider-manifest";
import type { AgentSkill } from "./agent-sdk-types.js";

const execFileAsync = promisify(execFile);

export interface SkillsListAgent {
  id: string;
  provider?: string | null;
  title?: string | null;
  lastStatus?: string;
  session?: {
    listSkills?: () => Promise<AgentSkill[]>;
  } | null;
}

export interface SkillsListResult {
  scopes: AgentSkillScopePayload[];
  skills: AgentSkillPayload[];
  errors: string[];
}

export interface UserSkillRoots {
  agentsDir: string;
  codexDir: string;
  claudeDir: string;
}

export interface InstallUserSkillOptions {
  roots?: UserSkillRoots;
  installedAt?: string;
  replace?: boolean;
}

export interface UserSkillInstallResult {
  installedSource: InstalledSkillSource;
  skillNames: string[];
}

export interface NormalizedGitHubSkillSource {
  owner: string;
  repo: string;
  id: string;
  url: string;
  archiveUrl: string;
}

const SKILL_PROVIDER_SCOPE_ORDER = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "kimi",
  "grokbuild",
  "dsh",
];

function defaultRoots(): UserSkillRoots {
  const home = homedir();
  return {
    agentsDir: path.join(home, ".agents", "skills"),
    codexDir: path.join(home, ".codex", "skills"),
    claudeDir: path.join(home, ".claude", "skills"),
  };
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function uniqueSorted(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].filter((value) => value.length > 0).sort(compareStrings);
}

async function pathExists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

async function isDirectory(p: string): Promise<boolean> {
  const stat = await fs.stat(p).catch(() => null);
  return stat?.isDirectory() ?? false;
}

function parseFrontMatter(markdown: string): Record<string, string> {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return {};
  const out: Record<string, string> = {};
  for (const line of markdown.slice(4, end).split(/\r?\n/u)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    out[line.slice(0, index).trim()] = line
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

function installedSourceForSkill(
  skillName: string,
  config: MutableDaemonConfig,
): InstalledSkillSource | undefined {
  return Object.values(config.skills.installedSources).find((source) => {
    return source.skillNames.includes(skillName);
  });
}

async function scanRoot(
  rootDir: string,
  sourceType: AgentSkillSourcePayload["type"],
  config: MutableDaemonConfig,
): Promise<AgentSkillPayload[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const skills: AgentSkillPayload[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillDir = path.join(rootDir, entry.name);
    const skillPath = path.join(skillDir, "SKILL.md");
    let content: string;
    try {
      content = await fs.readFile(skillPath, "utf8");
    } catch {
      continue;
    }
    const frontMatter = parseFrontMatter(content);
    const name = frontMatter.name || entry.name;
    const source = installedSourceForSkill(name, config);
    skills.push({
      name,
      description: frontMatter.description,
      sources: [
        {
          id: skillPath,
          type: sourceType,
          path: skillPath,
          ...(source ? { installedSourceId: source.id, removable: true } : { removable: false }),
        },
      ],
      statusByScope: { global: "enabled", providers: {}, agents: {} },
      errors: [],
    });
  }
  return skills;
}

function mergeSkill(target: Map<string, AgentSkillPayload>, skill: AgentSkillPayload): void {
  const existing = target.get(skill.name);
  if (!existing) {
    target.set(skill.name, {
      ...skill,
      sources: [...skill.sources],
      errors: [...skill.errors],
      statusByScope: { global: "enabled", providers: {}, agents: {} },
    });
    return;
  }
  existing.sources.push(...skill.sources);
  existing.errors.push(...skill.errors);
}

function statusForGlobal(skillName: string, config: MutableDaemonConfig): AgentSkillStatus {
  return config.skills.global.disabledSkillNames.includes(skillName)
    ? "global-disabled"
    : "enabled";
}

function statusForProvider(
  skillName: string,
  provider: string,
  config: MutableDaemonConfig,
): AgentSkillStatus {
  const policy = config.skills.providers[provider];
  if (policy?.disabledSkillNames.includes(skillName)) return "agent-disabled";
  if (policy?.enabledSkillNames.includes(skillName)) return "agent-enabled";
  return statusForGlobal(skillName, config);
}

function statusForAgent(
  skillName: string,
  agent: SkillsListAgent,
  config: MutableDaemonConfig,
): AgentSkillStatus {
  const policy = config.skills.agents[agent.id];
  if (policy?.disabledSkillNames.includes(skillName)) return "agent-disabled";
  if (policy?.enabledSkillNames.includes(skillName)) return "agent-enabled";
  return agent.provider
    ? statusForProvider(skillName, agent.provider, config)
    : statusForGlobal(skillName, config);
}

function providerScopeBaseLabel(provider: string | null | undefined): string | null {
  switch (provider) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    case "kimi":
      return "Kimi Code";
    case "grokbuild":
      return "Grok Build";
    case "dsh":
      return "DeepSeek Harness";
    case "mock":
      return "Mock Load Test";
    case "mock-slow":
      return "Mock Slow Provider";
    default:
      return provider?.trim() || null;
  }
}

function providerScopes(
  agents: readonly SkillsListAgent[],
  config: MutableDaemonConfig,
): AgentSkillScopePayload[] {
  const visibleProviders = new Set(AGENT_PROVIDER_DEFINITIONS.map((provider) => provider.id));
  for (const providerId of Object.keys(config.providers ?? {})) {
    visibleProviders.add(providerId);
  }
  for (const providerId of Object.keys(config.skills.providers ?? {})) {
    visibleProviders.add(providerId);
  }
  for (const agent of agents) {
    if (agent.provider) visibleProviders.add(agent.provider);
  }

  const definitions = [
    ...[...AGENT_PROVIDER_DEFINITIONS].sort(
      (a, b) => SKILL_PROVIDER_SCOPE_ORDER.indexOf(a.id) - SKILL_PROVIDER_SCOPE_ORDER.indexOf(b.id),
    ),
    ...DEV_AGENT_PROVIDER_DEFINITIONS.filter((provider) => visibleProviders.has(provider.id)),
  ];

  const scopes: AgentSkillScopePayload[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (!visibleProviders.has(definition.id)) continue;
    scopes.push({
      type: "provider",
      provider: definition.id,
      label: providerScopeBaseLabel(definition.id) ?? definition.label,
    });
    seen.add(definition.id);
  }

  for (const provider of [...visibleProviders].sort(compareStrings)) {
    if (seen.has(provider)) continue;
    scopes.push({
      type: "provider",
      provider,
      label: providerScopeBaseLabel(provider) ?? provider,
    });
  }

  return scopes;
}

function agentScopes(agents: readonly SkillsListAgent[]): AgentSkillScopePayload[] {
  return agents
    .map((agent) => ({
      type: "agent" as const,
      agentId: agent.id,
      label: agent.title?.trim() || agent.id,
      ...(agent.lastStatus ? { status: agent.lastStatus } : {}),
    }))
    .sort((a, b) => compareStrings(a.label, b.label));
}

export async function listManagedSkills(
  agents: readonly SkillsListAgent[],
  config: MutableDaemonConfig,
  roots: UserSkillRoots = defaultRoots(),
): Promise<SkillsListResult> {
  const skillsByName = new Map<string, AgentSkillPayload>();
  const errors: string[] = [];
  for (const skill of [
    ...(await scanRoot(roots.agentsDir, "agents-home", config)),
    ...(await scanRoot(roots.codexDir, "codex-home", config)),
    ...(await scanRoot(roots.claudeDir, "claude-home", config)),
  ]) {
    mergeSkill(skillsByName, skill);
  }

  for (const agent of agents) {
    try {
      const agentSkills = agent.session?.listSkills ? await agent.session.listSkills() : [];
      for (const skill of agentSkills) {
        mergeSkill(skillsByName, {
          name: skill.name,
          description: skill.description,
          sources: skill.sources.map((source) => ({
            id: source.id,
            type: source.type,
            path: source.path,
            installedSourceId: source.installedSourceId,
            removable: source.removable ?? false,
          })),
          statusByScope: { global: "enabled", providers: {}, agents: {} },
          errors: skill.errors ?? [],
        });
      }
    } catch (error) {
      errors.push(`Failed to list skills for ${agent.id}: ${errorMessage(error)}`);
    }
  }

  const skills = Array.from(skillsByName.values()).sort((a, b) => compareStrings(a.name, b.name));
  for (const skill of skills) {
    skill.statusByScope.global = statusForGlobal(skill.name, config);
    skill.statusByScope.providers = Object.fromEntries(
      providerScopes(agents, config)
        .filter((scope) => scope.type === "provider")
        .map((scope) => [scope.provider, statusForProvider(skill.name, scope.provider, config)]),
    );
    skill.statusByScope.agents = Object.fromEntries(
      agents.map((agent) => [agent.id, statusForAgent(skill.name, agent, config)]),
    );
    skill.sources.sort((a, b) => compareStrings(a.path, b.path));
  }

  return {
    scopes: [
      { type: "global", label: "Global" },
      ...providerScopes(agents, config),
      ...agentScopes(agents),
    ],
    skills,
    errors,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validSkillName(name: string): boolean {
  return (
    name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\")
  );
}

async function discoverSkillNames(sourceDir: string): Promise<string[]> {
  const resolved = path.resolve(sourceDir);
  if (!(await isDirectory(resolved)))
    throw new Error(`Skill source is not a directory: ${sourceDir}`);
  if (await pathExists(path.join(resolved, "SKILL.md"))) {
    const name = path.basename(resolved);
    if (!validSkillName(name)) throw new Error(`Invalid skill directory name: ${name}`);
    return [name];
  }
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validSkillName(entry.name)) continue;
    if (await pathExists(path.join(resolved, entry.name, "SKILL.md"))) names.push(entry.name);
  }
  names.sort(compareStrings);
  if (names.length === 0) throw new Error(`No skills found in ${sourceDir}.`);
  return names;
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(src, entry.name);
    const targetPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function assertNoConflicts(
  skillNames: readonly string[],
  roots: UserSkillRoots,
): Promise<void> {
  const conflicts: string[] = [];
  for (const name of skillNames) {
    for (const root of [roots.agentsDir, roots.codexDir, roots.claudeDir]) {
      if (await pathExists(path.join(root, name))) {
        conflicts.push(name);
        break;
      }
    }
  }
  if (conflicts.length > 0)
    throw new Error(`Skill already exists: ${uniqueSorted(conflicts).join(", ")}`);
}

function sourceParent(sourceDir: string, skillNames: readonly string[]): string {
  const resolved = path.resolve(sourceDir);
  return skillNames.length === 1 && path.basename(resolved) === skillNames[0]
    ? path.dirname(resolved)
    : resolved;
}

function localSourceId(localPath: string): string {
  return `local:${createHash("sha256").update(path.resolve(localPath)).digest("hex").slice(0, 16)}`;
}

export async function installUserSkillsFromLocalDirectory(
  localPath: string,
  options: InstallUserSkillOptions = {},
): Promise<UserSkillInstallResult> {
  const roots = options.roots ?? defaultRoots();
  const resolved = path.resolve(localPath);
  const skillNames = await discoverSkillNames(resolved);
  if (!options.replace) await assertNoConflicts(skillNames, roots);
  const parent = sourceParent(resolved, skillNames);
  for (const name of skillNames) {
    for (const root of [roots.agentsDir, roots.codexDir, roots.claudeDir]) {
      await copyDir(path.join(parent, name), path.join(root, name));
    }
  }
  const installedSource: InstalledSkillSource = {
    id: localSourceId(resolved),
    type: "local",
    localPath: resolved,
    installedAt: options.installedAt ?? new Date().toISOString(),
    skillNames,
  };
  return { installedSource, skillNames };
}

export function normalizeGitHubSkillSource(value: string): NormalizedGitHubSkillSource {
  const trimmed = value.trim();
  const slug = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(trimmed);
  let owner = slug?.[1];
  let repo = slug?.[2];
  if (!owner || !repo) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("URL install supports GitHub repository URLs or owner/repo slugs.");
    }
    if (parsed.hostname.toLowerCase() !== "github.com") {
      throw new Error("URL install only supports GitHub repository URLs.");
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    owner = parts[0];
    repo = parts[1]?.replace(/\.git$/, "");
  }
  if (!owner || !repo) throw new Error("GitHub source must include owner and repo.");
  return {
    owner,
    repo,
    id: `github:${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}`,
    archiveUrl: `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`,
  };
}

export async function installUserSkillsFromGitHub(
  value: string,
  options: InstallUserSkillOptions = {},
): Promise<UserSkillInstallResult> {
  const source = normalizeGitHubSkillSource(value);
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "chisacode-skill-github-"));
  const archivePath = path.join(tempRoot, "repo.tar.gz");
  const extractDir = path.join(tempRoot, "extract");
  await fs.mkdir(extractDir, { recursive: true });
  // Bound the download: 60s timeout and 256MB cap to prevent a malicious or
  // oversized repo from exhausting memory or hanging the daemon.
  const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
  const response = await fetch(source.archiveUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Failed to download ${source.url}: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`GitHub archive for ${source.url} exceeds the ${MAX_ARCHIVE_BYTES} byte cap`);
  }
  // Stream the body to disk with a running byte cap so we are not reliant on
  // a trustworthy Content-Length header.
  const reader = response.body?.getReader();
  if (!reader) {
    // Fallback: no streaming reader available, read whole body with cap via
    // arrayBuffer (still bounded by the fetch runtime's own limits).
    await fs.writeFile(archivePath, new Uint8Array(await response.arrayBuffer()));
  } else {
    const fileHandle = await fs.open(archivePath, "w");
    let received = 0;
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        received += chunk.byteLength;
        if (received > MAX_ARCHIVE_BYTES) {
          throw new Error(`GitHub archive for ${source.url} exceeded ${MAX_ARCHIVE_BYTES} bytes`);
        }
        await fileHandle.write(chunk);
      }
    } finally {
      await fileHandle.close();
      try {
        reader.cancel();
      } catch {
        // ignore
      }
    }
  }
  await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const repoRoot = entries.find((entry) => entry.isDirectory());
  if (!repoRoot) throw new Error(`Downloaded GitHub archive for ${source.url} was empty.`);
  const result = await installUserSkillsFromLocalDirectory(
    path.join(extractDir, repoRoot.name),
    options,
  );
  return {
    installedSource: {
      id: source.id,
      type: "github",
      url: source.url,
      installedAt: result.installedSource.installedAt,
      skillNames: result.skillNames,
    },
    skillNames: result.skillNames,
  };
}

export async function uninstallUserInstalledSkills(
  skillNames: readonly string[],
  roots: UserSkillRoots = defaultRoots(),
): Promise<string[]> {
  const removed = uniqueSorted(skillNames);
  for (const name of removed) {
    await Promise.all([
      fs.rm(path.join(roots.agentsDir, name), { recursive: true, force: true }),
      fs.rm(path.join(roots.codexDir, name), { recursive: true, force: true }),
      fs.rm(path.join(roots.claudeDir, name), { recursive: true, force: true }),
    ]);
  }
  return removed;
}
