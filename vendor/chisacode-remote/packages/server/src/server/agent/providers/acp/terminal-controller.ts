import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  CreateTerminalRequest,
  EnvVariable,
  KillTerminalRequest,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
} from "@agentclientprotocol/sdk";

import {
  createProviderEnvSpec,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { platformShell, spawnProcess } from "../../../../utils/spawn.js";
import type { ACPToolTerminalState } from "./tool-call-mapper.js";
import { resolvePathInsideBase } from "./workspace-path.js";

/** Exit state returned by ACP terminal operations. */
export interface ACPTerminalExit {
  exitCode?: number | null;
  signal?: string | null;
}

interface TerminalEntry extends ACPToolTerminalState {
  id: string;
  child: ChildProcess;
  truncated: boolean;
  outputByteLimit: number | null;
  exit: ACPTerminalExit | null;
  waitForExit: Promise<ACPTerminalExit>;
  resolveExit: (exit: ACPTerminalExit) => void;
  rejectExit: (error: Error) => void;
}

/** Options controlling ACP terminal process creation. */
export interface ACPTerminalControllerOptions {
  baseCwd: string;
  runtimeSettings?: ProviderRuntimeSettings;
}

/** Owns ACP terminal child processes, output buffers, and exit waiters. */
export class ACPTerminalController {
  private readonly entries = new Map<string, TerminalEntry>();
  private readonly baseCwd: string;
  private readonly runtimeSettings?: ProviderRuntimeSettings;

  constructor(options: ACPTerminalControllerOptions) {
    this.baseCwd = options.baseCwd;
    this.runtimeSettings = options.runtimeSettings;
  }

  get timelineStates(): ReadonlyMap<string, ACPToolTerminalState> {
    return this.entries;
  }

  async createTerminal(params: CreateTerminalRequest): Promise<{ terminalId: string }> {
    const terminalId = randomUUID();
    const env = Object.fromEntries(
      (params.env ?? []).map((entry: EnvVariable) => [entry.name, entry.value]),
    );
    const cwd = params.cwd ? resolvePathInsideBase(params.cwd, this.baseCwd) : this.baseCwd;
    const terminalCommand = resolveTerminalCommand(params.command, params.args);
    const child = spawnProcess(terminalCommand.command, terminalCommand.args, {
      cwd,
      ...createProviderEnvSpec({
        runtimeSettings: this.runtimeSettings,
        overlays: [env],
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolveExit!: (exit: ACPTerminalExit) => void;
    let rejectExit!: (error: Error) => void;
    const waitForExit = new Promise<ACPTerminalExit>((resolve, reject) => {
      resolveExit = resolve;
      rejectExit = reject;
    });
    waitForExit.catch(() => undefined);

    const entry: TerminalEntry = {
      id: terminalId,
      child,
      output: "",
      truncated: false,
      outputByteLimit: params.outputByteLimit ?? null,
      exit: null,
      waitForExit,
      resolveExit,
      rejectExit,
    };

    child.stdout?.on("data", (chunk: Buffer | string) =>
      appendTerminalOutput(entry, chunk.toString()),
    );
    child.stderr?.on("data", (chunk: Buffer | string) =>
      appendTerminalOutput(entry, chunk.toString()),
    );
    child.once("error", (error) => {
      const spawnError = error instanceof Error ? error : new Error(String(error));
      appendTerminalOutput(entry, `${spawnError.message}\n`);
      rejectExit(spawnError);
    });
    child.once("exit", (code, signal) => {
      const exit = { exitCode: code, signal };
      entry.exit = exit;
      resolveExit(exit);
    });

    this.entries.set(terminalId, entry);
    return { terminalId };
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const entry = this.getEntry(params.terminalId);
    return {
      output: entry.output,
      truncated: entry.truncated,
      exitStatus: entry.exit ?? undefined,
    };
  }

  async waitForTerminalExit(params: WaitForTerminalExitRequest): Promise<ACPTerminalExit> {
    return this.getEntry(params.terminalId).waitForExit;
  }

  async releaseTerminal(params: { sessionId: string; terminalId: string }): Promise<void> {
    const entry = this.getEntry(params.terminalId);
    if (!entry.exit) {
      entry.child.kill("SIGTERM");
    }
    this.entries.delete(params.terminalId);
  }

  async killTerminal(params: KillTerminalRequest): Promise<Record<string, never>> {
    const entry = this.getEntry(params.terminalId);
    if (!entry.exit) {
      entry.child.kill("SIGTERM");
    }
    return {};
  }

  close(): void {
    for (const terminal of this.entries.values()) {
      terminal.child.kill("SIGTERM");
    }
    this.entries.clear();
  }

  private getEntry(terminalId: string): TerminalEntry {
    const entry = this.entries.get(terminalId);
    if (!entry) {
      throw new Error(`Unknown terminal '${terminalId}'`);
    }
    return entry;
  }
}

function resolveTerminalCommand(
  command: string,
  args?: string[],
): { command: string; args: string[] } {
  if (args && args.length > 0) {
    return { command, args };
  }

  if (!/\s/.test(command.trim())) {
    return { command, args: [] };
  }

  const shell = platformShell();
  return { command: shell.command, args: [...shell.flag, command] };
}

function appendTerminalOutput(entry: TerminalEntry, chunk: string): void {
  entry.output += chunk;
  const limit = entry.outputByteLimit;
  if (!limit) {
    return;
  }
  while (Buffer.byteLength(entry.output, "utf8") > limit && entry.output.length > 0) {
    entry.output = entry.output.slice(1);
    entry.truncated = true;
  }
}
