import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, realpathSync, statSync } from "fs";
import { copyFile, stat } from "fs/promises";
import { join, basename, dirname, resolve, sep } from "path";
import net from "node:net";
import { createHash } from "node:crypto";
import stripAnsi from "strip-ansi";
import { buildStringCommandShellInvocation } from "./string-command-shell.js";
import { readChisaCodeConfigJson, resolveChisaCodeConfigPath } from "./chisacode-config-file.js";
export {
  ChisaCodeConfigRawSchema,
  ChisaCodeLifecycleCommandRawSchema,
  ChisaCodeScriptEntryRawSchema,
  ChisaCodeWorktreeConfigRawSchema,
  ChisaCodeConfigSchema,
  type ChisaCodeConfig,
  type ChisaCodeConfigRaw,
} from "@chisacode/protocol/chisacode-config-schema";
import {
  ChisaCodeConfigSchema,
  type ChisaCodeConfig,
} from "@chisacode/protocol/chisacode-config-schema";
import {
  normalizeBaseRefName,
  readChisaCodeWorktreeMetadata,
  readChisaCodeWorktreeRuntimePort,
  writeChisaCodeWorktreeMetadata,
  writeChisaCodeWorktreeRuntimeMetadata,
} from "./worktree-metadata.js";
import { runGitCommand } from "./run-git-command.js";
import { spawnProcess } from "./spawn.js";
import { resolveChisaCodeHome } from "../server/chisacode-home.js";
import { createExternalProcessEnv } from "../server/chisacode-env.js";
import { parseGitRevParsePath, resolveGitRevParsePath } from "./git-rev-parse-path.js";
import { validateBranchSlug } from "@chisacode/protocol/branch-slug";

export { slugify, validateBranchSlug } from "@chisacode/protocol/branch-slug";

const execFileAsync = promisify(execFile);
const READ_ONLY_GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
} as const;

export interface WorktreeConfig {
  branchName: string;
  worktreePath: string;
}

export interface WorktreeRuntimeEnv {
  [key: string]: string;
  CHISACODE_SOURCE_CHECKOUT_PATH: string;
  CHISACODE_ROOT_PATH: string;
  CHISACODE_WORKTREE_PATH: string;
  CHISACODE_BRANCH_NAME: string;
  CHISACODE_WORKTREE_PORT: string;
}

export interface WorktreeSetupCommandResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

export type WorktreeSetupCommandProgressEvent =
  | {
      type: "command_started";
      index: number;
      total: number;
      command: string;
      cwd: string;
    }
  | {
      type: "output";
      index: number;
      total: number;
      command: string;
      cwd: string;
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | {
      type: "command_completed";
      index: number;
      total: number;
      command: string;
      cwd: string;
      exitCode: number | null;
      durationMs: number;
      stdout: string;
      stderr: string;
    };

export interface WorktreeTerminalConfig {
  name?: string;
  command: string;
}

export interface PlainScriptConfig {
  type?: undefined;
  command: string;
  port?: undefined;
}

export interface ServiceScriptConfig {
  type: "service";
  command: string;
  port?: number; // explicit port override, otherwise auto-assigned
}

export type ScriptConfig = PlainScriptConfig | ServiceScriptConfig;

export function isServiceScript(config: ScriptConfig): config is ServiceScriptConfig {
  return "type" in config && config.type === "service";
}

export class WorktreeSetupError extends Error {
  readonly results: WorktreeSetupCommandResult[];

  constructor(message: string, results: WorktreeSetupCommandResult[]) {
    super(message);
    this.name = "WorktreeSetupError";
    this.results = results;
  }
}

export type WorktreeTeardownCommandResult = WorktreeSetupCommandResult;

export class WorktreeTeardownError extends Error {
  readonly results: WorktreeTeardownCommandResult[];

  constructor(message: string, results: WorktreeTeardownCommandResult[]) {
    super(message);
    this.name = "WorktreeTeardownError";
    this.results = results;
  }
}

export interface ChisaCodeWorktreeInfo {
  path: string;
  createdAt: string;
  branchName?: string;
  head?: string;
}

export interface ChisaCodeWorktreeOwnership {
  allowed: boolean;
  repoRoot?: string;
  worktreeRoot?: string;
  worktreePath?: string;
}

export type WorktreeSource =
  | { kind: "branch-off"; baseBranch: string; branchName: string }
  | { kind: "checkout-branch"; branchName: string }
  | {
      kind: "checkout-github-pr";
      githubPrNumber: number;
      headRef: string;
      baseRefName: string;
      localBranchName?: string;
      pushRemoteUrl?: string;
    };

export interface CreateWorktreeOptions {
  cwd: string;
  worktreeSlug: string;
  source: WorktreeSource;
  runSetup: boolean;
  chisacodeHome?: string;
}

interface ResolveExistingWorktreeForSlugOptions {
  slug: string;
  repoRoot: string;
  chisacodeHome?: string;
}

export class BranchAlreadyCheckedOutError extends Error {
  readonly branchName: string;

  constructor(branchName: string) {
    super(`Branch already checked out: ${branchName}`);
    this.name = "BranchAlreadyCheckedOutError";
    this.branchName = branchName;
  }
}

export class UnknownBranchError extends Error {
  readonly branchName: string;
  readonly cwd: string;

  constructor(params: { branchName: string; cwd: string }) {
    super(`Unknown branch: ${params.branchName}`);
    this.name = "UnknownBranchError";
    this.branchName = params.branchName;
    this.cwd = params.cwd;
  }
}

export type ReadChisaCodeConfigResult =
  | { ok: true; config: ChisaCodeConfig | null }
  | { ok: false; configPath: string; error: unknown };

export function readChisaCodeConfig(repoRoot: string): ReadChisaCodeConfigResult {
  try {
    const json = readChisaCodeConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null };
    }
    return { ok: true, config: ChisaCodeConfigSchema.parse(json) };
  } catch (error) {
    return { ok: false, configPath: resolveChisaCodeConfigPath(repoRoot), error };
  }
}

