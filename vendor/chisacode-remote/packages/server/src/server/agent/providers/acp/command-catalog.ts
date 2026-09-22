import type { AgentSlashCommand } from "../../agent-sdk-types.js";

interface ACPCommandCatalogOptions {
  waitForInitialCommands: boolean;
  initialWaitTimeoutMs: number;
}

interface ACPAvailableCommand {
  name: string;
  description: string;
}

/** Owns the ACP slash-command snapshot and its optional first-update wait gate. */
export class ACPCommandCatalog {
  private readonly waitForInitialCommands: boolean;
  private readonly initialWaitTimeoutMs: number;
  private commands: AgentSlashCommand[] = [];
  private readyDeferred: { promise: Promise<void>; resolve: () => void } | null = null;
  private readySettled = false;
  private closed = false;

  constructor(options: ACPCommandCatalogOptions) {
    this.waitForInitialCommands = options.waitForInitialCommands;
    this.initialWaitTimeoutMs = options.initialWaitTimeoutMs;
  }

  update(commands: readonly ACPAvailableCommand[]): void {
    this.commands = commands.map((command) => ({
      name: command.name,
      description: command.description,
      argumentHint: "",
    }));
    this.settleReady();
  }

  async list(): Promise<AgentSlashCommand[]> {
    if (this.commands.length > 0 || !this.waitForInitialCommands || this.closed) {
      return this.commands;
    }

    this.ensureReadyDeferred();
    await this.waitUntilReady();
    this.settleReady();
    return this.commands;
  }

  close(): void {
    this.closed = true;
    this.settleReady();
  }

  private ensureReadyDeferred(): void {
    if (this.readyDeferred || this.readySettled || this.commands.length > 0) {
      return;
    }

    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
      resolve = settle;
    });
    this.readyDeferred = { promise, resolve };
  }

  private settleReady(): void {
    if (this.readySettled) {
      return;
    }
    this.readySettled = true;
    this.readyDeferred?.resolve();
    this.readyDeferred = null;
  }

  private async waitUntilReady(): Promise<void> {
    const deferred = this.readyDeferred;
    if (!deferred) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        deferred.promise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.initialWaitTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
