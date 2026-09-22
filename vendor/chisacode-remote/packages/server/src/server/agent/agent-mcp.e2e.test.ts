import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { createMCPClient } from "@ai-sdk/mcp";
import pino from "pino";

import { withTimeout } from "../../utils/promise-timeout.js";
import { createChisaCodeDaemon, type ChisaCodeDaemonConfig } from "../bootstrap.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

interface StructuredContent {
  [key: string]: unknown;
}

interface McpToolResult {
  structuredContent?: StructuredContent;
  content?: Array<{ structuredContent?: StructuredContent } | StructuredContent>;
  isError?: boolean;
}

interface McpClient {
  callTool: (input: { name: string; args?: StructuredContent }) => Promise<McpToolResult>;
  close: () => Promise<void>;
}

const TEST_PASSWORD = "correct-password";
const TEST_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

async function waitForPathExists(options: {
  targetPath: string;
  timeoutMs: number;
}): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < options.timeoutMs) {
    if (existsSync(options.targetPath)) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out after ${options.timeoutMs}ms waiting for path: ${options.targetPath}`);
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function getStructuredContent(result: McpToolResult): StructuredContent | null {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const content = result.content?.[0];
  if (content && typeof content === "object" && "structuredContent" in content) {
    if (content.structuredContent) return content.structuredContent;
  }
  if (content && typeof content === "object") {
    return content;
  }
  return null;
}

async function createMcpClient(url: string, password?: string): Promise<McpClient> {
  const rawClient = await createMCPClient({
    transport: {
      type: "http",
      url,
      ...(password ? { headers: { Authorization: `Bearer ${password}` } } : {}),
    },
  });
  return {
    callTool: ({ name, args }) =>
      rawClient.callTool({ name, arguments: args }) as Promise<McpToolResult>,
    close: () => rawClient.close(),
  };
}

async function waitForAgentCompletion(options: {
  client: McpClient;
  agentId: string;
}): Promise<void> {
  const waitResult = await options.client.callTool({
    name: "wait_for_agent",
    args: { agentId: options.agentId },
  });
  const payload = getStructuredContent(waitResult);
  if (!payload) {
    throw new Error("wait_for_agent returned no structured payload");
  }
  if (payload.permission) {
    throw new Error(`Unexpected permission while waiting: ${JSON.stringify(payload.permission)}`);
  }
  const status = payload.status;
  if (status === "running" || status === "initializing") {
    throw new Error(`Agent still running after wait_for_agent (status=${status})`);
  }
}

describe("agent MCP end-to-end (offline)", () => {
  test("create_agent runs initial prompt and affects filesystem", async () => {
    const chisacodeHome = await mkdtemp(path.join(os.tmpdir(), "chisacode-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "chisacode-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: ChisaCodeDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      chisacodeHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(chisacodeHome, "agents"),
    };

    const daemon = await createChisaCodeDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    let agentId: string | null = null;
    try {
      const filePath = path.join(agentCwd, "mcp-smoke.txt");
      await writeFile(filePath, "ok", "utf8");

      const initialPrompt = [
        "You must call the Bash command tool with the exact command `rm -f mcp-smoke.txt`.",
        "Run it and reply with done and stop.",
        "Do not respond before the command finishes.",
      ].join("\n");

      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "MCP e2e smoke",
          provider: "claude/claude-test-model",
          settings: { modeId: "bypassPermissions" },
          initialPrompt,
          background: false,
        },
      });

      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();
      expect(payload?.currentModeId).toBe("bypassPermissions");
      expect(payload?.permission).toBeNull();

      await waitForAgentCompletion({ client, agentId: agentId! });

      if (existsSync(filePath)) {
        const contents = await readFile(filePath, "utf8");
        throw new Error(
          `Expected mcp-smoke.txt to be removed, but it still exists with contents: ${contents}`,
        );
      }
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(chisacodeHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent auto-injects chisacode MCP by default and can be disabled", async () => {
    const chisacodeHome = await mkdtemp(path.join(os.tmpdir(), "chisacode-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "chisacode-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: ChisaCodeDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      chisacodeHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(chisacodeHome, "agents"),
    };

    const daemon = await createChisaCodeDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    const disabledChisaCodeHome = await mkdtemp(path.join(os.tmpdir(), "chisacode-home-disabled-"));
    const disabledStaticDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-static-disabled-"));
    const disabledAgentCwd = await mkdtemp(path.join(os.tmpdir(), "chisacode-agent-cwd-disabled-"));
    const disabledPort = await getAvailablePort();
    const disabledDaemonConfig: ChisaCodeDaemonConfig = {
      listen: `127.0.0.1:${disabledPort}`,
      chisacodeHome: disabledChisaCodeHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      mcpInjectIntoAgents: false,
      staticDir: disabledStaticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(disabledChisaCodeHome, "agents"),
    };
    const disabledDaemon = await createChisaCodeDaemon(
      disabledDaemonConfig,
      pino({ level: "silent" }),
    );
    await disabledDaemon.start();

    const disabledClient = await createMcpClient(`http://127.0.0.1:${disabledPort}/mcp/agents`);

    let agentId: string | null = null;
    let disabledAgentId: string | null = null;
    try {
      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "Injected MCP",
          provider: "claude/claude-test-model",
          settings: { modeId: "bypassPermissions" },
          initialPrompt: "reply with done and stop",
          background: true,
        },
      });
      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();

      const injectedAgent = daemon.agentManager.getAgent(agentId!);
      expect(injectedAgent?.config.mcpServers).toMatchObject({
        chisacode: {
          type: "http",
          url: `http://127.0.0.1:${port}/mcp/agents?callerAgentId=${agentId!}`,
        },
      });

      const disabledResult = await disabledClient.callTool({
        name: "create_agent",
        args: {
          cwd: disabledAgentCwd,
          title: "No injected MCP",
          provider: "claude/claude-test-model",
          settings: { modeId: "bypassPermissions" },
          initialPrompt: "reply with done and stop",
          background: true,
        },
      });
      const disabledPayload = getStructuredContent(disabledResult);
      disabledAgentId =
        typeof disabledPayload?.agentId === "string" ? disabledPayload.agentId : null;
      expect(disabledAgentId).toBeTruthy();

      const disabledAgent = disabledDaemon.agentManager.getAgent(disabledAgentId!);
      expect(disabledAgent?.config.mcpServers?.chisacode).toBeUndefined();
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      if (disabledAgentId) {
        await disabledClient.callTool({ name: "kill_agent", args: { agentId: disabledAgentId } });
      }
      await disabledClient.close();
      await disabledDaemon.stop();
      await rm(disabledChisaCodeHome, { recursive: true, force: true });
      await rm(disabledStaticDir, { recursive: true, force: true });
      await rm(disabledAgentCwd, { recursive: true, force: true });
      await client.close();
      await daemon.stop();
      await rm(chisacodeHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent injects a loopback MCP URL when the daemon listens on all interfaces", async () => {
    const chisacodeHome = await mkdtemp(path.join(os.tmpdir(), "chisacode-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "chisacode-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: ChisaCodeDaemonConfig = {
      listen: `0.0.0.0:${port}`,
      chisacodeHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(chisacodeHome, "agents"),
      auth: { password: TEST_PASSWORD_HASH },
    };

    const daemon = await createChisaCodeDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`, TEST_PASSWORD);

    let agentId: string | null = null;
    try {
      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "Wildcard MCP",
          provider: "claude/claude-test-model",
          settings: { modeId: "bypassPermissions" },
          initialPrompt: "reply with done and stop",
          background: true,
        },
      });
      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();

      const injectedAgent = daemon.agentManager.getAgent(agentId!);
      expect(injectedAgent?.config.mcpServers).toMatchObject({
        chisacode: {
          type: "http",
          url: `http://127.0.0.1:${port}/mcp/agents?callerAgentId=${agentId!}`,
        },
      });
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(chisacodeHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent with background initialPrompt reflects running state once the first turn starts", async () => {
    const chisacodeHome = await mkdtemp(path.join(os.tmpdir(), "chisacode-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "chisacode-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: ChisaCodeDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      chisacodeHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(chisacodeHome, "agents"),
    };

    const daemon = await createChisaCodeDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    let agentId: string | null = null;
    try {
      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "MCP background create",
          provider: "codex/gpt-5.4-mini",
          settings: { modeId: "full-access" },
          initialPrompt: "Run exactly: sleep 30",
          background: true,
        },
      });

      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();
      expect(payload?.status).toBe("running");

      const statusResult = await client.callTool({
        name: "get_agent_status",
        args: { agentId },
      });
      const statusPayload = getStructuredContent(statusResult);
      expect(statusPayload?.status).toBe("running");
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(chisacodeHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent propagates initial-turn start failure instead of returning success", async () => {
    class StartTurnFailureSession implements AgentSession {
      readonly provider = "codex" as const;
      readonly id = "mcp-start-turn-failure-session";
      readonly capabilities = {
        supportsStreaming: false,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: false,
        supportsToolInvocations: false,
        supportsRewindConversation: false,
        supportsRewindFiles: false,
        supportsRewindBoth: false,
      } as const;

      async run(): Promise<AgentRunResult> {
        return {
          sessionId: this.id,
          finalText: "",
          timeline: [],
        };
      }

      async startTurn(): Promise<{ turnId: string }> {
        throw new Error("Initial turn failed to start");
      }

      subscribe(_callback: (event: AgentStreamEvent) => void): () => void {
        return () => undefined;
      }

      async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
        yield* [];
      }

      async getRuntimeInfo() {
        return {
          provider: "codex" as const,
          sessionId: this.id,
          model: "gpt-5.4-mini",
          modeId: "full-access",
        };
      }

      async getAvailableModes(): Promise<
        Array<{ id: string; label: string; description: string }>
      > {
        return [{ id: "full-access", label: "Full access", description: "No prompts" }];
      }

      async getCurrentMode(): Promise<string | null> {
        return "full-access";
      }

      async setMode(): Promise<void> {}

      getPendingPermissions() {
        return [];
      }

      async respondToPermission(): Promise<void> {}

      describePersistence(): AgentPersistenceHandle | null {
        return { provider: "codex", sessionId: this.id };
      }

      async interrupt(): Promise<void> {}

      async close(): Promise<void> {}
    }

    class StartTurnFailureClient implements AgentClient {
      readonly provider = "codex" as const;
      readonly capabilities = {
        supportsStreaming: false,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: false,
        supportsToolInvocations: false,
        supportsRewindConversation: false,
        supportsRewindFiles: false,
        supportsRewindBoth: false,
      } as const;

      async isAvailable(): Promise<boolean> {
        return true;
      }

      async createSession(_config: AgentSessionConfig): Promise<AgentSession> {
        return new StartTurnFailureSession();
      }

      async resumeSession(
        _handle: AgentPersistenceHandle,
        _config?: Partial<AgentSessionConfig>,
      ): Promise<AgentSession> {
        return new StartTurnFailureSession();
      }
    }

    const chisacodeHome = await mkdtemp(path.join(os.tmpdir(), "chisacode-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "chisacode-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: ChisaCodeDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      chisacodeHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: {
        ...createTestAgentClients(),
        codex: new StartTurnFailureClient(),
      },
      agentStoragePath: path.join(chisacodeHome, "agents"),
    };

    const daemon = await createChisaCodeDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    try {
      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "MCP start failure",
          provider: "codex/gpt-5.4-mini",
          settings: { modeId: "full-access" },
          initialPrompt: "Run exactly: sleep 30",
          background: true,
        },
      });

      expect(result.isError).toBe(true);
      const contentItem = result.content?.[0];
      const contentText: string | undefined =
        contentItem != null && typeof contentItem === "object"
          ? Reflect.get(contentItem, "text")
          : undefined;
      expect(contentText ?? "").toContain("Initial turn failed to start");
    } finally {
      await client.close();
      await daemon.stop();
      await rm(chisacodeHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent with worktree is async and boots terminals only after setup success", async () => {
    const chisacodeHome = await mkdtemp(path.join(os.tmpdir(), "chisacode-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "chisacode-static-"));
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "chisacode-worktree-repo-"));
    const port = await getAvailablePort();

    const daemonConfig: ChisaCodeDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      chisacodeHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(chisacodeHome, "agents"),
    };

    const daemon = await createChisaCodeDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    let agentId: string | null = null;
    try {
      git(repoRoot, ["init", "-b", "main"]);
      git(repoRoot, ["config", "user.email", "test@test.com"]);
      git(repoRoot, ["config", "user.name", "Test"]);
      await writeFile(path.join(repoRoot, "file.txt"), "hello\n", "utf8");
      git(repoRoot, ["add", "."]);
      git(repoRoot, ["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);

      const setupCommand = [
        "node -e \"const fs=require('fs');",
        "const path=require('path');",
        "const dir=process.env.CHISACODE_WORKTREE_PATH;",
        "const complete=()=>{if(!fs.existsSync(path.join(dir,'allow-setup')))return false;",
        "fs.writeFileSync(path.join(dir,'setup-done.txt'),'done');return true;};",
        'if(!complete()){const watcher=fs.watch(dir,()=>{if(complete())watcher.close();});}"',
      ].join(" ");
      await writeFile(
        path.join(repoRoot, "chisacode.json"),
        JSON.stringify({
          worktree: {
            setup: [setupCommand],
            terminals: [
              {
                name: "Dev Server",
                command: "node -e \"require('fs').writeFileSync('dev-terminal.txt','dev-server')\"",
              },
            ],
          },
        }),
        "utf8",
      );
      git(repoRoot, ["add", "chisacode.json"]);
      git(repoRoot, ["-c", "commit.gpgsign=false", "commit", "-m", "add worktree config"]);

      const result = await withTimeout({
        promise: client.callTool({
          name: "create_agent",
          args: {
            cwd: repoRoot,
            title: "MCP worktree setup terminals",
            provider: "claude/claude-test-model",
            settings: { modeId: "bypassPermissions" },
            initialPrompt: "say done and stop",
            worktreeName: "mcp-worktree-setup-test",
            baseBranch: "main",
            background: true,
          },
        }),
        timeoutMs: 10_000,
        label: "create_agent should not block on setup",
      });

      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();
      const worktreePath = typeof payload?.cwd === "string" ? payload.cwd : "";
      expect(worktreePath).toContain(`${path.sep}worktrees${path.sep}`);
      expect(existsSync(path.join(worktreePath, "setup-done.txt"))).toBe(false);
      expect(existsSync(path.join(worktreePath, "dev-terminal.txt"))).toBe(false);

      await writeFile(path.join(worktreePath, "allow-setup"), "ok\n", "utf8");

      await waitForPathExists({
        targetPath: path.join(worktreePath, "setup-done.txt"),
        timeoutMs: 15000,
      });
      await waitForPathExists({
        targetPath: path.join(worktreePath, "dev-terminal.txt"),
        timeoutMs: 30000,
      });
      const terminalsResult = await client.callTool({
        name: "list_terminals",
        args: { cwd: worktreePath },
      });
      const terminalsPayload = getStructuredContent(terminalsResult);
      const rawTerminals = terminalsPayload?.terminals;
      const terminalIds = Array.isArray(rawTerminals)
        ? rawTerminals.flatMap((terminal) => {
            if (!terminal || typeof terminal !== "object") return [];
            const id = Reflect.get(terminal, "id");
            return typeof id === "string" ? [id] : [];
          })
        : [];
      expect(terminalIds.length).toBeGreaterThan(0);
      for (const terminalId of terminalIds) {
        await client.callTool({ name: "kill_terminal", args: { terminalId } });
      }
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(chisacodeHome, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
      await rm(staticDir, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