export function chisacodeConfigParseError(failure: { configPath: string; error: unknown }): Error {
  const detail = failure.error instanceof Error ? failure.error.message : String(failure.error);
  return new Error(`Failed to parse project config at ${failure.configPath}: ${detail}`, {
    cause: failure.error,
  });
}

function readChisaCodeConfigOrThrow(repoRoot: string): ChisaCodeConfig | null {
  const result = readChisaCodeConfig(repoRoot);
  if (!result.ok) {
    throw chisacodeConfigParseError(result);
  }
  return result.config;
}

export function getWorktreeSetupCommands(repoRoot: string): string[] {
  return readChisaCodeConfigOrThrow(repoRoot)?.worktree?.setup ?? [];
}

export function getWorktreeTeardownCommands(repoRoot: string): string[] {
  return readChisaCodeConfigOrThrow(repoRoot)?.worktree?.teardown ?? [];
}

export function getWorktreeTerminalSpecs(repoRoot: string): WorktreeTerminalConfig[] {
  const terminals = readChisaCodeConfigOrThrow(repoRoot)?.worktree?.terminals;
  if (!Array.isArray(terminals) || terminals.length === 0) {
    return [];
  }

  const specs: WorktreeTerminalConfig[] = [];
  for (const terminal of terminals) {
    if (!terminal || typeof terminal !== "object") {
      continue;
    }

    const rawCommand = terminal.command;
    if (typeof rawCommand !== "string") {
      continue;
    }
    const command = rawCommand.trim();
    if (!command) {
      continue;
    }

    const rawName = terminal.name;
    const name =
      typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : undefined;

    specs.push({
      ...(name ? { name } : {}),
      command,
    });
  }

  return specs;
}

export function getScriptConfigs(config: ChisaCodeConfig | null): Map<string, ScriptConfig> {
  const scripts = config?.scripts;
  if (!scripts || typeof scripts !== "object") {
    return new Map();
  }

  const result = new Map<string, ScriptConfig>();
  for (const [name, entry] of Object.entries(scripts)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const rawCommand = entry.command;
    if (typeof rawCommand !== "string") {
      continue;
    }
    const command = rawCommand.trim();
    if (!command) {
      continue;
    }

    const scriptConfig: ScriptConfig =
      entry.type === "service"
        ? {
            type: "service",
            command,
          }
        : { command };

    if (
      isServiceScript(scriptConfig) &&
      typeof entry.port === "number" &&
      Number.isFinite(entry.port)
    ) {
      scriptConfig.port = entry.port;
    }

    result.set(name, scriptConfig);
  }

  return result;
}

export function processCarriageReturns(text: string): string {
  if (!text.includes("\r")) {
    return text;
  }

  const output: string[] = [];
  let line: string[] = [];
  let cursor = 0;

  const flushLine = () => {
    output.push(line.join(""));
    line = [];
    cursor = 0;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "\r") {
      if (text[index + 1] === "\n") {
        flushLine();
        output.push("\n");
        index += 1;
        continue;
      }
      cursor = 0;
      continue;
    }

    if (char === "\n") {
      flushLine();
      output.push("\n");
      continue;
    }

    if (cursor < line.length) {
      line[cursor] = char;
    } else {
      line.push(char);
    }
    cursor += 1;
  }

  if (line.length > 0) {
    output.push(line.join(""));
  }

  return output.join("");
}

