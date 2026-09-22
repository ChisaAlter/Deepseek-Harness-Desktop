import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { createMessageCollector, type MessageCollector } from "../test-utils/message-collector.js";
import { withTimeout } from "../../utils/promise-timeout.js";
import { deriveWorktreeProjectHash } from "../../utils/worktree.js";
import { isPlatform } from "../../test-utils/platform.js";
import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";
import type { SessionOutboundMessage } from "../messages.js";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-"));
}

function nodeEvalCommand(script: string): string {
  const encodedScript = Buffer.from(script, "utf8").toString("base64");
  return `node -e "eval(Buffer.from('${encodedScript}','base64').toString('utf8'))"`;
}

function nodeEvalTerminalInput(script: string): string {
  return `${nodeEvalCommand(script)}\r`;
}

function findTimelineToolCall(
  messages: SessionOutboundMessage[],
  agentId: string,
  predicate: (item: AgentTimelineItem) => boolean,
): AgentTimelineItem | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.type !== "agent_stream") {
      continue;
    }
    if (msg.payload.agentId !== agentId) {
      continue;
    }
    const event = msg.payload.event as { type?: string; item?: AgentTimelineItem };
    if (event?.type !== "timeline") {
      continue;
    }
    const item = event.item as AgentTimelineItem;
    if (item?.type === "tool_call" && predicate(item)) {
      return item;
    }
  }
  return null;
}

async function waitForTimelineToolCall(
  messages: SessionOutboundMessage[],
  agentId: string,
  predicate: (item: AgentTimelineItem) => boolean,
  timeoutMs = 10000,
): Promise<Extract<AgentTimelineItem, { type: "tool_call" }>> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const existing = findTimelineToolCall(messages, agentId, predicate);
    if (existing && existing.type === "tool_call") {
      return existing;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  const recentToolCalls: Array<{
    name: string;
    status?: string;
    callId?: string;
    error?: string;
    exitCodes?: Array<number | null | undefined>;
    logTail?: string;
  }> = [];
  for (let i = messages.length - 1; i >= 0 && recentToolCalls.length < 10; i -= 1) {
    const msg = messages[i];
    if (msg?.type !== "agent_stream") continue;
    if (msg.payload.agentId !== agentId) continue;
    const event = msg.payload.event as { type?: string; item?: AgentTimelineItem };
    if (event?.type !== "timeline") continue;
    const item = event.item as AgentTimelineItem;
    if (item?.type !== "tool_call") continue;
    const detail =
      item.detail.type === "worktree_setup"
        ? {
            exitCodes: item.detail.commands.map((command) => command.exitCode),
            logTail: item.detail.log.slice(-500),
          }
        : {};
    recentToolCalls.push({
      name: item.name,
      status: item.status,
      callId: item.callId,
      error: item.error?.message,
      ...detail,
    });
  }
  throw new Error(
    `Timed out waiting for timeline tool_call (${agentId}). Recent tool_calls: ${JSON.stringify(
      recentToolCalls,
    )}`,
  );
}

async function waitForPathExists(options: {
  targetPath: string;
  timeoutMs: number;
  label: string;
}): Promise<void> {
  await waitForCondition({
    timeoutMs: options.timeoutMs,
    label: `${options.label}: ${options.targetPath}`,
    predicate: () => existsSync(options.targetPath),
  });
}

