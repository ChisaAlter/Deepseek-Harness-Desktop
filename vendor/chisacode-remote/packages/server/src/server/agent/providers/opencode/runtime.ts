import {
  createOpencodeClient,
  type OpencodeClient,
  type OpencodeClientConfig,
} from "@opencode-ai/sdk/v2/client";
import type { OpenCodeServerManager } from "./server-manager.js";

export interface OpenCodeServerAcquisition {
  server: { port: number; url: string };
  release: () => void;
}

export interface OpenCodeRuntime {
  acquireServer(options: {
    force: boolean;
    env?: Record<string, string>;
  }): Promise<OpenCodeServerAcquisition>;
  ensureServerRunning(): Promise<{ port: number; url: string }>;
  createClient(options: { baseUrl: string; directory: string }): OpencodeClient;
  shutdown(): Promise<void>;
}

export function createSdkOpenCodeClient(options: {
  baseUrl: string;
  directory: string;
}): OpencodeClient {
  return createOpencodeClient(options satisfies OpencodeClientConfig & { directory: string });
}

export class ProductionOpenCodeRuntime implements OpenCodeRuntime {
  constructor(private readonly serverManager: OpenCodeServerManager) {}

  async acquireServer(options: {
    force: boolean;
    env?: Record<string, string>;
  }): Promise<OpenCodeServerAcquisition> {
    return this.serverManager.acquire(options);
  }

  async ensureServerRunning(): Promise<{ port: number; url: string }> {
    return this.serverManager.ensureRunning();
  }

  createClient(options: { baseUrl: string; directory: string }): OpencodeClient {
    return createSdkOpenCodeClient(options);
  }

  async shutdown(): Promise<void> {
    await this.serverManager.shutdown();
  }
}