async function execSetupCommand(
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<WorktreeSetupCommandResult> {
  const startedAt = Date.now();
  const shellInvocation = buildStringCommandShellInvocation({ command });
  try {
    const { stdout, stderr } = await execFileAsync(shellInvocation.shell, shellInvocation.args, {
      cwd: options.cwd,
      env: options.env,
    });
    return {
      command,
      cwd: options.cwd,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const execErr = error as { stdout?: string; stderr?: string; code?: unknown } | undefined;
    return {
      command,
      cwd: options.cwd,
      stdout: execErr?.stdout ?? "",
      stderr: execErr?.stderr ?? (error instanceof Error ? error.message : String(error)),
      exitCode: typeof execErr?.code === "number" ? execErr.code : null,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function execSetupCommandStreamed(options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  index: number;
  total: number;
  onEvent?: (event: WorktreeSetupCommandProgressEvent) => void;
}): Promise<WorktreeSetupCommandResult> {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;

    const emitOutput = (stream: "stdout" | "stderr", chunk: string) => {
      const text = stripAnsi(chunk);
      if (!text) {
        return;
      }
      if (stream === "stdout") {
        stdoutChunks.push(text);
      } else {
        stderrChunks.push(text);
      }
      options.onEvent?.({
        type: "output",
        index: options.index,
        total: options.total,
        command: options.command,
        cwd: options.cwd,
        stream,
        chunk: text,
      });
    };

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      const result: WorktreeSetupCommandResult = {
        command: options.command,
        cwd: options.cwd,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        exitCode,
        durationMs: Date.now() - startedAt,
      };
      options.onEvent?.({
        type: "command_completed",
        index: options.index,
        total: options.total,
        command: options.command,
        cwd: options.cwd,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      resolvePromise(result);
    };

    options.onEvent?.({
      type: "command_started",
      index: options.index,
      total: options.total,
      command: options.command,
      cwd: options.cwd,
    });

    const shellInvocation = buildStringCommandShellInvocation({ command: options.command });
    const child = spawnProcess(shellInvocation.shell, shellInvocation.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      emitOutput("stdout", chunk.toString());
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      emitOutput("stderr", chunk.toString());
    });

    child.on("error", (error) => {
      emitOutput("stderr", error instanceof Error ? error.message : String(error));
      finish(null);
    });

    child.on("close", (code) => {
      finish(typeof code === "number" ? code : null);
    });
  });
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire available port")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(address.port);
      });
    });
  });
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      let message: string;
      if (error?.code === "EADDRINUSE") {
        message = `Persisted worktree port ${port} is already in use`;
      } else if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error);
      }
      reject(new Error(message));
    });
    server.listen(port, () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise();
      });
    });
  });
}

async function inferRepoRootPathFromWorktreePath(worktreePath: string): Promise<string> {
  try {
    const commonDir = await getGitCommonDir(worktreePath);
    const normalizedCommonDir = normalizePathForOwnership(commonDir);
    // Normal repo/worktree: common dir is <repoRoot>/.git
    if (basename(normalizedCommonDir) === ".git") {
      return dirname(normalizedCommonDir);
    }
    // Bare repo: common dir is the repo dir itself
    return normalizedCommonDir;
  } catch {
    // Fallback: best-effort resolve toplevel (will be the worktree root in typical cases)
    try {
      const { stdout } = await runGitCommand(["rev-parse", "--show-toplevel"], {
        cwd: worktreePath,
        envOverlay: READ_ONLY_GIT_ENV,
      });
      const topLevel = parseGitRevParsePath(stdout);
      if (topLevel) {
        return normalizePathForOwnership(topLevel);
      }
    } catch {
      // ignore
    }
    return normalizePathForOwnership(worktreePath);
  }
}

async function cleanupFailedWorktreeSetup(worktreePath: string): Promise<boolean> {
  // Route setup-failure cleanup through the same exclusive delete path as
  // archive/delete so concurrent mutations cannot race this worktree.
  try {
    const { workspaceMutationCoordinator } =
      await import("../server/workspace-mutation-coordinator.js");
    return await workspaceMutationCoordinator.runExclusive(
      worktreePath,
      "setup-failure-cleanup",
      async ({ setState }) => {
        setState("quiescing", "setup_failure_cleanup_begin");
        await workspaceMutationCoordinator.waitForWritesToDrain(worktreePath);
        try {
          await runGitCommand(["worktree", "remove", worktreePath], {
            cwd: worktreePath,
            timeout: 120_000,
          });
        } catch {
          setState("setup_failed_recovery", "setup_failure_cleanup_preserved_unknown_output");
          return false;
        }
        setState("archived", "setup_failure_cleanup_complete");
        return true;
      },
    );
  } catch {
    // Lock/import uncertainty is never authorization for destructive cleanup.
    return false;
  }
}