async function waitForCondition(options: {
  timeoutMs: number;
  label: string;
  predicate: () => boolean | Promise<boolean>;
}): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < options.timeoutMs) {
    if (await options.predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out after ${options.timeoutMs}ms waiting for ${options.label}`);
}

async function withShell<T>(shell: string, run: () => Promise<T>): Promise<T> {
  const originalShell = process.env.SHELL;
  process.env.SHELL = shell;
  try {
    return await run();
  } finally {
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }
  }
}

interface WorktreeTerminalBootstrapEntry {
  name: string | null;
  command: string;
  status: "started" | "failed";
  terminalId: string | null;
  error: string | null;
}

function getWorktreeTerminalBootstrapEntries(
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
): WorktreeTerminalBootstrapEntry[] | null {
  const detail = item.detail;
  if (!detail || detail.type !== "unknown" || !detail.output) {
    return null;
  }
  const output = detail.output as Record<string, unknown>;
  const terminals = output.terminals;
  if (!Array.isArray(terminals)) {
    return null;
  }
  return terminals as WorktreeTerminalBootstrapEntry[];
}

function includesAllTerminalIds(
  terminals: Array<{ id: string }>,
  expectedTerminalIds: string[],
): boolean {
  const terminalIds = new Set(terminals.map((terminal) => terminal.id));
  return expectedTerminalIds.every((terminalId) => terminalIds.has(terminalId));
}

// Use gpt-5.4-mini with low thinking preset for faster test execution
const CODEX_TEST_MODEL = "gpt-5.4-mini";
const CODEX_TEST_THINKING_OPTION_ID = "low";

let ctx: DaemonTestContext;
let collector: MessageCollector;

beforeEach(async () => {
  ctx = await createDaemonTestContext();
  collector = createMessageCollector(ctx.client);
});

afterEach(async () => {
  collector.unsubscribe();
  await ctx.cleanup();
}, 60000);

test("returns diff for modified file in git repo", async () => {
  const cwd = tmpCwd();

  // Initialize git repo
  const { execSync } = await import("child_process");
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd, stdio: "pipe" });

  // Create and commit a file
  const testFile = path.join(cwd, "test.txt");
  writeFileSync(testFile, "original content\n");
  execSync("git add test.txt", { cwd, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "Initial commit"', {
    cwd,
    stdio: "pipe",
  });

  // Modify the file (creates unstaged changes)
  writeFileSync(testFile, "modified content\n");

  const result = await ctx.client.getCheckoutDiff(cwd, { mode: "uncommitted" });
  expect(result.error).toBeNull();
  expect(result.files.length).toBeGreaterThan(0);
  const file = result.files.find((entry) => entry.path === "test.txt");
  expect(file).toBeTruthy();
  expect(file?.hunks.length).toBeGreaterThan(0);
  rmSync(cwd, { recursive: true, force: true });
}, 60000); // 1 minute timeout

test("returns empty diff when no changes", async () => {
  const cwd = tmpCwd();

  // Initialize git repo with clean state
  const { execSync } = await import("child_process");
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd, stdio: "pipe" });

  // Create and commit a file
  const testFile = path.join(cwd, "test.txt");
  writeFileSync(testFile, "content\n");
  execSync("git add test.txt", { cwd, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "Initial commit"', {
    cwd,
    stdio: "pipe",
  });

  const result = await ctx.client.getCheckoutDiff(cwd, { mode: "uncommitted" });

  expect(result.error).toBeNull();
  expect(result.files).toEqual([]);

  rmSync(cwd, { recursive: true, force: true });
}, 60000); // 1 minute timeout

test("returns error for non-git directory", async () => {
  const cwd = tmpCwd();
  // Don't initialize git - just a regular directory

  const result = await ctx.client.getCheckoutDiff(cwd, { mode: "uncommitted" });

  expect(result.files).toEqual([]);
  expect(result.error).toBeTruthy();
  expect(result.error?.code).toBe("NOT_GIT_REPO");

  rmSync(cwd, { recursive: true, force: true });
}, 60000); // 1 minute timeout

// POSIX-only: asserts repo-root containment across macOS /var symlink normalization.
test.skipIf(isPlatform("win32"))(
  "returns repo info for git repo with branch and dirty state",
  async () => {
    const cwd = tmpCwd();

    // Initialize git repo
    const { execSync } = await import("child_process");
    execSync("git init -b main", { cwd, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', { cwd, stdio: "pipe" });
    execSync('git config user.name "Test"', { cwd, stdio: "pipe" });

    // Create and commit a file
    const testFile = path.join(cwd, "test.txt");
    writeFileSync(testFile, "original content\n");
    execSync("git add test.txt", { cwd, stdio: "pipe" });
    execSync('git -c commit.gpgsign=false commit -m "Initial commit"', {
      cwd,
      stdio: "pipe",
    });

    // Modify the file (makes repo dirty)
    writeFileSync(testFile, "modified content\n");

    // Create agent in the git repo
    const agent = await ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd,
      title: "Git Repo Info Test",
    });

    expect(agent.id).toBeTruthy();
    expect(agent.status).toBe("idle");

    // Get checkout status
    const result = await ctx.client.getCheckoutStatus(cwd);

    // Verify repo info returned without error
    expect(result.error).toBeNull();
    expect(result.isGit).toBe(true);
    // macOS symlinks /var to /private/var, so we check containment
    expect(result.repoRoot).toContain("daemon-e2e-");
    expect(result.currentBranch).toBeTruthy();
    expect(result.isDirty).toBe(true);

    // Cleanup
    await ctx.client.deleteAgent(agent.id);
    rmSync(cwd, { recursive: true, force: true });
  },
  60000,
); // 1 minute timeout

test("returns clean state when no uncommitted changes", async () => {
  const cwd = tmpCwd();

  // Initialize git repo with clean state
  const { execSync } = await import("child_process");
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd, stdio: "pipe" });

  // Create and commit a file (no uncommitted changes)
  const testFile = path.join(cwd, "test.txt");
  writeFileSync(testFile, "content\n");
  execSync("git add test.txt", { cwd, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "Initial commit"', {
    cwd,
    stdio: "pipe",
  });

  // Create agent in the git repo
  const agent = await ctx.client.createAgent({
    provider: "codex",
    model: CODEX_TEST_MODEL,
    thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
    cwd,
    title: "Git Repo Info Clean Test",
  });

  expect(agent.id).toBeTruthy();

  // Get checkout status
  const result = await ctx.client.getCheckoutStatus(cwd);

  expect(result.error).toBeNull();
  expect(result.isGit).toBe(true);
  expect(result.isDirty).toBe(false);
  expect(result.currentBranch).toBeTruthy();

  // Cleanup
  await ctx.client.deleteAgent(agent.id);
  rmSync(cwd, { recursive: true, force: true });
}, 60000); // 1 minute timeout

test("returns isGit false for non-git directory", async () => {
  const cwd = tmpCwd();
  // Don't initialize git - just a regular directory

  // Create agent in a non-git directory
  const agent = await ctx.client.createAgent({
    provider: "codex",
    model: CODEX_TEST_MODEL,
    thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
    cwd,
    title: "Git Repo Info Non-Git Test",
  });

  expect(agent.id).toBeTruthy();

  // Get checkout status - should return isGit: false
  const result = await ctx.client.getCheckoutStatus(cwd);

  expect(result.isGit).toBe(false);

  // Cleanup
  await ctx.client.deleteAgent(agent.id);
  rmSync(cwd, { recursive: true, force: true });
}, 60000); // 1 minute timeout

test("runs chisacode.json setup asynchronously and reports status via timeline tool_call", async () => {
  const repoRoot = tmpCwd();

  const { execSync } = await import("child_process");
  execSync("git init -b main", { cwd: repoRoot, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "pipe" });

  writeFileSync(path.join(repoRoot, "file.txt"), "hello\n");
  execSync("git add .", { cwd: repoRoot, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "initial"', {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync("git branch -M main", { cwd: repoRoot, stdio: "pipe" });

  const setupCommand = nodeEvalCommand(`
const fs = require("node:fs");
const path = require("node:path");
const worktreePath = process.env.CHISACODE_WORKTREE_PATH;
if (!worktreePath) throw new Error("missing CHISACODE_WORKTREE_PATH");
const allowPath = path.join(worktreePath, "allow-setup");
const donePath = path.join(worktreePath, "setup-done.txt");
function waitForAllowFile() {
  if (fs.existsSync(allowPath)) {
    fs.writeFileSync(donePath, "done\\n");
    return;
  }
  setTimeout(waitForAllowFile, 50);
}
waitForAllowFile();
`);
  writeFileSync(
    path.join(repoRoot, "chisacode.json"),
    JSON.stringify({ worktree: { setup: [setupCommand] } }),
  );
  execSync("git add chisacode.json", { cwd: repoRoot, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "add chisacode.json"', {
    cwd: repoRoot,
    stdio: "pipe",
  });

  const agent = await withTimeout({
    promise: ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd: repoRoot,
      title: "Async Worktree Setup Test",
      git: {
        createWorktree: true,
        createNewBranch: true,
        baseBranch: "main",
        newBranchName: "async-setup-test",
        worktreeSlug: "async-setup-test",
      },
    }),
    timeoutMs: 10000,
    label: "createAgent should not block on setup",
  });

  expect(agent.cwd).toContain(path.join(".chisacode", "worktrees"));
  expect(existsSync(path.join(agent.cwd, "setup-done.txt"))).toBe(false);

  writeFileSync(path.join(agent.cwd, "allow-setup"), "ok\n");

  const completed = await waitForTimelineToolCall(
    collector.messages,
    agent.id,
    (item) => item.name === "chisacode_worktree_setup" && item.status === "completed",
    20000,
  );

  expect(completed.callId).toBeTruthy();
  expect(completed.detail.type).toBe("worktree_setup");
  if (completed.detail.type === "worktree_setup") {
    expect(completed.detail.commands.length).toBeGreaterThan(0);
    expect(completed.detail.log.length).toBeGreaterThan(0);
  }
  expect(existsSync(path.join(agent.cwd, "setup-done.txt"))).toBe(true);

  await ctx.client.deleteAgent(agent.id);
  rmSync(repoRoot, { recursive: true, force: true });
}, 60000);

test("bootstraps configured worktree terminals after setup succeeds", async () => {
  await withShell("/bin/sh", async () => {
    const repoRoot = tmpCwd();

    const { execSync } = await import("child_process");
    execSync("git init -b main", { cwd: repoRoot, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "pipe" });

    writeFileSync(path.join(repoRoot, "file.txt"), "hello\n");
    execSync("git add .", { cwd: repoRoot, stdio: "pipe" });
    execSync('git -c commit.gpgsign=false commit -m "initial"', {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execSync("git branch -M main", { cwd: repoRoot, stdio: "pipe" });

    const setupCommand = nodeEvalCommand(`
const fs = require("node:fs");
const path = require("node:path");
const worktreePath = process.env.CHISACODE_WORKTREE_PATH;
if (!worktreePath) throw new Error("missing CHISACODE_WORKTREE_PATH");
const allowPath = path.join(worktreePath, "allow-setup");
const donePath = path.join(worktreePath, "setup-done.txt");
const portPath = path.join(worktreePath, "setup-port.txt");
function waitForAllowFile() {
  if (fs.existsSync(allowPath)) {
    fs.writeFileSync(donePath, "done\\n");
    fs.writeFileSync(portPath, process.env.CHISACODE_WORKTREE_PORT ?? "");
    return;
  }
  setTimeout(waitForAllowFile, 50);
}
waitForAllowFile();
`);
    writeFileSync(
      path.join(repoRoot, "chisacode.json"),
      JSON.stringify({
        worktree: {
          setup: [setupCommand],
          terminals: [
            {
              name: "Dev Server",
              command: nodeEvalCommand("setInterval(() => {}, 1000);"),
            },
            {
              command: nodeEvalCommand("setInterval(() => {}, 1000);"),
            },
          ],
        },
      }),
    );
    execSync("git add chisacode.json", { cwd: repoRoot, stdio: "pipe" });
    execSync('git -c commit.gpgsign=false commit -m "add setup and terminals"', {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const agent = await withTimeout({
      promise: ctx.client.createAgent({
        provider: "codex",
        model: CODEX_TEST_MODEL,
        thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
        cwd: repoRoot,
        title: "Async Worktree Setup + Terminals Test",
        git: {
          createWorktree: true,
          createNewBranch: true,
          baseBranch: "main",
          newBranchName: "async-setup-terminals-test",
          worktreeSlug: "async-setup-terminals-test",
        },
      }),
      timeoutMs: 10000,
      label: "createAgent should not block on setup",
    });

    expect(agent.cwd).toContain(path.join(".chisacode", "worktrees"));
    expect(existsSync(path.join(agent.cwd, "setup-done.txt"))).toBe(false);
    expect(existsSync(path.join(agent.cwd, "dev-terminal.txt"))).toBe(false);
    expect(existsSync(path.join(agent.cwd, "lint-terminal.txt"))).toBe(false);

    writeFileSync(path.join(agent.cwd, "allow-setup"), "ok\n");

    await waitForTimelineToolCall(
      collector.messages,
      agent.id,
      (item) => item.name === "chisacode_worktree_setup" && item.status === "completed",
      20000,
    );
    const terminalsBootstrapToolCall = await waitForTimelineToolCall(
      collector.messages,
      agent.id,
      (item) => item.name === "chisacode_worktree_terminals" && item.status === "completed",
      30000,
    );
    const bootstrappedTerminals = getWorktreeTerminalBootstrapEntries(terminalsBootstrapToolCall);
    expect(bootstrappedTerminals).toBeTruthy();
    expect(bootstrappedTerminals?.length ?? 0).toBeGreaterThanOrEqual(2);
    const failedBootstraps =
      bootstrappedTerminals?.filter((terminal) => terminal.status === "failed") ?? [];
    expect(failedBootstraps).toEqual([]);
    const bootstrappedTerminalIds =
      bootstrappedTerminals
        ?.map((terminal) => terminal.terminalId)
        .filter((terminalId): terminalId is string => Boolean(terminalId)) ?? [];
    expect(bootstrappedTerminals?.some((terminal) => terminal.name === "Dev Server")).toBe(true);
    expect(bootstrappedTerminalIds.length).toBeGreaterThanOrEqual(2);

    const terminalListDiagnostic = {
      managerDirectories: [] as string[],
      directIds: [] as Array<{ id: string; present: boolean }>,
      allTerminals: [] as Array<{ id: string; name: string; cwd?: string }>,
      worktreeTerminals: [] as Array<{ id: string; name: string; cwd?: string }>,
    };
    try {
      await waitForCondition({
        timeoutMs: 10000,
        label: "configured worktree terminals to appear in listTerminals",
        predicate: async () => {
          terminalListDiagnostic.managerDirectories =
            ctx.daemon.daemon.terminalManager.listDirectories();
          terminalListDiagnostic.directIds = bootstrappedTerminalIds.map((terminalId) => ({
            id: terminalId,
            present: Boolean(ctx.daemon.daemon.terminalManager.getTerminal(terminalId)),
          }));
          const allList = await ctx.client.listTerminals();
          expect(allList.error).toBeUndefined();
          terminalListDiagnostic.allTerminals = allList.terminals.map((terminal) => ({
            id: terminal.id,
            name: terminal.name,
            cwd: terminal.cwd,
          }));
          const worktreeList = await ctx.client.listTerminals(agent.cwd);
          expect(worktreeList.error).toBeUndefined();
          terminalListDiagnostic.worktreeTerminals = worktreeList.terminals.map((terminal) => ({
            id: terminal.id,
            name: terminal.name,
            cwd: terminal.cwd,
          }));
          return includesAllTerminalIds(allList.terminals, bootstrappedTerminalIds);
        },
      });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}. Diagnostic: ${JSON.stringify({
          agentCwd: agent.cwd,
          bootstrappedTerminals,
          terminalListDiagnostic,
        })}`,
        { cause: error },
      );
    }
    await waitForPathExists({
      targetPath: path.join(agent.cwd, "setup-port.txt"),
      timeoutMs: 30000,
      label: "setup runtime port marker",
    });

    const setupPort = readFileSync(path.join(agent.cwd, "setup-port.txt"), "utf8").trim();
    expect(setupPort.length).toBeGreaterThan(0);

    const createdTerminal = await ctx.client.createTerminal(agent.cwd, "Manual Port Check");
    expect(createdTerminal.error).toBeNull();
    expect(createdTerminal.terminal).toBeTruthy();
    const manualTerminalId = createdTerminal.terminal?.id;
    expect(manualTerminalId).toBeTruthy();
    if (!manualTerminalId) {
      throw new Error("Expected manual terminal id");
    }
    ctx.client.sendTerminalInput(manualTerminalId, {
      type: "input",
      data: nodeEvalTerminalInput(`
const fs = require("node:fs");
const path = require("node:path");
const worktreePath = process.env.CHISACODE_WORKTREE_PATH;
if (!worktreePath) throw new Error("missing CHISACODE_WORKTREE_PATH");
fs.writeFileSync(
  path.join(worktreePath, "manual-terminal-port.txt"),
  process.env.CHISACODE_WORKTREE_PORT ?? "",
);
`),
    });
    await waitForPathExists({
      targetPath: path.join(agent.cwd, "manual-terminal-port.txt"),
      timeoutMs: 30000,
      label: "manual terminal runtime port marker",
    });
    const manualTerminalPort = readFileSync(
      path.join(agent.cwd, "manual-terminal-port.txt"),
      "utf8",
    ).trim();
    expect(manualTerminalPort).toBe(setupPort);

    await ctx.client.deleteAgent(agent.id);
    rmSync(repoRoot, { recursive: true, force: true });
  });
}, 60000);

