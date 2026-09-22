import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  getAgentsSkillsDir,
  getBundledSkillsDir,
  getClaudeSkillsDir,
  getCodexSkillsDir,
} from "./paths.js";
import { listFilesRecursive, removeSkill, syncSkills } from "./sync.js";

const execFileAsync = promisify(execFile);

export type SkillsState = "not-installed" | "up-to-date" | "drift";

export type SkillOp =
  | { kind: "add"; name: string }
  | { kind: "update"; name: string }
  | { kind: "delete"; name: string };

export interface SkillsStatus {
  state: SkillsState;
  ops: SkillOp[];
}

export interface SkillTargets {
  sourceDir: string;
  agentsDir: string;
  claudeDir: string;
  codexDir: string;
}

export interface UserSkillTargets {
  agentsDir: string;
  claudeDir: string;
  codexDir: string;
}

export interface UserInstalledSkillSource {
  id: string;
  type: "github" | "local";
  url?: string;
  localPath?: string;
  installedAt: string;
  skillNames: string[];
}

export interface UserSkillInstallResult {
  installedSource: UserInstalledSkillSource;
  skillNames: string[];
}

export interface InstallUserSkillsOptions {
  targets?: UserSkillTargets;
  replace?: boolean;
  installedAt?: string;
}

export interface NormalizedGitHubSkillSource {
  owner: string;
  repo: string;
  id: string;
  url: string;
  archiveUrl: string;
}

export const CHISACODE_SKILL_NAMES = [
  "chisacode",
  "chisacode-advisor",
  "chisacode-committee",
  "chisacode-epic",
  "chisacode-handoff",
  "chisacode-loop",
  "chisacode-orchestrate",
] as const;

/**
 * Skill names that were previously bundled but have since been removed from
 * the bundle. These are no longer tracked by {@link diff} (so they do not
 * surface as `delete` ops in {@link getSkillsStatus}), but they still need to
 * be cleaned off disk if a prior app version installed them. The cleanup runs
 * as an explicit side effect of {@link installSkills}, {@link updateSkills},
 * and {@link uninstallSkills} via {@link cleanupRetiredSkills}.
 */
export const RETIRED_SKILL_NAMES = ["chisacode-chat", "chisacode-orchestrator"] as const;

type SkillFiles = Map<string, string>;

function resolveSkillTargets(): SkillTargets {
  return {
    sourceDir: getBundledSkillsDir(),
    agentsDir: getAgentsSkillsDir(),
    claudeDir: getClaudeSkillsDir(),
    codexDir: getCodexSkillsDir(),
  };
}

function resolveUserSkillTargets(): UserSkillTargets {
  return {
    agentsDir: getAgentsSkillsDir(),
    claudeDir: getClaudeSkillsDir(),
    codexDir: getCodexSkillsDir(),
  };
}

async function pathIsDirectory(p: string): Promise<boolean> {
  const stat = await fs.stat(p).catch(() => null);
  return stat?.isDirectory() ?? false;
}

async function pathExists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

function isValidSkillName(name: string): boolean {
  return (
    name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\")
  );
}

async function hasSkillMarkdown(dir: string): Promise<boolean> {
  return pathExists(path.join(dir, "SKILL.md"));
}

async function discoverSkillNames(sourceDir: string): Promise<string[]> {
  const resolved = path.resolve(sourceDir);
  if (!(await pathIsDirectory(resolved))) {
    throw new Error(`Skill source is not a directory: ${sourceDir}`);
  }

  if (await hasSkillMarkdown(resolved)) {
    const name = path.basename(resolved);
    if (!isValidSkillName(name)) {
      throw new Error(`Invalid skill directory name: ${name}`);
    }
    return [name];
  }

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidSkillName(entry.name)) continue;
    if (await hasSkillMarkdown(path.join(resolved, entry.name))) {
      names.push(entry.name);
    }
  }
  names.sort(compareStrings);
  if (names.length === 0) {
    throw new Error(
      `No skills found in ${sourceDir}; expected SKILL.md in the directory or its children.`,
    );
  }
  return names;
}

function sourceParentForInstall(sourceDir: string, skillNames: readonly string[]): string {
  const resolved = path.resolve(sourceDir);
  if (skillNames.length === 1 && path.basename(resolved) === skillNames[0]) {
    return path.dirname(resolved);
  }
  return resolved;
}