export async function runWorktreeSetupCommands(options: {
  worktreePath: string;
  branchName: string;
  cleanupOnFailure: boolean;
  repoRootPath?: string;
  runtimeEnv?: WorktreeRuntimeEnv;
  onEvent?: (event: WorktreeSetupCommandProgressEvent) => void;
}): Promise<WorktreeSetupCommandResult[]> {
  // Read chisacode.json from the worktree (it will have the same content as the source repo)
  const setupCommands = getWorktreeSetupCommands(options.worktreePath);
  if (setupCommands.length === 0) {
    return [];
  }

  const runtimeEnv =
    options.runtimeEnv ??
    (await resolveWorktreeRuntimeEnv({
      worktreePath: options.worktreePath,
      branchName: options.branchName,
      ...(options.repoRootPath ? { repoRootPath: options.repoRootPath } : {}),
    }));
  const setupEnv = createExternalProcessEnv(process.env, runtimeEnv);

  const results: WorktreeSetupCommandResult[] = [];
  for (const [index, cmd] of setupCommands.entries()) {
    const result = options.onEvent
      ? await execSetupCommandStreamed({
          command: cmd,
          cwd: options.worktreePath,
          env: setupEnv,
          index: index + 1,
          total: setupCommands.length,
          onEvent: options.onEvent,
        })
      : await execSetupCommand(cmd, {
          cwd: options.worktreePath,
          env: setupEnv,
        });
    results.push(result);

    if (result.exitCode !== 0) {
      let cleanupNote = "";
      if (options.cleanupOnFailure) {
        const removed = await cleanupFailedWorktreeSetup(options.worktreePath);
        if (!removed) {
          cleanupNote = `\nWorktree preserved for recovery: ${options.worktreePath}`;
        }
      }
      throw new WorktreeSetupError(
        `Worktree setup command failed: ${cmd}\n${result.stderr}${cleanupNote}`.trim(),
        results,
      );
    }
  }

  return results;
}