test("reports failures via timeline tool_call without deleting the created worktree", async () => {
  const repoRoot = tmpCwd();

  const { execSync } = await import("child_process");
  execSync("git init -b main", { cwd: repoRoot, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "pipe" });

  writeFileSync(path.join(repoRoot, "file.txt"), "hello\n");
  execSync("git add .", { cwd: repoRoot, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "initial"', {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync("git branch -M main", { cwd: repoRoot, stdio: "pipe" });

  const setupCommand = nodeEvalCommand(`
const fs = require("node:fs");
const path = require("node:path");
const worktreePath = process.env.CHISACODE_WORKTREE_PATH;
if (!worktreePath) throw new Error("missing CHISACODE_WORKTREE_PATH");
fs.writeFileSync(path.join(worktreePath, "setup-start.txt"), "started\\n");
console.error("boom");
process.exit(7);
`);
  writeFileSync(
    path.join(repoRoot, "chisacode.json"),
    JSON.stringify({
      worktree: {
        setup: [setupCommand],
        terminals: [
          {
            name: "Should Not Start",
            command: nodeEvalCommand(`
const fs = require("node:fs");
fs.writeFileSync("should-not-run.txt", "should-not-run\\n");
setInterval(() => {}, 1000);
`),
          },
        ],
      },
    }),
  );
  execSync("git add chisacode.json", { cwd: repoRoot, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "add failing setup"', {
    cwd: repoRoot,
    stdio: "pipe",
  });

  const agent = await withTimeout({
    promise: ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd: repoRoot,
      title: "Async Worktree Setup Failure Test",
      git: {
        createWorktree: true,
        createNewBranch: true,
        baseBranch: "main",
        newBranchName: "async-setup-failure-test",
        worktreeSlug: "async-setup-failure-test",
      },
    }),
    timeoutMs: 10000,
    label: "createAgent should not block on failing setup",
  });

  expect(agent.cwd).toContain(path.join(".chisacode", "worktrees"));
  expect(existsSync(agent.cwd)).toBe(true);

  const started = await waitForTimelineToolCall(
    collector.messages,
    agent.id,
    (item) => item.name === "chisacode_worktree_setup" && item.status === "running",
    10000,
  );

  const failed = await waitForTimelineToolCall(
    collector.messages,
    agent.id,
    (item) =>
      item.name === "chisacode_worktree_setup" &&
      item.callId === started.callId &&
      item.status === "failed",
    20000,
  );

  expect(existsSync(path.join(agent.cwd, "setup-start.txt"))).toBe(true);
  expect(existsSync(path.join(agent.cwd, "should-not-run.txt"))).toBe(false);

  expect(failed.detail.type).toBe("worktree_setup");
  if (failed.detail.type === "worktree_setup") {
    expect(Array.isArray(failed.detail.commands)).toBe(true);
    expect(failed.detail.commands[0]?.exitCode).toBe(7);
    expect(failed.detail.log).toContain("Exit 7");
  }

  await ctx.client.deleteAgent(agent.id);
  rmSync(repoRoot, { recursive: true, force: true });
}, 60000);

