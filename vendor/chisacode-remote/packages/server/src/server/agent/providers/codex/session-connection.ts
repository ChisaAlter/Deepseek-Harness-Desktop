import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";

import { CodexAppServerClient, type CodexAppServerTraceContext } from "./app-server-transport.js";
import { buildCodexAppServerInitializeParams } from "./runtime-config.js";

interface CodexSessionConnectionOptions {
  logger: Logger;
  spawnAppServer: () => Promise<ChildProcessWithoutNullStreams>;
  getTraceContext: () => CodexAppServerTraceContext;
  onNotification: (method: string, params: unknown) => void;
  registerRequestHandlers: (client: CodexAppServerClient) => void;
  onInitialized: () => Promise<void>;
}

/** Owns the Codex app-server client and its initialize/dispose lifecycle. */
export class CodexSessionConnection {
  private client: CodexAppServerClient | null = null;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private lifecycleVersion = 0;

  constructor(private readonly options: CodexSessionConnectionOptions) {}

  getClient(): CodexAppServerClient | null {
    return this.client;
  }

  setClient(client: CodexAppServerClient | null): void {
    this.client = client;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;

    const lifecycleVersion = this.lifecycleVersion;
    const connectPromise = this.connectOnce(lifecycleVersion);
    this.connectPromise = connectPromise;
    try {
      await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    }
  }

  async close(): Promise<void> {
    this.lifecycleVersion += 1;
    this.connected = false;
    const client = this.client;
    this.client = null;
    if (client) {
      await client.dispose();
    }
  }

  private async connectOnce(lifecycleVersion: number): Promise<void> {
    const child = await this.options.spawnAppServer();
    const client = new CodexAppServerClient(
      child,
      this.options.logger,
      this.options.getTraceContext,
    );

    if (!this.isCurrent(lifecycleVersion)) {
      await this.disposeAfterInitializationFailure(client);
      throw new Error("Codex session connection was closed during initialization");
    }

    this.client = client;
    try {
      client.setNotificationHandler(this.options.onNotification);
      this.options.registerRequestHandlers(client);
      await client.request("initialize", buildCodexAppServerInitializeParams());
      this.assertCurrent(client, lifecycleVersion);
      client.notify("initialized", {});
      await this.options.onInitialized();
      this.assertCurrent(client, lifecycleVersion);
      this.connected = true;
    } catch (error) {
      if (this.client === client) {
        this.client = null;
        this.connected = false;
      }
      await this.disposeAfterInitializationFailure(client);
      throw error;
    }
  }

  private isCurrent(lifecycleVersion: number): boolean {
    return lifecycleVersion === this.lifecycleVersion;
  }

  private assertCurrent(client: CodexAppServerClient, lifecycleVersion: number): void {
    if (!this.isCurrent(lifecycleVersion) || this.client !== client) {
      throw new Error("Codex session connection was closed during initialization");
    }
  }

  private async disposeAfterInitializationFailure(client: CodexAppServerClient): Promise<void> {
    try {
      await client.dispose();
    } catch (disposeError) {
      this.options.logger.warn(
        { error: disposeError },
        "Failed to dispose Codex app-server after connection initialization failure",
      );
    }
  }
}