async function resolveBranchNameForWorktreePath(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await runGitCommand(["branch", "--show-current"], {
      cwd: worktreePath,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const branchName = stdout.trim();
    if (branchName.length > 0) {
      return branchName;
    }
  } catch {
    // ignore
  }

  return basename(worktreePath);
}

export async function resolveWorktreeRuntimeEnv(options: {
  worktreePath: string;
  branchName?: string;
  repoRootPath?: string;
}): Promise<WorktreeRuntimeEnv> {
  const repoRootPath =
    options.repoRootPath ?? (await inferRepoRootPathFromWorktreePath(options.worktreePath));
  const branchName =
    options.branchName ?? (await resolveBranchNameForWorktreePath(options.worktreePath));

  let worktreePort = readChisaCodeWorktreeRuntimePort(options.worktreePath);
  if (worktreePort === null) {
    worktreePort = await getAvailablePort();
    const metadata = readChisaCodeWorktreeMetadata(options.worktreePath);
    if (metadata) {
      writeChisaCodeWorktreeRuntimeMetadata(options.worktreePath, { worktreePort });
    }
  } else {
    await assertPortAvailable(worktreePort);
  }

  return {
    // Source checkout path is the original git repo root (shared across worktrees), not the
    // worktree itself. This allows setup scripts to copy local files (e.g. .env) from the
    // source checkout.
    CHISACODE_SOURCE_CHECKOUT_PATH: repoRootPath,
    CHISACODE_ROOT_PATH: repoRootPath,
    CHISACODE_WORKTREE_PATH: options.worktreePath,
    CHISACODE_BRANCH_NAME: branchName,
    CHISACODE_WORKTREE_PORT: String(worktreePort),
  };
}

export async function runWorktreeTeardownCommands(options: {
  worktreePath: string;
  branchName?: string;
  repoRootPath?: string;
}): Promise<WorktreeTeardownCommandResult[]> {
  // Read chisacode.json from the worktree (it will have the same content as the source repo)
  const teardownCommands = getWorktreeTeardownCommands(options.worktreePath);
  if (teardownCommands.length === 0) {
    return [];
  }

  const repoRootPath =
    options.repoRootPath ?? (await inferRepoRootPathFromWorktreePath(options.worktreePath));
  const branchName =
    options.branchName ?? (await resolveBranchNameForWorktreePath(options.worktreePath));
  const worktreePort = readChisaCodeWorktreeRuntimePort(options.worktreePath);

  const teardownEnv: NodeJS.ProcessEnv = createExternalProcessEnv(process.env, {
    // Source checkout path is the original git repo root (shared across worktrees), not the
    // worktree itself. This allows lifecycle scripts to copy or clean resources using paths
    // from the source checkout.
    CHISACODE_SOURCE_CHECKOUT_PATH: repoRootPath,
    CHISACODE_ROOT_PATH: repoRootPath,
    CHISACODE_WORKTREE_PATH: options.worktreePath,
    CHISACODE_BRANCH_NAME: branchName,
    ...(worktreePort !== null ? { CHISACODE_WORKTREE_PORT: String(worktreePort) } : {}),
  });

  const results: WorktreeTeardownCommandResult[] = [];
  for (const cmd of teardownCommands) {
    const result = await execSetupCommand(cmd, {
      cwd: options.worktreePath,
      env: teardownEnv,
    });
    results.push(result);

    if (result.exitCode !== 0) {
      throw new WorktreeTeardownError(
        `Worktree teardown command failed: ${cmd}\n${result.stderr}`.trim(),
        results,
      );
    }
  }

  return results;
}

/**
 * Get the git common directory (shared across worktrees) for a given cwd.
 * This is where refs, objects, etc. are stored.
 */
export async function getGitCommonDir(cwd: string): Promise<string> {
  const { stdout } = await runGitCommand(["rev-parse", "--git-common-dir"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const commonDir = resolveGitRevParsePath(cwd, stdout);
  if (!commonDir) {
    throw new Error("Not in a git repository");
  }
  return commonDir;
}

const WORKTREE_PROJECT_HASH_LENGTH = 8;

function deriveShortAlphanumericHash(value: string): string {
  const digest = createHash("sha256").update(value).digest();
  let hashValue = 0n;
  for (let index = 0; index < 8; index += 1) {
    hashValue = (hashValue << 8n) | BigInt(digest[index] ?? 0);
  }
  return hashValue.toString(36).padStart(13, "0").slice(0, WORKTREE_PROJECT_HASH_LENGTH);
}

export async function deriveWorktreeProjectHash(cwd: string): Promise<string> {
  try {
    const commonDir = await getGitCommonDir(cwd);
    const normalizedCommonDir = normalizePathForOwnership(commonDir);
    const repoRoot =
      basename(normalizedCommonDir) === ".git" ? dirname(normalizedCommonDir) : normalizedCommonDir;
    return deriveShortAlphanumericHash(repoRoot);
  } catch {
    return deriveShortAlphanumericHash(normalizePathForOwnership(cwd));
  }
}

export async function getChisaCodeWorktreesRoot(
  cwd: string,
  chisacodeHome?: string,
): Promise<string> {
  const home = chisacodeHome ? resolve(chisacodeHome) : resolveChisaCodeHome();
  const projectHash = await deriveWorktreeProjectHash(cwd);
  return join(home, "worktrees", projectHash);
}

export async function computeWorktreePath(
  cwd: string,
  slug: string,
  chisacodeHome?: string,
): Promise<string> {
  const worktreesRoot = await getChisaCodeWorktreesRoot(cwd, chisacodeHome);
  return join(worktreesRoot, slug);
}

function normalizePathForOwnership(input: string): string {
  try {
    return realpathSync(input);
  } catch {
    return resolve(input);
  }
}

function resolveRepoRootFromGitCommonDir(commonDir: string): string {
  const normalizedCommonDir = normalizePathForOwnership(commonDir);
  return basename(normalizedCommonDir) === ".git"
    ? dirname(normalizedCommonDir)
    : normalizedCommonDir;
}

export async function isChisaCodeOwnedWorktreeCwd(
  cwd: string,
  options?: { chisacodeHome?: string },
): Promise<ChisaCodeWorktreeOwnership> {
  const resolvedCwd = normalizePathForOwnership(cwd);

  // repoRoot is best-effort: git may be unreachable from the worktree (e.g. a
  // previous archive attempt removed the admin dir before the working tree
  // could be fully cleaned up). We still want to allow archiving in that case.
  let repoRoot: string | undefined;
  try {
    const gitCommonDir = await getGitCommonDir(cwd);
    repoRoot = resolveRepoRootFromGitCommonDir(gitCommonDir);
  } catch {
    // ignore
  }

  const chisacodeHome = options?.chisacodeHome
    ? resolve(options.chisacodeHome)
    : resolveChisaCodeHome();
  const chisacodeWorktreesPrefix =
    normalizePathForOwnership(join(chisacodeHome, "worktrees")) + sep;

  // Ownership is defined by the path living under $CHISACODE_HOME/worktrees/<hash>/<slug>[/...].
  // The <hash>/<slug> prefix is ChisaCode-private — nothing else writes there — so the
  // path shape alone is sufficient proof of ownership, even when git has already
  // forgotten about the worktree.
  if (!resolvedCwd.startsWith(chisacodeWorktreesPrefix)) {
    return {
      allowed: false,
      ...(repoRoot !== undefined ? { repoRoot } : {}),
      worktreePath: resolvedCwd,
    };
  }

  const relative = resolvedCwd.slice(chisacodeWorktreesPrefix.length);
  const parts = relative.split(sep).filter((part) => part.length > 0);
  if (parts.length < 2) {
    return {
      allowed: false,
      ...(repoRoot !== undefined ? { repoRoot } : {}),
      worktreePath: resolvedCwd,
    };
  }

  const worktreesRoot = join(chisacodeHome, "worktrees", parts[0]);
  return {
    allowed: true,
    ...(repoRoot !== undefined ? { repoRoot } : {}),
    worktreeRoot: worktreesRoot,
    worktreePath: resolvedCwd,
  };
}

type ParsedChisaCodeWorktreeInfo = Omit<ChisaCodeWorktreeInfo, "createdAt">;

function parseWorktreeList(output: string): ParsedChisaCodeWorktreeInfo[] {
  const entries: ParsedChisaCodeWorktreeInfo[] = [];
  let current: ParsedChisaCodeWorktreeInfo | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current?.path) {
        entries.push(current);
      }
      current = { path: line.slice("worktree ".length).trim() };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length).trim();
      current.branchName = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.trim().length === 0) {
      if (current.path) {
        entries.push(current);
      }
      current = null;
    }
  }

  if (current?.path) {
    entries.push(current);
  }

  return entries;
}