test("creates agent in ~/.chisacode/worktrees/{hash} when worktree is requested", async () => {
  const cwd = tmpCwd();
  const projectHash = await deriveWorktreeProjectHash(cwd);

  const { execSync } = await import("child_process");
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd, stdio: "pipe" });

  const testFile = path.join(cwd, "test.txt");
  writeFileSync(testFile, "content\n");
  execSync("git add test.txt", { cwd, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "Initial commit"', {
    cwd,
    stdio: "pipe",
  });

  const agent = await ctx.client.createAgent({
    provider: "codex",
    model: CODEX_TEST_MODEL,
    thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
    cwd,
    title: "Worktree Agent Test",
    git: {
      createWorktree: true,
      createNewBranch: true,
      newBranchName: "worktree-test",
      worktreeSlug: "worktree-test",
      baseBranch: "main",
    },
  });

  expect(agent.id).toBeTruthy();
  expect(agent.status).toBe("idle");
  expect(realpathSync(agent.cwd)).toBe(
    realpathSync(path.join(ctx.daemon.chisacodeHome, "worktrees", projectHash, "worktree-test")),
  );
  expect(existsSync(agent.cwd)).toBe(true);

  await ctx.client.deleteAgent(agent.id);
  rmSync(cwd, { recursive: true, force: true });
}, 60000);