async function assertNoSkillConflicts(
  skillNames: readonly string[],
  targets: UserSkillTargets,
): Promise<void> {
  const conflicts: string[] = [];
  for (const name of skillNames) {
    for (const root of [targets.agentsDir, targets.claudeDir, targets.codexDir]) {
      if (await pathExists(path.join(root, name))) {
        conflicts.push(name);
        break;
      }
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`Skill already exists: ${conflicts.sort(compareStrings).join(", ")}`);
  }
}

function makeSourceId(type: "github" | "local", value: string): string {
  if (type === "github") return `github:${value}`;
  const sha = createHash("sha256").update(path.resolve(value)).digest("hex").slice(0, 16);
  return `local:${sha}`;
}

async function hashSkillDir(skillDir: string): Promise<SkillFiles | null> {
  const stat = await fs.stat(skillDir).catch(() => null);
  if (!stat?.isDirectory()) return null;

  const rels = await listFilesRecursive(skillDir);
  const files: SkillFiles = new Map();
  for (const rel of rels) {
    const buf = await fs.readFile(path.join(skillDir, rel));
    const sha = createHash("sha256").update(buf).digest("hex");
    files.set(toPosix(rel), sha);
  }
  return files;
}

async function hashSkills(rootDir: string): Promise<Map<string, SkillFiles>> {
  const out = new Map<string, SkillFiles>();
  for (const name of CHISACODE_SKILL_NAMES) {
    const files = await hashSkillDir(path.join(rootDir, name));
    if (files !== null) out.set(name, files);
  }
  return out;
}

function diff(bundle: Map<string, SkillFiles>, disk: Map<string, SkillFiles>): SkillOp[] {
  const ops: SkillOp[] = [];
  for (const name of CHISACODE_SKILL_NAMES) {
    const b = bundle.get(name);
    const d = disk.get(name);
    if (b && !d) ops.push({ kind: "add", name });
    else if (b && d && !filesEqual(b, d)) ops.push({ kind: "update", name });
    else if (!b && d) ops.push({ kind: "delete", name });
  }
  ops.sort((a, b) => compareStrings(a.name, b.name));
  return ops;
}