function resolveWorktreeCreatedAtIso(worktreePath: string): string {
  try {
    const stats = statSync(worktreePath);
    const birthtimeMs = stats.birthtimeMs;
    const createdAtMs =
      Number.isFinite(birthtimeMs) && birthtimeMs > 0 ? birthtimeMs : stats.ctimeMs;
    return new Date(createdAtMs).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

export async function listChisaCodeWorktrees({
  cwd,
  chisacodeHome,
}: {
  cwd: string;
  chisacodeHome?: string;
}): Promise<ChisaCodeWorktreeInfo[]> {
  const worktreesRoot = await getChisaCodeWorktreesRoot(cwd, chisacodeHome);
  const { stdout } = await runGitCommand(["worktree", "list", "--porcelain"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });

  const rootPrefix = normalizePathForOwnership(worktreesRoot) + sep;
  return parseWorktreeList(stdout)
    .map((entry) => Object.assign({}, entry, { path: normalizePathForOwnership(entry.path) }))
    .filter((entry) => entry.path.startsWith(rootPrefix))
    .map((entry) =>
      Object.assign({}, entry, { createdAt: resolveWorktreeCreatedAtIso(entry.path) }),
    );
}

export async function resolveExistingWorktreeForSlug({
  slug,
  repoRoot,
  chisacodeHome,
}: ResolveExistingWorktreeForSlugOptions): Promise<WorktreeConfig | null> {
  const worktrees = await listChisaCodeWorktrees({
    cwd: repoRoot,
    chisacodeHome,
  });
  const slugSuffix = `${sep}${slug}`;
  const existingWorktree = worktrees.find((worktree) => worktree.path.endsWith(slugSuffix));
  if (!existingWorktree) {
    return null;
  }

  const { stdout } = await runGitCommand(["branch", "--show-current"], {
    cwd: existingWorktree.path,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const branchName = stdout.trim();
  if (!branchName) {
    throw new Error(`Unable to resolve branch for existing worktree: ${existingWorktree.path}`);
  }

  return {
    branchName,
    worktreePath: existingWorktree.path,
  };
}

export async function resolveChisaCodeWorktreeRootForCwd(
  cwd: string,
  options?: { chisacodeHome?: string },
): Promise<{ repoRoot: string; worktreeRoot: string; worktreePath: string } | null> {
  let gitCommonDir: string;
  try {
    gitCommonDir = await getGitCommonDir(cwd);
  } catch {
    return null;
  }

  const worktreesRoot = await getChisaCodeWorktreesRoot(cwd, options?.chisacodeHome);
  const resolvedRoot = normalizePathForOwnership(worktreesRoot) + sep;

  let worktreeRoot: string | null = null;
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--show-toplevel"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    worktreeRoot = parseGitRevParsePath(stdout);
  } catch {
    worktreeRoot = null;
  }

  if (!worktreeRoot) {
    return null;
  }

  const resolvedWorktreeRoot = normalizePathForOwnership(worktreeRoot);
  if (!resolvedWorktreeRoot.startsWith(resolvedRoot)) {
    return null;
  }

  const knownWorktrees = await listChisaCodeWorktrees({
    cwd,
    chisacodeHome: options?.chisacodeHome,
  });
  const match = knownWorktrees.find((entry) => entry.path === resolvedWorktreeRoot);
  if (!match) {
    return null;
  }

  return {
    repoRoot: gitCommonDir,
    worktreeRoot: worktreesRoot,
    worktreePath: match.path,
  };
}

export async function deleteChisaCodeWorktree({
  cwd,
  worktreePath,
  worktreeSlug,
  worktreesRoot,
  chisacodeHome,
  alreadyHoldingMutationLock,
  mutationCoordinator,
}: {
  cwd: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  worktreesRoot?: string;
  chisacodeHome?: string;
  /**
   * When true, the caller (archive service) already holds the mutation lock.
   */
  alreadyHoldingMutationLock?: boolean;
  mutationCoordinator?: {
    runExclusive: <T>(
      path: string,
      reason: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fn: (ctx: any) => Promise<T>,
    ) => Promise<T>;
    waitForWritesToDrain?: (path: string) => Promise<void>;
  };
}): Promise<void> {
  if (!worktreePath && !worktreeSlug) {
    throw new Error("worktreePath or worktreeSlug is required");
  }

  // Resolve the worktrees-root. With a repo cwd we hash it the normal way; if
  // git has forgotten about the worktree we expect the caller to hand us the
  // path-derived worktreesRoot from the ownership check.
  let resolvedWorktreesRoot: string;
  if (worktreesRoot) {
    resolvedWorktreesRoot = worktreesRoot;
  } else if (cwd) {
    resolvedWorktreesRoot = await getChisaCodeWorktreesRoot(cwd, chisacodeHome);
  } else {
    throw new Error("cwd or worktreesRoot is required to delete a ChisaCode worktree");
  }

  const resolvedRoot = normalizePathForOwnership(resolvedWorktreesRoot) + sep;
  const requestedPath = worktreePath ?? join(resolvedWorktreesRoot, worktreeSlug!);
  const resolvedRequested = normalizePathForOwnership(requestedPath);
  const resolvedWorktree =
    (await resolveChisaCodeWorktreeRootForCwd(requestedPath, { chisacodeHome }))?.worktreePath ??
    resolvedRequested;

  if (!resolvedWorktree.startsWith(resolvedRoot)) {
    throw new Error("Refusing to delete non-ChisaCode worktree");
  }

  const runDelete = async (): Promise<void> => {
    if (!(await pathExists(resolvedWorktree))) {
      if (cwd) {
        await runGitCommand(["worktree", "prune"], { cwd, timeout: 30_000 });
      }
      return;
    }

    await runWorktreeTeardownCommands({
      worktreePath: resolvedWorktree,
    });

    if (!cwd) {
      if (await pathExists(resolvedWorktree)) {
        throw new Error(
          `Worktree is no longer registered with Git; preserved for recovery: ${resolvedWorktree}`,
        );
      }
      return;
    }

    // This command is the final safety gate. Git refuses dirty, untracked, ignored,
    // or concurrently modified worktrees. Never escalate a refusal to --force or
    // recursive deletion: external editors are outside the process-wide lock.
    await runGitCommand(["worktree", "remove", resolvedWorktree], {
      cwd,
      timeout: 120_000,
    });

    if (await pathExists(resolvedWorktree)) {
      throw new Error(
        `Git removed the worktree record but residual files remain: ${resolvedWorktree}`,
      );
    }

    if (cwd) {
      try {
        await runGitCommand(["worktree", "prune"], { cwd, timeout: 30_000 });
      } catch {
        // not critical; git will prune lazily
      }
    }
  };

  if (alreadyHoldingMutationLock) {
    await runDelete();
    return;
  }

  const coordinator =
    mutationCoordinator ??
    (await import("../server/workspace-mutation-coordinator.js")).workspaceMutationCoordinator;
  await coordinator.runExclusive(resolvedWorktree, "delete-worktree", async ({ setState }) => {
    setState("quiescing", "delete_begin");
    await coordinator.waitForWritesToDrain?.(resolvedWorktree);
    setState("deleting", "delete_fs");
    await runDelete();
    setState("archived", "delete_complete");
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Create a git worktree with proper naming conventions
 */
export const createWorktree = async ({
  cwd,
  source,
  worktreeSlug,
  runSetup,
  chisacodeHome,
}: CreateWorktreeOptions): Promise<WorktreeConfig> => {
  const sourcePlan = await resolveWorktreeSourcePlan({ cwd, source, desiredSlug: worktreeSlug });
  let worktreePath = join(await getChisaCodeWorktreesRoot(cwd, chisacodeHome), worktreeSlug);
  mkdirSync(dirname(worktreePath), { recursive: true });

  // Also handle worktree path collision
  let finalWorktreePath = worktreePath;
  let pathSuffix = 1;
  while (existsSync(finalWorktreePath)) {
    finalWorktreePath = `${worktreePath}-${pathSuffix}`;
    pathSuffix++;
  }

  // Primitive owner for `git worktree add`; callers route through createWorktreeCore.
  await runGitCommand(["worktree", "add", finalWorktreePath, ...sourcePlan.addArguments], {
    cwd,
    timeout: 120_000,
  });
  worktreePath = normalizePathForOwnership(finalWorktreePath);

  if (sourcePlan.pushRemote) {
    await configureWorktreePushRemote({
      cwd,
      branchName: sourcePlan.branchName,
      remote: sourcePlan.pushRemote,
    });
  }

  writeChisaCodeWorktreeMetadata(worktreePath, { baseRefName: sourcePlan.metadataBaseRefName });

  // If the project config exists in the main repo but wasn't checked into the worktree
  // (e.g. uncommitted on first-time setup), seed the worktree with it so setup
  // commands and scripts pick up the user's intended config.
  const mainConfigPath = resolveChisaCodeConfigPath(cwd);
  const worktreeConfigPath = join(worktreePath, basename(mainConfigPath));
  try {
    await stat(worktreeConfigPath);
  } catch {
    await copyFile(mainConfigPath, worktreeConfigPath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    });
  }

  if (runSetup) {
    await runWorktreeSetupCommands({
      worktreePath,
      branchName: sourcePlan.branchName,
      cleanupOnFailure: true,
    });
  }

  return {
    branchName: sourcePlan.branchName,
    worktreePath,
  };
};

interface ResolveWorktreeSourcePlanOptions {
  cwd: string;
  source: WorktreeSource;
  desiredSlug: string;
}

interface WorktreeSourcePlan {
  branchName: string;
  metadataBaseRefName: string;
  addArguments: string[];
  pushRemote?: {
    name: string;
    url: string;
    headRef: string;
  };
}

async function resolveWorktreeSourcePlan({
  cwd,
  source,
  desiredSlug,
}: ResolveWorktreeSourcePlanOptions): Promise<WorktreeSourcePlan> {
  switch (source.kind) {
    case "branch-off": {
      const branchName = source.branchName;
      validateWorktreeBranchName(branchName);
      const normalizedBaseBranch = normalizeRequiredBaseBranch(source.baseBranch);
      const resolvedBaseBranch = await resolveBaseBranchForWorktree(cwd, normalizedBaseBranch);
      const branchExists = await localBranchExists(cwd, branchName);
      const base = branchExists ? branchName : resolvedBaseBranch;
      const candidateBranch = branchExists ? desiredSlug : branchName;
      const newBranchName = await resolveUniqueLocalBranchName(cwd, candidateBranch);

      return {
        branchName: newBranchName,
        metadataBaseRefName: normalizedBaseBranch,
        addArguments: ["-b", newBranchName, "--no-track", base],
      };
    }
    case "checkout-branch": {
      validateWorktreeBranchName(source.branchName);
      if (!(await localBranchExists(cwd, source.branchName))) {
        try {
          await runGitCommand(["fetch", "origin", `${source.branchName}:${source.branchName}`], {
            cwd,
            timeout: 120_000,
          });
        } catch {
          throw new UnknownBranchError({ branchName: source.branchName, cwd });
        }
      }
      if (await isBranchCheckedOut(cwd, source.branchName)) {
        throw new BranchAlreadyCheckedOutError(source.branchName);
      }

      return {
        branchName: source.branchName,
        metadataBaseRefName: source.branchName,
        addArguments: [source.branchName],
      };
    }
    case "checkout-github-pr": {
      const localBranchCandidate = source.localBranchName ?? source.headRef;
      validateWorktreeBranchName(localBranchCandidate);
      const localBranchName = await resolveUniqueLocalBranchName(cwd, localBranchCandidate);
      const normalizedBaseRefName = normalizeRequiredBaseBranch(source.baseRefName);
      await runGitCommand(
        [
          "fetch",
          "origin",
          `refs/pull/${source.githubPrNumber}/head:refs/heads/${localBranchName}`,
          "--force",
        ],
        {
          cwd,
          timeout: 120_000,
        },
      );

      return {
        branchName: localBranchName,
        metadataBaseRefName: normalizedBaseRefName,
        addArguments: [localBranchName],
        ...(source.pushRemoteUrl
          ? {
              pushRemote: {
                name: `chisacode-pr-${source.githubPrNumber}`,
                url: source.pushRemoteUrl,
                headRef: source.headRef,
              },
            }
          : {}),
      };
    }
  }
}

async function configureWorktreePushRemote(options: {
  cwd: string;
  branchName: string;
  remote: {
    name: string;
    url: string;
    headRef: string;
  };
}): Promise<void> {
  await runGitCommand(["config", `remote.${options.remote.name}.url`, options.remote.url], {
    cwd: options.cwd,
  });
  await runGitCommand(
    ["config", `remote.${options.remote.name}.push`, `HEAD:refs/heads/${options.remote.headRef}`],
    { cwd: options.cwd },
  );
  await runGitCommand(["config", `branch.${options.branchName}.remote`, options.remote.name], {
    cwd: options.cwd,
  });
  await runGitCommand(
    ["config", `branch.${options.branchName}.merge`, `refs/heads/${options.remote.headRef}`],
    { cwd: options.cwd },
  );
}

function validateWorktreeBranchName(branchName: string): void {
  const validation = validateBranchSlug(branchName);
  if (!validation.valid) {
    throw new Error(`Invalid branch name: ${validation.error}`);
  }
}

function normalizeRequiredBaseBranch(baseBranch: string): string {
  const normalizedBaseBranch = normalizeBaseRefName(baseBranch);
  if (!normalizedBaseBranch) {
    throw new Error("Base branch is required when creating a ChisaCode worktree");
  }
  if (normalizedBaseBranch === "HEAD") {
    throw new Error("Base branch cannot be HEAD when creating a ChisaCode worktree");
  }
  return normalizedBaseBranch;
}

async function resolveBaseBranchForWorktree(
  cwd: string,
  normalizedBaseBranch: string,
): Promise<string> {
  try {
    await runGitCommand(["rev-parse", "--verify", `origin/${normalizedBaseBranch}`], { cwd });
    return `origin/${normalizedBaseBranch}`;
  } catch {
    try {
      await runGitCommand(["rev-parse", "--verify", normalizedBaseBranch], { cwd });
      return normalizedBaseBranch;
    } catch {
      throw new Error(`Base branch not found: ${normalizedBaseBranch}`);
    }
  }
}

async function localBranchExists(cwd: string, branchName: string): Promise<boolean> {
  try {
    await runGitCommand(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
      cwd,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueLocalBranchName(cwd: string, candidateBranch: string): Promise<string> {
  let newBranchName = candidateBranch;
  let suffix = 1;
  while (await localBranchExists(cwd, newBranchName)) {
    newBranchName = `${candidateBranch}-${suffix}`;
    suffix++;
  }
  return newBranchName;
}

async function isBranchCheckedOut(cwd: string, branchName: string): Promise<boolean> {
  const { stdout } = await runGitCommand(["worktree", "list", "--porcelain"], {
    cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  return parseWorktreeList(stdout).some((entry) => entry.branchName === branchName);
}