test("archives worktree by running teardown commands and shutting down worktree terminals", async () => {
  const repoRoot = tmpCwd();

  const { execSync } = await import("child_process");
  execSync("git init -b main", { cwd: repoRoot, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "pipe" });

  writeFileSync(path.join(repoRoot, "file.txt"), "hello\n");
  execSync("git add .", { cwd: repoRoot, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "initial"', {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync("git branch -M main", { cwd: repoRoot, stdio: "pipe" });

  const teardownMarkerPath = path.join(repoRoot, "teardown-marker.txt");
  writeFileSync(
    path.join(repoRoot, "chisacode.json"),
    JSON.stringify({
      worktree: {
        terminals: [
          {
            name: "Dev Server",
            command: nodeEvalCommand(`
const fs = require("node:fs");
fs.writeFileSync("dev-terminal.txt", "dev-server\\n");
setInterval(() => {}, 1000);
`),
          },
        ],
        teardown: [
          nodeEvalCommand(`
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(teardownMarkerPath)}, process.env.CHISACODE_WORKTREE_PATH ?? "");
`),
        ],
      },
    }),
  );
  execSync("git add chisacode.json", { cwd: repoRoot, stdio: "pipe" });
  execSync('git -c commit.gpgsign=false commit -m "add worktree terminal + teardown"', {
    cwd: repoRoot,
    stdio: "pipe",
  });

  const agent = await withTimeout({
    promise: ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd: repoRoot,
      title: "Worktree Archive Cleanup Test",
      git: {
        createWorktree: true,
        createNewBranch: true,
        baseBranch: "main",
        newBranchName: "archive-cleanup-test",
        worktreeSlug: "archive-cleanup-test",
      },
    }),
    timeoutMs: 10000,
    label: "createAgent should not block on setup",
  });

  await waitForCondition({
    timeoutMs: 30000,
    label: `worktree terminal bootstrap for ${agent.cwd}`,
    predicate: async () => {
      const directories = ctx.daemon.daemon.terminalManager.listDirectories();
      if (!directories.includes(agent.cwd)) {
        return false;
      }
      const terminals = await ctx.client.listTerminals(agent.cwd);
      return terminals.terminals.some((terminal) => terminal.name === "Dev Server");
    },
  });

  const beforeArchiveDirectories = ctx.daemon.daemon.terminalManager.listDirectories();
  expect(beforeArchiveDirectories).toContain(agent.cwd);

  const archive = await ctx.client.archiveChisaCodeWorktree({
    worktreePath: agent.cwd,
  });
  expect(archive.error).toBeNull();
  expect(archive.success).toBe(true);
  expect(archive.removedAgents).toContain(agent.id);

  expect(existsSync(agent.cwd)).toBe(false);
  expect(existsSync(teardownMarkerPath)).toBe(true);
  expect(readFileSync(teardownMarkerPath, "utf8").trim()).toBe(agent.cwd);

  const afterArchiveDirectories = ctx.daemon.daemon.terminalManager.listDirectories();
  expect(afterArchiveDirectories).not.toContain(agent.cwd);

  rmSync(repoRoot, { recursive: true, force: true });
}, 60000);