function filesEqual(a: SkillFiles, b: SkillFiles): boolean {
  if (a.size !== b.size) return false;
  for (const [rel, sha] of a) {
    if (b.get(rel) !== sha) return false;
  }
  return true;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export async function getSkillsStatus(targets?: SkillTargets): Promise<SkillsStatus> {
  const t = targets ?? resolveSkillTargets();
  const [bundle, disk] = await Promise.all([hashSkills(t.sourceDir), hashSkills(t.agentsDir)]);
  const ops = diff(bundle, disk);

  if (disk.size === 0) return { state: "not-installed", ops };
  if (ops.length === 0) return { state: "up-to-date", ops };
  return { state: "drift", ops };
}

async function applySkills(targets: SkillTargets): Promise<SkillsStatus> {
  const status = await getSkillsStatus(targets);

  const writes = status.ops
    .filter((op) => op.kind === "add" || op.kind === "update")
    .map((op) => op.name);
  if (writes.length > 0) {
    await syncSkills({
      sourceDir: targets.sourceDir,
      agentsDir: targets.agentsDir,
      claudeDir: targets.claudeDir,
      codexDir: targets.codexDir,
      skillNames: writes,
    });
  }

  for (const op of status.ops) {
    if (op.kind !== "delete") continue;
    await removeSkill(op.name, {
      agentsDir: targets.agentsDir,
      claudeDir: targets.claudeDir,
      codexDir: targets.codexDir,
    });
  }

  await cleanupRetiredSkills(targets);

  return getSkillsStatus(targets);
}

export async function installSkills(targets?: SkillTargets): Promise<SkillsStatus> {
  return applySkills(targets ?? resolveSkillTargets());
}

export async function updateSkills(targets?: SkillTargets): Promise<SkillsStatus> {
  return applySkills(targets ?? resolveSkillTargets());
}

export async function uninstallSkills(targets?: SkillTargets): Promise<SkillsStatus> {
  const t = targets ?? resolveSkillTargets();
  for (const name of CHISACODE_SKILL_NAMES) {
    await removeSkill(name, {
      agentsDir: t.agentsDir,
      claudeDir: t.claudeDir,
      codexDir: t.codexDir,
    });
  }
  await cleanupRetiredSkills(t);
  return getSkillsStatus(t);
}

/**
 * Removes any retired ChisaCode skill directories left over from prior app
 * versions. Unlike {@link diff}, this does not depend on the current bundle —
 * it unconditionally deletes the directories named in {@link RETIRED_SKILL_NAMES}
 * from all three target locations. User-installed skills (anything not in
 * {@link CHISACODE_SKILL_NAMES} or {@link RETIRED_SKILL_NAMES}) are left alone.
 */
export async function cleanupRetiredSkills(
  targets: Pick<SkillTargets, "agentsDir" | "claudeDir" | "codexDir">,
): Promise<void> {
  for (const name of RETIRED_SKILL_NAMES) {
    await removeSkill(name, {
      agentsDir: targets.agentsDir,
      claudeDir: targets.claudeDir,
      codexDir: targets.codexDir,
    });
  }
}

export async function installUserSkillsFromLocalDirectory(
  localPath: string,
  options: InstallUserSkillsOptions = {},
): Promise<UserSkillInstallResult> {
  const targets = options.targets ?? resolveUserSkillTargets();
  const resolved = path.resolve(localPath);
  const skillNames = await discoverSkillNames(resolved);

  if (!options.replace) {
    await assertNoSkillConflicts(skillNames, targets);
  }

  await syncSkills({
    sourceDir: sourceParentForInstall(resolved, skillNames),
    agentsDir: targets.agentsDir,
    claudeDir: targets.claudeDir,
    codexDir: targets.codexDir,
    skillNames,
  });

  const installedSource: UserInstalledSkillSource = {
    id: makeSourceId("local", resolved),
    type: "local",
    localPath: resolved,
    installedAt: options.installedAt ?? new Date().toISOString(),
    skillNames,
  };

  return { installedSource, skillNames };
}

export function normalizeGitHubSkillSource(value: string): NormalizedGitHubSkillSource {
  const trimmed = value.trim();
  let owner: string | undefined;
  let repo: string | undefined;

  const slugMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(trimmed);
  if (slugMatch) {
    owner = slugMatch[1];
    repo = slugMatch[2];
  } else {
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
    if (parts.length < 2) {
      throw new Error("GitHub URL must include owner and repository.");
    }
    owner = parts[0];
    repo = parts[1].replace(/\.git$/, "");
  }

  if (!owner || !repo) {
    throw new Error("GitHub source must be an owner/repo slug or repository URL.");
  }

  return {
    owner,
    repo,
    id: makeSourceId("github", `${owner}/${repo}`),
    url: `https://github.com/${owner}/${repo}`,
    archiveUrl: `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`,
  };
}

async function downloadGitHubArchive(source: NormalizedGitHubSkillSource): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chisacode-skill-github-"));
  const archivePath = path.join(tempRoot, "repo.tar.gz");
  const extractDir = path.join(tempRoot, "extract");
  await fs.mkdir(extractDir, { recursive: true });

  const response = await fetch(source.archiveUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${source.url}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(archivePath, bytes);
  await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);
  return extractDir;
}

export async function installUserSkillsFromGitHub(
  value: string,
  options: InstallUserSkillsOptions = {},
): Promise<UserSkillInstallResult> {
  const source = normalizeGitHubSkillSource(value);
  const extractDir = await downloadGitHubArchive(source);
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const repoRoot = entries.find((entry) => entry.isDirectory());
  if (!repoRoot) {
    throw new Error(`Downloaded GitHub archive for ${source.url} did not contain a repository.`);
  }

  const result = await installUserSkillsFromLocalDirectory(path.join(extractDir, repoRoot.name), {
    ...options,
    installedAt: options.installedAt,
  });

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
  targets: UserSkillTargets = resolveUserSkillTargets(),
): Promise<string[]> {
  const removed = [...new Set(skillNames)].sort(compareStrings);
  for (const name of removed) {
    await removeSkill(name, targets);
  }
  return removed;
}
